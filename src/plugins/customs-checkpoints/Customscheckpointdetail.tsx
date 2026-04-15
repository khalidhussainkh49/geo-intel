"use client";

import React from "react";
import { ShieldCheck, MapPin, Navigation, Clock, Users, Scan, Scale, Map, AlertTriangle } from "lucide-react";
import type { GeoEntity } from "@/core/plugins/PluginTypes";
import { checkpointColor, checkpointTypeLabel, type CheckpointType } from "./Customscheckpointsdata";

interface Props { entity: GeoEntity; }

const ZONE_LABELS: Record<string, string> = {
    A: "Zone A — South-West",
    B: "Zone B — North-West",
    C: "Zone C — North Central",
    D: "Zone D — South-East",
    E: "Zone E — North-East",
};

const DIRECTION_ICON: Record<string, string> = {
    Inbound:  "→  Inbound",
    Outbound: "←  Outbound",
    Both:     "⇄  Both directions",
};

export function CustomsCheckpointDetail({ entity }: Props) {
    const p             = entity.properties;
    const type          = p.type           as CheckpointType;
    const zone          = p.zone           as string;
    const state         = p.state          as string;
    const road          = p.road           as string;
    const direction     = p.direction      as string | null;
    const opHours       = p.operatingHours as string;
    const staffing      = p.staffing       as string;
    const hasScanner    = p.scanner        as boolean;
    const hasWeighbridge= p.weighbridge    as boolean;
    const notes         = p.notes          as string | null;

    const color     = checkpointColor(type);
    const typeLabel = checkpointTypeLabel(type);

    const is24h = opHours === "24/7";

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Type badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                    width: 36, height: 36,
                    borderRadius: 6,
                    background: `${color}22`,
                    border: `1px solid ${color}55`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}>
                    <ShieldCheck size={17} color={color} />
                </div>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color }}>
                        {typeLabel}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        Nigeria Customs Service
                    </div>
                </div>

                {/* Equipment badges — scanner / weighbridge */}
                <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                    {hasScanner && (
                        <span title="X-Ray Scanner" style={{
                            display: "flex", alignItems: "center", gap: 3,
                            padding: "2px 7px", borderRadius: 10,
                            background: "rgba(245,158,11,0.15)",
                            border: "1px solid rgba(245,158,11,0.35)",
                            fontSize: 9, fontWeight: 700, color: "#f59e0b",
                        }}>
                            <Scan size={9} /> SCAN
                        </span>
                    )}
                    {hasWeighbridge && (
                        <span title="Weighbridge" style={{
                            display: "flex", alignItems: "center", gap: 3,
                            padding: "2px 7px", borderRadius: 10,
                            background: "rgba(167,139,250,0.15)",
                            border: "1px solid rgba(167,139,250,0.35)",
                            fontSize: 9, fontWeight: 700, color: "#a78bfa",
                        }}>
                            <Scale size={9} /> WB
                        </span>
                    )}
                </div>
            </div>

            {/* Zone banner */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px", borderRadius: 6,
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
            }}>
                <Map size={12} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 1 }}>NCS Zone</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
                        {ZONE_LABELS[zone] ?? zone}
                    </div>
                </div>
            </div>

            {/* Properties grid */}
            <div>
                {([
                    ["State",     state,   null],
                    ["Direction", direction ? (DIRECTION_ICON[direction] ?? direction) : "Both", null],
                    ["Hours",     opHours,  is24h ? "#22c55e" : null],
                    ["Staffing",  staffing, null],
                ] as [string, string | null, string | null][])
                    .filter(([, v]) => v)
                    .map(([k, v, vc]) => (
                        <div key={k} style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: "5px 0",
                            borderBottom: "1px solid var(--border-subtle)",
                        }}>
                            <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</span>
                            <span style={{ fontSize: 11, color: vc ?? "var(--text-primary)", fontWeight: 500, fontFamily: k === "Hours" ? "var(--font-mono)" : undefined }}>
                                {v}
                            </span>
                        </div>
                    ))}
            </div>

            {/* Road */}
            <div style={{
                display: "flex", gap: 8,
                padding: "7px 10px", borderRadius: 6,
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
            }}>
                <Navigation size={12} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 2 }}>Road / Route</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>{road}</div>
                </div>
            </div>

            {/* Notes — if any */}
            {notes && (
                <div style={{
                    display: "flex", gap: 8,
                    padding: "7px 10px", borderRadius: 6,
                    background: "rgba(245,158,11,0.06)",
                    border: "1px solid rgba(245,158,11,0.25)",
                }}>
                    <AlertTriangle size={12} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 11, color: "#d4b565", lineHeight: 1.4 }}>{notes}</span>
                </div>
            )}

            {/* Operating hours indicator */}
            <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px", borderRadius: 6,
                background: is24h ? "rgba(34,197,94,0.07)" : "rgba(245,158,11,0.07)",
                border: `1px solid ${is24h ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)"}`,
            }}>
                <Clock size={12} color={is24h ? "#22c55e" : "#f59e0b"} />
                <span style={{ fontSize: 11, color: is24h ? "#22c55e" : "#d4b565", fontWeight: 600 }}>
                    {is24h ? "24 / 7 Operation" : `Hours: ${opHours}`}
                </span>
            </div>

            {/* Coordinates */}
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                paddingTop: 8,
                borderTop: "1px solid var(--border-subtle)",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-muted)",
            }}>
                <span>{entity.latitude.toFixed(4)}° N</span>
                <span>{entity.longitude.toFixed(4)}° E</span>
            </div>
        </div>
    );
}