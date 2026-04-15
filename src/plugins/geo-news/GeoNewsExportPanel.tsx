"use client";

/**
 * GeoNewsExportPanel
 *
 * Floating export panel for the Geo-News layer.
 * Triggered by an "Export CSV" button added to the LayerPanel
 * item for geo-news, or from the Intel / Overlay tab.
 *
 * Features:
 *   - Date range picker (quick presets + custom From/To)
 *   - Severity multi-select chips
 *   - Category multi-select chips
 *   - State text filter
 *   - Source text filter
 *   - Keyword search
 *   - Column picker (choose which fields to export)
 *   - Custom filename
 *   - Live record-count estimate
 *   - One-click download
 *
 * Usage in AppShell or LayerPanel:
 *   import { GeoNewsExportPanel } from "@/plugins/geo-news/GeoNewsExportPanel";
 *   <GeoNewsExportPanel open={exportOpen} onClose={() => setExportOpen(false)} />
 */

import React, { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
    Download, X, Calendar, Filter, Columns,
    ChevronDown, ChevronUp, Loader2, FileText,
    CheckSquare, Square,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low";
type Category =
    | "terrorism" | "banditry" | "kidnapping" | "flooding"
    | "communal-clash" | "armed-robbery" | "military-op"
    | "protest" | "accident" | "other";

interface TimePreset { label: string; hours?: number; from?: string; to?: string }
interface ExportState {
    preset: string;
    from: string;
    to: string;
    severities: Severity[];
    categories: Category[];
    states: string;
    sources: string;
    keyword: string;
    limit: number;
    columns: string[];
    filename: string;
}

// ─── Constants ────────────────────────────────────────────────

const TIME_PRESETS: TimePreset[] = [
    { label: "Last 1h", hours: 1 },
    { label: "Last 2h", hours: 2 },
    { label: "Last 6h", hours: 6 },
    { label: "Last 12h", hours: 12 },
    { label: "Last 24h", hours: 24 },
    { label: "Last 48h", hours: 48 },
    { label: "Last 7d", hours: 168 },
    { label: "Last 30d", hours: 720 },
    { label: "Custom", hours: undefined },
];

const SEVERITIES: { value: Severity; label: string; color: string }[] = [
    { value: "critical", label: "Critical", color: "#ef4444" },
    { value: "high", label: "High", color: "#f97316" },
    { value: "medium", label: "Medium", color: "#f59e0b" },
    { value: "low", label: "Low", color: "#22d3ee" },
];

const CATEGORIES: { value: Category; label: string }[] = [
    { value: "terrorism", label: "Terrorism / Boko Haram" },
    { value: "banditry", label: "Banditry" },
    { value: "kidnapping", label: "Kidnapping" },
    { value: "flooding", label: "Flooding" },
    { value: "communal-clash", label: "Communal Clash" },
    { value: "armed-robbery", label: "Armed Robbery" },
    { value: "military-op", label: "Military Op" },
    { value: "protest", label: "Protest" },
    { value: "accident", label: "Accident" },
    { value: "other", label: "Other" },
];

const ALL_COLUMNS = [
    { key: "id", label: "Article ID", default: false },
    { key: "title", label: "Headline", default: true },
    { key: "summary", label: "Summary", default: true },
    { key: "source", label: "Source Name", default: true },
    { key: "source_id", label: "Source ID", default: false },
    { key: "url", label: "Article URL", default: true },
    { key: "published_at", label: "Published At", default: true },
    { key: "fetched_at", label: "Fetched At", default: false },
    { key: "category", label: "Category", default: true },
    { key: "severity", label: "Severity", default: true },
    { key: "state", label: "State", default: true },
    { key: "lga", label: "LGA", default: true },
    { key: "latitude", label: "Latitude", default: true },
    { key: "longitude", label: "Longitude", default: true },
    { key: "keywords", label: "Keywords", default: true },
    { key: "country", label: "Country", default: false },
];

const DEFAULT_COLUMNS = ALL_COLUMNS.filter(c => c.default).map(c => c.key);

// ─── Helpers ──────────────────────────────────────────────────

function nowIso(): string {
    return new Date().toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM (for datetime-local input)
}
function hoursAgoIso(h: number): string {
    return new Date(Date.now() - h * 3_600_000).toISOString().slice(0, 16);
}

function buildExportUrl(state: ExportState): string {
    const params = new URLSearchParams();

    // Date range
    if (state.preset !== "Custom") {
        const preset = TIME_PRESETS.find(p => p.label === state.preset);
        if (preset?.hours) params.set("hours", String(preset.hours));
    } else {
        if (state.from) params.set("from", new Date(state.from).toISOString());
        if (state.to) params.set("to", new Date(state.to).toISOString());
    }

    // Filters
    if (state.severities.length && state.severities.length < 4)
        params.set("severity", state.severities.join(","));

    if (state.categories.length && state.categories.length < 10)
        params.set("category", state.categories.join(","));

    if (state.states.trim())
        params.set("state", state.states.trim());

    if (state.sources.trim())
        params.set("source", state.sources.trim());

    if (state.keyword.trim())
        params.set("keyword", state.keyword.trim());

    // Output
    params.set("limit", String(state.limit));

    if (state.columns.length < ALL_COLUMNS.length)
        params.set("columns", state.columns.join(","));

    if (state.filename.trim())
        params.set("filename", state.filename.trim().replace(/\s+/g, "_"));

    return `/api/geo-news/export?${params.toString()}`;
}

// ─── Sub-components ───────────────────────────────────────────

function Section({
    title, children, defaultOpen = true,
}: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: "100%", display: "flex", alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 16px", background: "transparent",
                    border: "none", cursor: "pointer",
                    color: "var(--text-secondary)",
                    fontSize: 11, fontWeight: 600,
                    letterSpacing: "0.08em", textTransform: "uppercase",
                }}
            >
                {title}
                {open
                    ? <ChevronUp size={12} />
                    : <ChevronDown size={12} />
                }
            </button>
            {open && (
                <div style={{ padding: "0 16px 14px" }}>
                    {children}
                </div>
            )}
        </div>
    );
}

