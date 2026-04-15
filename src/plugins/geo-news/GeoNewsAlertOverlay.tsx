"use client";

/**
 * GeoNewsAlertOverlay
 *
 * Two components in one file:
 *
 *   <GeoNewsAlertToast />  — auto-dismissing toast that fires when a new
 *                            alert arrives that hasn't been toasted yet.
 *                            Shows one at a time; queues additional alerts.
 *                            Positioned bottom-right, above the timeline.
 *
 *   <GeoNewsAlertsPanel /> — slide-in panel (triggered by the bell button
 *                            or by clicking a toast) that lists ALL alerts
 *                            with filter controls and dismiss actions.
 *
 *   <GeoNewsAlertOverlay /> — mounts both; this is what goes in AppShell.
 *
 * Mount in AppShell.tsx:
 *   import { GeoNewsAlertOverlay } from "@/plugins/geo-news/GeoNewsAlertOverlay";
 *   // inside the return JSX, after <FloatingVideoManager />:
 *   <GeoNewsAlertOverlay />
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
    AlertTriangle, X, Bell, BellOff, ExternalLink,
    Shield, Zap, Newspaper, ChevronRight, Filter
} from "lucide-react";
import { useStore } from "@/core/state/store";
import type { GeoAlert, AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";
import { dataBus } from "@/core/data/DataBus";

// ─── Constants ────────────────────────────────────────────────

const TOAST_DURATION_MS = 8000;

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
    critical: "#ef4444",
    high:     "#f97316",
    medium:   "#f59e0b",
    low:      "#22d3ee",
};

const CATEGORY_LABEL: Record<AlertCategory, string> = {
    terrorism:        "Terrorism",
    banditry:         "Banditry",
    kidnapping:       "Kidnapping",
    flooding:         "Flooding",
    "communal-clash": "Communal Clash",
    "armed-robbery":  "Armed Robbery",
    "military-op":    "Military Op",
    protest:          "Protest",
    accident:         "Accident",
    other:            "Incident",
};

const CATEGORY_ICON: Record<AlertCategory, React.FC<{ size?: number; color?: string }>> = {
    terrorism:        Shield,
    banditry:         Zap,
    kidnapping:       AlertTriangle,
    flooding:         AlertTriangle,
    "communal-clash": AlertTriangle,
    "armed-robbery":  Zap,
    "military-op":    Shield,
    protest:          Zap,
    accident:         AlertTriangle,
    other:            Newspaper,
};

function timeAgo(date: Date): string {
    const diff = Date.now() - date.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)   return "just now";
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// ─── Toast component ──────────────────────────────────────────

function GeoNewsAlertToast() {
    const alerts          = useStore((s) => s.alerts);
    const markToasted     = useStore((s) => s.markToasted);
    const dismissAlert    = useStore((s) => s.dismissAlert);
    const setAlertsPanelOpen = useStore((s) => s.setAlertsPanelOpen);

    const [current, setCurrent] = useState<GeoAlert | null>(null);
    const [visible, setVisible] = useState(false);
    const [progress, setProgress] = useState(100);
    const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startRef    = useRef<number>(0);

    // Queue: alerts that haven't been toasted yet, sorted critical first
    const queue = alerts
        .filter(a => !a.toasted && !a.dismissed)
        .sort((a, b) => {
            const rank: Record<AlertSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
            return rank[a.severity] - rank[b.severity];
        });

    const dismiss = useCallback(() => {
        setVisible(false);
        if (timerRef.current)    clearTimeout(timerRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        setTimeout(() => setCurrent(null), 300); // wait for fade out
    }, []);

    // Show next queued alert
    useEffect(() => {
        if (current || queue.length === 0) return;

        const next = queue[0];
        markToasted(next.id);
        setCurrent(next);
        setVisible(true);
        setProgress(100);
        startRef.current = Date.now();

        // Progress bar countdown
        intervalRef.current = setInterval(() => {
            const elapsed = Date.now() - startRef.current;
            setProgress(Math.max(0, 100 - (elapsed / TOAST_DURATION_MS) * 100));
        }, 50);

        // Auto dismiss
        timerRef.current = setTimeout(() => {
            dismiss();
        }, TOAST_DURATION_MS);

        return () => {
            if (timerRef.current)    clearTimeout(timerRef.current);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue.length, current]);

    if (!current) return null;

    const color   = SEVERITY_COLOR[current.severity];
    const CatIcon = CATEGORY_ICON[current.category] ?? Newspaper;

    // Fly camera to the alert location on click
    const flyTo = () => {
        dataBus.emit("cameraGoTo", {
            lat:      current.latitude,
            lon:      current.longitude,
            alt:      0,
            distance: 200_000,
            maxPitch: -35,
        });
        setAlertsPanelOpen(true);
        dismiss();
    };

    return (
        <div style={{
            position:  "fixed",
            bottom:    160,   // above timeline
            right:     24,
            width:     340,
            zIndex:    300,
            opacity:   visible ? 1 : 0,
            transform: visible ? "translateX(0)" : "translateX(360px)",
            transition: "opacity 0.3s, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)",
            pointerEvents: visible ? "auto" : "none",
        }}>
            <div style={{
                background:     "var(--bg-glass)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border:         `1px solid ${color}55`,
                borderLeft:     `3px solid ${color}`,
                borderRadius:   10,
                overflow:       "hidden",
                boxShadow:      `0 8px 32px rgba(0,0,0,0.5), 0 0 20px ${color}22`,
            }}>
                {/* Progress bar */}
                <div style={{
                    height:     2,
                    background: `${color}33`,
                    position:   "relative",
                }}>
                    <div style={{
                        position:   "absolute", left: 0, top: 0, bottom: 0,
                        width:      `${progress}%`,
                        background: color,
                        transition: "width 0.05s linear",
                    }} />
                </div>

                {/* Content */}
                <div style={{ padding: "12px 14px" }}>
                    {/* Header row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <div style={{
                            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                            background: `${color}22`, border: `1px solid ${color}44`,
                            display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                            <CatIcon size={14} color={color} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                                fontSize: 10, fontWeight: 700, color,
                                textTransform: "uppercase", letterSpacing: "0.1em",
                            }}>
                                {CATEGORY_LABEL[current.category]} · {current.severity.toUpperCase()}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                                {current.state}{current.lga ? ` — ${current.lga}` : ""} · {timeAgo(current.fetchedAt)}
                            </div>
                        </div>
                        <button
                            onClick={(e) => { e.stopPropagation(); dismiss(); dismissAlert(current.id); }}
                            style={{
                                background: "transparent", border: "none",
                                color: "var(--text-muted)", cursor: "pointer",
                                padding: 2, display: "flex",
                            }}
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {/* Title */}
                    <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: "var(--text-primary)", lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        marginBottom: 10,
                    } as React.CSSProperties}>
                        {current.title}
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 6 }}>
                        <button
                            onClick={flyTo}
                            style={{
                                flex: 1, padding: "6px 0",
                                background: `${color}18`, border: `1px solid ${color}44`,
                                borderRadius: 6, color,
                                fontSize: 10, fontWeight: 700,
                                letterSpacing: "0.08em", textTransform: "uppercase",
                                cursor: "pointer", display: "flex",
                                alignItems: "center", justifyContent: "center", gap: 4,
                            }}
                        >
                            <ChevronRight size={11} /> View on Map
                        </button>
                        <a
                            href={current.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                padding: "6px 10px",
                                background: "var(--bg-tertiary)",
                                border: "1px solid var(--border-subtle)",
                                borderRadius: 6, color: "var(--text-muted)",
                                fontSize: 10, cursor: "pointer",
                                display: "flex", alignItems: "center",
                                textDecoration: "none",
                            }}
                        >
                            <ExternalLink size={11} />
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── Alerts Panel ─────────────────────────────────────────────

