"use client";

import React from "react";
import {
    Newspaper, MapPin, ExternalLink, Tag, AlertTriangle,
    Clock, Shield, Zap
} from "lucide-react";
import type { GeoEntity } from "@/core/plugins/PluginTypes";
import type { AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";

interface Props { entity: GeoEntity; }

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
    critical: "#ef4444",
    high:     "#f97316",
    medium:   "#f59e0b",
    low:      "#22d3ee",
};

const SEVERITY_BG: Record<AlertSeverity, string> = {
    critical: "rgba(239,68,68,0.12)",
    high:     "rgba(249,115,22,0.12)",
    medium:   "rgba(245,158,11,0.12)",
    low:      "rgba(34,211,238,0.10)",
};

const CATEGORY_LABEL: Record<AlertCategory, string> = {
    terrorism:        "Terrorism / Boko Haram",
    banditry:         "Banditry",
    kidnapping:       "Kidnapping",
    flooding:         "Flooding",
    "communal-clash": "Communal Clash",
    "armed-robbery":  "Armed Robbery",
    "military-op":    "Military Operation",
    protest:          "Protest / Unrest",
    accident:         "Accident",
    other:            "Other",
};

const CATEGORY_ICON: Record<AlertCategory, React.FC<any>> = {
    terrorism:        Shield,
    banditry:         Zap,
    kidnapping:       AlertTriangle,
    flooding:         Zap,
    "communal-clash": AlertTriangle,
    "armed-robbery":  Zap,
    "military-op":    Shield,
    protest:          Zap,
    accident:         AlertTriangle,
    other:            Newspaper,
};

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

export function GeoNewsDetail({ entity }: Props) {
    const p           = entity.properties;
    const severity    = p.severity    as AlertSeverity;
    const category    = p.category    as AlertCategory;
    const title       = p.title       as string;
    const summary     = p.summary     as string;
    const source      = p.source      as string;
    const url         = p.url         as string;
    const imageUrl    = p.imageUrl    as string | null;
    const state       = p.state       as string;
    const lga         = p.lga         as string | null;
    const keywords    = p.keywords    as string[];
    const publishedAt = p.publishedAt as string;

    const color     = SEVERITY_COLOR[severity];
    const bg        = SEVERITY_BG[severity];
    const CatIcon   = CATEGORY_ICON[category] ?? Newspaper;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Severity + category header */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6,
                background: bg, border: `1px solid ${color}44`,
            }}>
                <CatIcon size={16} color={color} style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {CATEGORY_LABEL[category]}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>
                        Severity: <span style={{ color, fontWeight: 600 }}>{severity.toUpperCase()}</span>
                    </div>
                </div>
            </div>

            {/* Article image if available */}
            {imageUrl && (
                <img
                    src={imageUrl}
                    alt=""
                    style={{
                        width: "100%", borderRadius: 6,
                        objectFit: "cover", maxHeight: 120,
                        border: "1px solid var(--border-subtle)",
                    }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
            )}

            {/* Title */}
            <div style={{
                fontSize: 13, fontWeight: 600,
                color: "var(--text-primary)", lineHeight: 1.4,
            }}>
                {title}
            </div>

            {/* Summary */}
            {summary && summary !== title && (
                <div style={{
                    fontSize: 11, color: "var(--text-secondary)",
                    lineHeight: 1.5,
                    display: "-webkit-box",
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                } as React.CSSProperties}>
                    {summary}
                </div>
            )}

            {/* Meta row */}
            <div style={{
                display: "flex", flexDirection: "column", gap: 4,
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Source</span>
                    <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 500 }}>{source}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>State</span>
                    <span style={{ fontSize: 11, color: "var(--text-primary)", fontWeight: 500 }}>{state}{lga ? ` — ${lga}` : ""}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Published</span>
                    <span style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                        {timeAgo(publishedAt)}
                    </span>
                </div>
            </div>

            {/* Keywords */}
            {keywords && keywords.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {keywords.slice(0, 6).map(kw => (
                        <span key={kw} style={{
                            padding: "2px 7px", borderRadius: 10,
                            fontSize: 10, fontWeight: 500,
                            background: `${color}14`,
                            border: `1px solid ${color}33`,
                            color,
                        }}>
                            {kw}
                        </span>
                    ))}
                </div>
            )}

            {/* Read full article link */}
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    gap: 6, padding: "8px 10px", borderRadius: 6,
                    background: `${color}18`, border: `1px solid ${color}44`,
                    color, textDecoration: "none",
                    fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
                    textTransform: "uppercase", cursor: "pointer",
                    transition: "all 0.15s",
                }}
            >
                <ExternalLink size={12} />
                Read Full Article
            </a>

            {/* Coordinates */}
            <div style={{
                display: "flex", justifyContent: "space-between",
                paddingTop: 8, borderTop: "1px solid var(--border-subtle)",
                fontFamily: "var(--font-mono)", fontSize: 11,
                color: "var(--text-muted)",
            }}>
                <span>{entity.latitude.toFixed(4)}° N</span>
                <span>{entity.longitude.toFixed(4)}° E</span>
            </div>
        </div>
    );
}