function Chip({
    label, active, color, onClick,
}: { label: string; active: boolean; color?: string; onClick: () => void }) {
    const c = color ?? "var(--accent-cyan)";
    return (
        <button
            onClick={onClick}
            style={{
                padding: "3px 10px", borderRadius: 10,
                fontSize: 11, fontWeight: 500,
                cursor: "pointer", border: "1px solid",
                borderColor: active ? c : "var(--border-subtle)",
                background: active ? `${c}18` : "transparent",
                color: active ? c : "var(--text-muted)",
                transition: "all 0.12s",
                whiteSpace: "nowrap",
            }}
        >
            {label}
        </button>
    );
}

function Input({
    label, value, onChange, type = "text", placeholder,
}: {
    label: string; value: string;
    onChange: (v: string) => void;
    type?: string; placeholder?: string;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
            <label style={{
                fontSize: 10, fontWeight: 600, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.08em",
            }}>
                {label}
            </label>
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                style={{
                    background: "var(--bg-primary)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    padding: "5px 8px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box",
                    fontFamily: "var(--font-ui)",
                }}
                onFocus={e => { e.target.style.borderColor = "var(--accent-cyan)"; }}
                onBlur={e => { e.target.style.borderColor = "var(--border-subtle)"; }}
            />
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────

interface Props {
    open: boolean;
    onClose: () => void;
}

export function GeoNewsExportPanel({ open, onClose }: Props) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const [state, setState] = useState<ExportState>({
        preset: "Last 24h",
        from: hoursAgoIso(24),
        to: nowIso(),
        severities: [],
        categories: [],
        states: "",
        sources: "",
        keyword: "",
        limit: 5000,
        columns: DEFAULT_COLUMNS,
        filename: "ncs_geointel_export",
    });

    const [downloading, setDownloading] = useState(false);
    const [lastCount, setLastCount] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState("");

    // Rebuild preview URL whenever state changes
    useEffect(() => {
        setPreviewUrl(buildExportUrl(state));
    }, [state]);

    // Update from/to when preset changes
    useEffect(() => {
        const preset = TIME_PRESETS.find(p => p.label === state.preset);
        if (preset?.hours) {
            setState(s => ({
                ...s,
                from: hoursAgoIso(preset.hours!),
                to: nowIso(),
            }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.preset]);

    const set = useCallback(<K extends keyof ExportState>(
        key: K, val: ExportState[K]
    ) => setState(s => ({ ...s, [key]: val })), []);

    const toggleSeverity = (v: Severity) =>
        set("severities", state.severities.includes(v)
            ? state.severities.filter(x => x !== v)
            : [...state.severities, v]);

    const toggleCategory = (v: Category) =>
        set("categories", state.categories.includes(v)
            ? state.categories.filter(x => x !== v)
            : [...state.categories, v]);

    const toggleColumn = (key: string) =>
        set("columns", state.columns.includes(key)
            ? state.columns.filter(k => k !== key)
            : [...state.columns, key]);

    const selectAllCols = () => set("columns", ALL_COLUMNS.map(c => c.key));
    const deselectAllCols = () => set("columns", ["title", "published_at", "category", "severity", "state"]);

    // ── Download ────────────────────────────────────────────────
    const handleDownload = async () => {
        setDownloading(true);
        setError(null);
        setLastCount(null);

        try {
            const url = buildExportUrl(state);
            const res = await fetch(url);

            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                throw new Error(json.error ?? `HTTP ${res.status}`);
            }

            const count = parseInt(res.headers.get("X-Record-Count") ?? "0", 10);
            setLastCount(count);

            if (count === 0) {
                setError("No records matched your filters. Try widening the date range or removing filters.");
                setDownloading(false);
                return;
            }

            // Trigger browser download
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const date = new Date().toISOString().slice(0, 10);
            a.href = objectUrl;
            a.download = `${state.filename || "ncs_export"}_${date}.csv`;
            a.click();
            URL.revokeObjectURL(objectUrl);

        } catch (err: any) {
            setError(err.message ?? "Download failed");
        } finally {
            setDownloading(false);
        }
    };

    if (!open || !mounted) return null;

    return createPortal(
        <>
            {/* Backdrop */}
            <div
                onClick={onClose}
                style={{
                    position: "fixed", inset: 0,
                    background: "rgba(0,0,0,0.4)",
                    zIndex: 400,
                }}
            />

            {/* Panel */}
            <div style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                zIndex: 401,
                width: "min(600px, 96vw)",
                maxHeight: "85vh",
                display: "flex",
                flexDirection: "column",
                background: "var(--bg-secondary)",
                backdropFilter: "blur(20px)",
                border: "1px solid var(--border-medium)",
                borderRadius: 12,
                boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
                overflow: "hidden",
            }}>

                {/* Header */}
                <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "14px 16px",
                    borderBottom: "1px solid var(--border-subtle)",
                    flexShrink: 0,
                }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: "rgba(34,211,238,0.12)",
                        border: "1px solid rgba(34,211,238,0.3)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        <Download size={15} color="var(--accent-cyan)" />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{
                            fontSize: 14, fontWeight: 700,
                            color: "var(--text-primary)", letterSpacing: "0.02em",
                        }}>
                            Export Geo-News Data
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                            CSV · Supabase · NCS GeoIntel
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: "transparent", border: "none",
                            cursor: "pointer", color: "var(--text-muted)",
                            padding: 4, display: "flex",
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Scrollable body */}
                <div style={{ overflowY: "auto", flex: 1 }}>

                    {/* ── Time Range ─────────────────────────── */}
                    <Section title="Time Range" defaultOpen>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                            {TIME_PRESETS.map(p => (
                                <Chip
                                    key={p.label}
                                    label={p.label}
                                    active={state.preset === p.label}
                                    onClick={() => set("preset", p.label)}
                                />
                            ))}
                        </div>

                        {state.preset === "Custom" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                <Input
                                    label="From"
                                    type="datetime-local"
                                    value={state.from}
                                    onChange={v => set("from", v)}
                                />
                                <Input
                                    label="To"
                                    type="datetime-local"
                                    value={state.to}
                                    onChange={v => set("to", v)}
                                />
                            </div>
                        )}
                    </Section>

                    {/* ── Severity ───────────────────────────── */}
                    <Section title="Severity" defaultOpen>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {SEVERITIES.map(s => (
                                <Chip
                                    key={s.value}
                                    label={s.label}
                                    active={state.severities.includes(s.value)}
                                    color={s.color}
                                    onClick={() => toggleSeverity(s.value)}
                                />
                            ))}
                        </div>
                        {state.severities.length === 0 && (
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                                No filter — all severity levels included
                            </div>
                        )}
                    </Section>

                    {/* ── Category ───────────────────────────── */}
                    <Section title="Event Category" defaultOpen>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {CATEGORIES.map(c => (
                                <Chip
                                    key={c.value}
                                    label={c.label}
                                    active={state.categories.includes(c.value)}
                                    onClick={() => toggleCategory(c.value)}
                                />
                            ))}
                        </div>
                        {state.categories.length === 0 && (
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
                                No filter — all categories included
                            </div>
                        )}
                    </Section>

                    {/* ── Location & Keyword ─────────────────── */}
                    <Section title="Location & Keyword" defaultOpen={false}>
                        <Input
                            label="State (comma-separated)"
                            value={state.states}
                            onChange={v => set("states", v)}
                            placeholder="e.g. Borno, Zamfara, Kaduna"
                        />
                        <Input
                            label="Keyword (searches title + summary)"
                            value={state.keyword}
                            onChange={v => set("keyword", v)}
                            placeholder="e.g. bandits, explosion, flood"
                        />
                        <Input
                            label="Source ID (comma-separated)"
                            value={state.sources}
                            onChange={v => set("sources", v)}
                            placeholder="e.g. punch, channels, bbc_africa"
                        />
                    </Section>

                    {/* ── Columns ────────────────────────────── */}
                    <Section title="Columns to Export" defaultOpen={false}>
                        <div style={{
                            display: "flex", gap: 6, marginBottom: 8,
                        }}>
                            <button
                                onClick={selectAllCols}
                                style={{
                                    fontSize: 10, padding: "2px 8px",
                                    borderRadius: 4, cursor: "pointer",
                                    border: "1px solid var(--border-subtle)",
                                    background: "transparent",
                                    color: "var(--accent-cyan)",
                                }}
                            >
                                Select all
                            </button>
                            <button
                                onClick={deselectAllCols}
                                style={{
                                    fontSize: 10, padding: "2px 8px",
                                    borderRadius: 4, cursor: "pointer",
                                    border: "1px solid var(--border-subtle)",
                                    background: "transparent",
                                    color: "var(--text-muted)",
                                }}
                            >
                                Essential only
                            </button>
                        </div>
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 4,
                        }}>
                            {ALL_COLUMNS.map(col => {
                                const active = state.columns.includes(col.key);
                                return (
                                    <button
                                        key={col.key}
                                        onClick={() => toggleColumn(col.key)}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 6,
                                            padding: "5px 8px", borderRadius: 5,
                                            border: "1px solid",
                                            borderColor: active ? "var(--border-medium)" : "var(--border-subtle)",
                                            background: active ? "var(--bg-tertiary)" : "transparent",
                                            cursor: "pointer", textAlign: "left",
                                        }}
                                    >
                                        {active
                                            ? <CheckSquare size={12} color="var(--accent-cyan)" />
                                            : <Square size={12} color="var(--text-muted)" />
                                        }
                                        <span style={{
                                            fontSize: 11,
                                            color: active ? "var(--text-primary)" : "var(--text-muted)",
                                        }}>
                                            {col.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </Section>

                    {/* ── Output Options ─────────────────────── */}
                    <Section title="Output Options" defaultOpen={false}>
                        <Input
                            label="Filename (without .csv)"
                            value={state.filename}
                            onChange={v => set("filename", v)}
                            placeholder="ncs_geointel_export"
                        />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
                            <label style={{
                                fontSize: 10, fontWeight: 600,
                                color: "var(--text-muted)",
                                textTransform: "uppercase", letterSpacing: "0.08em",
                            }}>
                                Max records
                            </label>
                            <select
                                value={state.limit}
                                onChange={e => set("limit", parseInt(e.target.value, 10))}
                                style={{
                                    background: "var(--bg-primary)",
                                    border: "1px solid var(--border-subtle)",
                                    borderRadius: "var(--radius-sm)",
                                    color: "var(--text-primary)",
                                    fontSize: 12, padding: "5px 8px",
                                    outline: "none", fontFamily: "var(--font-ui)",
                                }}
                            >
                                {[500, 1000, 2000, 5000, 10000, 50000].map(n => (
                                    <option key={n} value={n}>{n.toLocaleString()} rows</option>
                                ))}
                            </select>
                        </div>
                    </Section>

                </div>

                {/* ── Footer ────────────────────────────────── */}
                <div style={{
                    padding: "12px 16px",
                    borderTop: "1px solid var(--border-subtle)",
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                }}>

                    {/* Error */}
                    {error && (
                        <div style={{
                            padding: "8px 10px", borderRadius: 6,
                            background: "rgba(239,68,68,0.1)",
                            border: "1px solid rgba(239,68,68,0.3)",
                            color: "#ef4444", fontSize: 11,
                        }}>
                            {error}
                        </div>
                    )}

                    {/* Success count */}
                    {lastCount !== null && !error && (
                        <div style={{
                            padding: "6px 10px", borderRadius: 6,
                            background: "rgba(34,211,238,0.08)",
                            border: "1px solid rgba(34,211,238,0.25)",
                            color: "var(--accent-cyan)", fontSize: 11,
                        }}>
                            ✓ Downloaded {lastCount.toLocaleString()} records
                        </div>
                    )}

                    {/* Preview URL */}
                    <div style={{
                        display: "flex", gap: 6, alignItems: "flex-start",
                    }}>
                        <code style={{
                            flex: 1, fontSize: 9, fontFamily: "var(--font-mono)",
                            color: "var(--text-muted)", wordBreak: "break-all",
                            background: "var(--bg-primary)",
                            padding: "4px 6px", borderRadius: 4,
                            border: "1px solid var(--border-subtle)",
                        }}>
                            {previewUrl}
                        </code>
                        <button
                            onClick={() => navigator.clipboard.writeText(
                                window.location.origin + previewUrl
                            )}
                            title="Copy URL"
                            style={{
                                padding: "4px 6px", borderRadius: 4,
                                border: "1px solid var(--border-subtle)",
                                background: "transparent",
                                color: "var(--text-muted)", cursor: "pointer",
                                fontSize: 10, flexShrink: 0,
                            }}
                        >
                            Copy
                        </button>
                    </div>

                    {/* Download button */}
                    <button
                        onClick={handleDownload}
                        disabled={downloading || state.columns.length === 0}
                        style={{
                            display: "flex", alignItems: "center",
                            justifyContent: "center", gap: 8,
                            padding: "10px 0",
                            borderRadius: 8,
                            border: "1px solid rgba(34,211,238,0.4)",
                            background: downloading
                                ? "rgba(34,211,238,0.08)"
                                : "rgba(34,211,238,0.15)",
                            color: "var(--accent-cyan)",
                            fontSize: 13, fontWeight: 700,
                            letterSpacing: "0.06em", textTransform: "uppercase",
                            cursor: downloading ? "not-allowed" : "pointer",
                            opacity: state.columns.length === 0 ? 0.4 : 1,
                            transition: "all 0.15s",
                        }}
                    >
                        {downloading
                            ? <><Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Exporting...</>
                            : <><Download size={15} /> Download CSV</>
                        }
                    </button>
                </div>
            </div>

            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </>,
        document.body
    );
}

// ─── Trigger button (add this to LayerPanel geo-news item) ────

export function GeoNewsExportButton() {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="btn btn--icon"
                title="Export geo-news data as CSV"
                style={{ position: "relative" }}
            >
                <Download size={13} />
            </button>
            <GeoNewsExportPanel open={open} onClose={() => setOpen(false)} />
        </>
    );
}