"use client";

/**
 * CustomsOfficeDetail
 * Renders inside the Intel panel when a customs office marker is clicked.
 * Registered via plugin.getDetailComponent() on CustomsOfficesPlugin.
 */

import React from "react";
import { Building2, MapPin, Phone, Mail, Shield, Map } from "lucide-react";
import type { GeoEntity } from "@/core/plugins/PluginTypes";
import { officeColor, officeTypeLabel, type OfficeType } from "./customsOfficesData";

interface Props { entity: GeoEntity; }

const ZONE_LABELS: Record<string, string> = {
    A:  "Zone A — South-West",
    B:  "Zone B — North-West",
    C:  "Zone C — North Central",
    D:  "Zone D — South-East",
    E:  "Zone E — North-East",
    HQ: "National Headquarters",
};

export function CustomsOfficeDetail({ entity }: Props) {
    const p      = entity.properties;
    const type   = p.type   as OfficeType;
    const zone   = p.zone   as string;
    const state  = p.state  as string;
    const address= p.address as string;
    const phone  = p.phone  as string | undefined;
    const email  = p.email  as string | undefined;

    const color     = officeColor(type);
    const typeLabel = officeTypeLabel(type);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

            {/* Type badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: `${color}22`,
                    border: `1px solid ${color}55`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                }}>
                    <Building2 size={18} color={color} />
                </div>
                <div>
                    <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color,
                    }}>
                        {typeLabel}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        Nigeria Customs Service
                    </div>
                </div>
            </div>

            {/* Zone banner */}
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
            }}>
                <Map size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 1 }}>NCS Zone</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                        {ZONE_LABELS[zone] ?? zone}
                    </div>
                </div>
            </div>

            {/* Properties */}
            <div>
                {[
                    ["State",   state],
                ].map(([k, v]) => (
                    <div key={k} style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "5px 0",
                        borderBottom: "1px solid var(--border-subtle)",
                    }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{k}</span>
                        <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 500 }}>{v}</span>
                    </div>
                ))}
            </div>

            {/* Address */}
            <div style={{
                display: "flex",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: "var(--bg-tertiary)",
                border: "1px solid var(--border-subtle)",
            }}>
                <MapPin size={13} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {address}
                </span>
            </div>

            {/* Contact details — only if available */}
            {(phone || email) && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {phone && (
                        <a href={`tel:${phone}`} style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--border-subtle)",
                            background: "transparent",
                            color: "var(--text-secondary)",
                            textDecoration: "none",
                            fontSize: 12,
                            transition: "all 0.15s",
                            cursor: "pointer",
                        }}>
                            <Phone size={13} />
                            {phone}
                        </a>
                    )}
                    {email && (
                        <a href={`mailto:${email}`} style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--border-subtle)",
                            background: "transparent",
                            color: "var(--accent-cyan)",
                            textDecoration: "none",
                            fontSize: 12,
                            cursor: "pointer",
                        }}>
                            <Mail size={13} />
                            {email}
                        </a>
                    )}
                </div>
            )}

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