function GeoNewsAlertsPanel() {
    const alerts         = useStore((s) => s.alerts);
    const alertsPanelOpen= useStore((s) => s.alertsPanelOpen);
    const dismissAlert   = useStore((s) => s.dismissAlert);
    const dismissAll     = useStore((s) => s.dismissAll);
    const setAlertsPanelOpen = useStore((s) => s.setAlertsPanelOpen);

    const [filter, setFilter] = useState<AlertCategory | "all">("all");
    const [showDismissed, setShowDismissed] = useState(false);

    const filtered = alerts.filter(a => {
        if (!showDismissed && a.dismissed) return false;
        if (filter !== "all" && a.category !== filter) return false;
        return true;
    });

    return (
        <div style={{
            position: "fixed",
            top:      80,
            right:    24,
            bottom:   150,
            width:    360,
            zIndex:   200,
            opacity:  alertsPanelOpen ? 1 : 0,
            transform: alertsPanelOpen ? "translateX(0)" : "translateX(384px)",
            transition: "opacity 0.3s, transform 0.35s cubic-bezier(0.4,0,0.2,1)",
            pointerEvents: alertsPanelOpen ? "auto" : "none",
            display: "flex",
            flexDirection: "column",
            background:     "var(--bg-glass)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border:    "1px solid var(--border-medium)",
            borderRadius: 12,
            overflow: "hidden",
        }}>
            {/* Header */}
            <div style={{
                padding: "14px 16px 10px",
                borderBottom: "1px solid var(--border-subtle)",
                display: "flex", alignItems: "center", gap: 8,
            }}>
                <Bell size={15} color="var(--accent-cyan)" />
                <span style={{
                    flex: 1, fontSize: 13, fontWeight: 700,
                    color: "var(--text-primary)", letterSpacing: "0.04em",
                }}>
                    Intelligence Alerts
                </span>
                <span style={{
                    background: "rgba(239,68,68,0.2)", color: "#ef4444",
                    fontSize: 10, fontWeight: 700, padding: "2px 7px",
                    borderRadius: 10, border: "1px solid rgba(239,68,68,0.35)",
                }}>
                    {alerts.filter(a => !a.dismissed).length}
                </span>
                <button
                    onClick={() => setAlertsPanelOpen(false)}
                    style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, display: "flex" }}
                >
                    <X size={15} />
                </button>
            </div>

            {/* Filter chips */}
            <div style={{
                display: "flex", gap: 4, padding: "8px 12px",
                overflowX: "auto", scrollbarWidth: "none",
                borderBottom: "1px solid var(--border-subtle)",
            }}>
                {(["all", "terrorism", "banditry", "kidnapping", "flooding", "communal-clash"] as const).map(cat => (
                    <button
                        key={cat}
                        onClick={() => setFilter(cat)}
                        style={{
                            padding: "3px 10px", borderRadius: 10, fontSize: 10,
                            fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
                            border: "1px solid",
                            borderColor: filter === cat ? "var(--accent-cyan)" : "var(--border-subtle)",
                            background:  filter === cat ? "rgba(34,211,238,0.12)" : "transparent",
                            color:       filter === cat ? "var(--accent-cyan)" : "var(--text-muted)",
                        }}
                    >
                        {cat === "all" ? "All" : CATEGORY_LABEL[cat]}
                    </button>
                ))}
            </div>

            {/* Alert list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
                {filtered.length === 0 ? (
                    <div style={{
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        height: "100%", color: "var(--text-muted)",
                        fontSize: 12, gap: 8,
                    }}>
                        <BellOff size={24} />
                        <span>No alerts</span>
                    </div>
                ) : (
                    filtered.map(alert => {
                        const color   = SEVERITY_COLOR[alert.severity];
                        const CatIcon = CATEGORY_ICON[alert.category] ?? Newspaper;
                        return (
                            <div
                                key={alert.id}
                                style={{
                                    margin: "0 8px 6px",
                                    padding: "10px 12px",
                                    borderRadius: 8,
                                    border:    `1px solid ${alert.dismissed ? "var(--border-subtle)" : color + "44"}`,
                                    borderLeft:`3px solid ${alert.dismissed ? "var(--border-subtle)" : color}`,
                                    background: alert.dismissed ? "transparent" : `${color}08`,
                                    opacity:   alert.dismissed ? 0.5 : 1,
                                    cursor:    "pointer",
                                    transition:"all 0.15s",
                                }}
                                onClick={() => {
                                    dataBus.emit("cameraGoTo", {
                                        lat: alert.latitude, lon: alert.longitude,
                                        alt: 0, distance: 200_000, maxPitch: -35,
                                    });
                                }}
                            >
                                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                    {/* <CatIcon size={13} color={color} style={{ flexShrink: 0, marginTop: 1 }} /> */}
                                    <CatIcon size={13} color={color}  />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 11, fontWeight: 600,
                                            color: "var(--text-primary)", lineHeight: 1.35,
                                            marginBottom: 4,
                                            display: "-webkit-box",
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: "vertical",
                                            overflow: "hidden",
                                        } as React.CSSProperties}>
                                            {alert.title}
                                        </div>
                                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                            <span style={{
                                                fontSize: 9, fontWeight: 700, color,
                                                textTransform: "uppercase",
                                            }}>
                                                {alert.severity}
                                            </span>
                                            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>·</span>
                                            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{alert.state}</span>
                                            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>·</span>
                                            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{timeAgo(alert.fetchedAt)}</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); dismissAlert(alert.id); }}
                                        style={{
                                            background: "transparent", border: "none",
                                            cursor: "pointer", color: "var(--text-muted)",
                                            padding: 2, display: "flex", flexShrink: 0,
                                        }}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Footer actions */}
            <div style={{
                padding: "8px 12px",
                borderTop: "1px solid var(--border-subtle)",
                display: "flex", gap: 6,
            }}>
                <button
                    onClick={() => setShowDismissed(s => !s)}
                    style={{
                        flex: 1, padding: "6px 0",
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border-subtle)",
                        borderRadius: 6, color: "var(--text-muted)",
                        fontSize: 10, fontWeight: 500, cursor: "pointer",
                    }}
                >
                    {showDismissed ? "Hide dismissed" : "Show dismissed"}
                </button>
                <button
                    onClick={dismissAll}
                    style={{
                        flex: 1, padding: "6px 0",
                        background: "rgba(239,68,68,0.08)",
                        border: "1px solid rgba(239,68,68,0.25)",
                        borderRadius: 6, color: "#ef4444",
                        fontSize: 10, fontWeight: 600, cursor: "pointer",
                        textTransform: "uppercase", letterSpacing: "0.06em",
                    }}
                >
                    Dismiss all
                </button>
            </div>
        </div>
    );
}

// ─── Bell button (mounts in header area) ─────────────────────

export function GeoNewsAlertBell() {
    const unreadCount    = useStore((s) => s.unreadCount);
    const toggleAlertsPanel = useStore((s) => s.toggleAlertsPanel);

    return (
        <button
            className="btn btn--icon"
            onClick={toggleAlertsPanel}
            title="Intelligence Alerts"
            style={{ position: "relative" }}
        >
            <Bell size={16} />
            {unreadCount > 0 && (
                <span style={{
                    position: "absolute", top: -4, right: -4,
                    minWidth: 16, height: 16,
                    background: "#ef4444", color: "#fff",
                    fontSize: 9, fontWeight: 700,
                    borderRadius: 8, display: "flex",
                    alignItems: "center", justifyContent: "center",
                    padding: "0 3px",
                    boxShadow: "0 0 8px rgba(239,68,68,0.6)",
                }}>
                    {unreadCount > 99 ? "99+" : unreadCount}
                </span>
            )}
        </button>
    );
}

// ─── Root export ──────────────────────────────────────────────

export function GeoNewsAlertOverlay() {
    return (
        <>
            <GeoNewsAlertToast />
            <GeoNewsAlertsPanel />
        </>
    );
}