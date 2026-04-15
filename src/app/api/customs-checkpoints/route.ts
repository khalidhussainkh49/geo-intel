/**
 * src/app/api/checkpoints/route.ts
 *
 * Next.js App Router API route — reads customs_checkpoints from Supabase
 * and returns a GeoJSON FeatureCollection.
 *
 * Activate by setting in .env.local:
 *   NEXT_PUBLIC_CUSTOMS_CHECKPOINTS_GEOJSON_URL=/api/checkpoints
 *
 * Optional query params:
 *   ?zone=A            — filter by NCS zone
 *   ?type=fixed        — filter by checkpoint type
 *   ?scanner=true      — only checkpoints with scanner
 *   ?weighbridge=true  — only checkpoints with weighbridge
 *   ?state=Lagos       — filter by state name
 */

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
        // Not configured — return empty so hook falls back to built-in
        return NextResponse.json(
            { type: "FeatureCollection", features: [] },
            { status: 200 }
        );
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { searchParams } = request.nextUrl;

    let query = supabase
        .from("customs_checkpoints")
        .select("id, name, checkpoint_type, zone, state, road, direction, latitude, longitude, operating_hours, staffing, scanner, weighbridge, notes");

    // Apply optional filters
    const zone       = searchParams.get("zone");
    const type       = searchParams.get("type");
    const state      = searchParams.get("state");
    const scanner    = searchParams.get("scanner");
    const weighbridge= searchParams.get("weighbridge");

    if (zone)        query = query.eq("zone", zone.toUpperCase());
    if (type)        query = query.eq("checkpoint_type", type.toLowerCase());
    if (state)       query = query.ilike("state", `%${state}%`);
    if (scanner === "true")     query = query.eq("scanner", true);
    if (weighbridge === "true") query = query.eq("weighbridge", true);

    const { data, error } = await query.order("name");

    if (error) {
        console.error("[/api/checkpoints] Supabase error:", error.message);
        return NextResponse.json(
            { type: "FeatureCollection", features: [] },
            { status: 200 }
        );
    }

    const geojson = {
        type: "FeatureCollection",
        features: (data ?? []).map((row: any) => ({
            type: "Feature",
            id: row.id,
            geometry: {
                type: "Point",
                coordinates: [row.longitude, row.latitude],
            },
            properties: {
                name:            row.name,
                type:            row.checkpoint_type,
                zone:            row.zone,
                state:           row.state,
                road:            row.road           ?? "",
                direction:       row.direction      ?? "Both",
                operating_hours: row.operating_hours ?? "24/7",
                staffing:        row.staffing        ?? "NCS Officers",
                scanner:         row.scanner         ?? false,
                weighbridge:     row.weighbridge     ?? false,
                notes:           row.notes           ?? null,
            },
        })),
    };

    return NextResponse.json(geojson, {
        status: 200,
        headers: {
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
    });
}