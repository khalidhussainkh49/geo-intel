/**
 * src/app/api/customs-offices/route.ts
 *
 * Next.js App Router API route that reads the customs_offices table
 * from Supabase and returns a GeoJSON FeatureCollection.
 *
 * The useCustomsOffices hook fetches this URL when you set:
 *   NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL=/api/customs-offices
 *
 * Features:
 *   - 5-minute server-side cache (Cache-Control header)
 *   - Optional ?zone=A filter (returns only that NCS zone)
 *   - Optional ?type=area-command filter
 *   - Falls back to 200 + empty FeatureCollection on DB error
 *     (so the hook falls through to the built-in dataset)
 */

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic"; // disable Next.js route caching; we manage it ourselves

export async function GET(request: NextRequest) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // If Supabase is not configured, return empty collection
    // → loadOffices() will fall through to the built-in dataset
    if (!supabaseUrl || !serviceKey) {
        return NextResponse.json(
            { type: "FeatureCollection", features: [] },
            { status: 200 }
        );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Optional query filters ────────────────────────────────
    const { searchParams } = request.nextUrl;
    const zoneFilter = searchParams.get("zone");
    const typeFilter = searchParams.get("type");

    let query = supabase
        .from("customs_offices")
        .select("id, name, office_type, zone, state, address, latitude, longitude, phone, email");

    if (zoneFilter) query = query.eq("zone", zoneFilter.toUpperCase());
    if (typeFilter) query = query.eq("office_type", typeFilter.toLowerCase());

    const { data, error } = await query.order("name");

    if (error) {
        console.error("[/api/customs-offices] Supabase error:", error.message);
        // Return empty FeatureCollection — hook falls back to built-in data
        return NextResponse.json(
            { type: "FeatureCollection", features: [] },
            { status: 200 }
        );
    }

    // ── Build GeoJSON FeatureCollection ──────────────────────
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
                name:    row.name,
                type:    row.office_type,
                zone:    row.zone,
                state:   row.state,
                address: row.address ?? "",
                phone:   row.phone   ?? null,
                email:   row.email   ?? null,
            },
        })),
    };

    return NextResponse.json(geojson, {
        status: 200,
        headers: {
            // Cache on CDN/browsers for 5 minutes
            "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
    });
}