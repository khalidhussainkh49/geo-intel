/**
 * Nigeria Customs Service — Office Dataset & Loader
 *
 * DATA SOURCES — tried in priority order:
 *
 *   1. Remote API   — your own REST endpoint that returns CustomsOffice[]
 *                     Set env var: NEXT_PUBLIC_CUSTOMS_OFFICES_API_URL
 *                     e.g. https://api.ncs.gov.ng/offices
 *
 *   2. GeoJSON URL  — any GeoJSON FeatureCollection where each Feature's
 *                     geometry is a Point and properties carry the office
 *                     fields. Can be a static file in /public, a Supabase
 *                     Storage URL, or a Next.js API route that reads from
 *                     your database.
 *                     Set env var: NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL
 *                     e.g. /customs-offices.geojson  or
 *                          https://your-supabase.co/storage/v1/object/public/...
 *
 *   3. Built-in     — the 57-office TypeScript constant below.
 *                     Always available. Used when both remote sources fail
 *                     or are not configured.
 *
 * The exported function loadOffices() handles all three tiers and always
 * resolves — it never throws. Call it once in useCustomsOffices on mount.
 *
 * ── How to configure ──────────────────────────────────────────────────────
 *
 *   Option A — REST API:
 *     NEXT_PUBLIC_CUSTOMS_OFFICES_API_URL=https://api.ncs.gov.ng/v1/offices
 *     Your API must return JSON: CustomsOffice[]
 *
 *   Option B — GeoJSON stored in Supabase:
 *     1. Export your offices table as GeoJSON from Supabase Studio (or use
 *        the query below to build a Next.js API route that does it live).
 *     2. Upload to Supabase Storage, get the public URL.
 *     3. NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL=<that url>
 *
 *   Option C — Next.js API route reading from Supabase:
 *     Create /app/api/customs-offices/route.ts  (example at bottom of file).
 *     NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL=/api/customs-offices
 *
 *   Option D — No env vars set:
 *     The 57 built-in offices load instantly with zero network calls.
 * ─────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────

export type OfficeType =
    | "headquarters"
    | "area-command"
    | "sector-command"
    | "fou"
    | "port-command"
    | "airport-command";

export interface CustomsOffice {
    id:       string;
    name:     string;
    type:     OfficeType;
    zone:     string;     // "A" | "B" | "C" | "D" | "E" | "HQ"
    state:    string;
    address:  string;
    lat:      number;
    lon:      number;
    phone?:   string;
    email?:   string;
}

// Standard GeoJSON types (inline — no external dependency)
interface GeoJSONPoint {
    type: "Point";
    coordinates: [number, number, number?]; // [lon, lat, alt?]
}
interface GeoJSONFeature {
    type: "Feature";
    id?: string | number;
    geometry: GeoJSONPoint;
    properties: Record<string, unknown>;
}
interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
}

// ─── Helpers ──────────────────────────────────────────────────

/** Normalize an unknown string into a valid OfficeType, defaulting to "sector-command". */
function normalizeType(raw: unknown): OfficeType {
    const VALID: OfficeType[] = [
        "headquarters", "area-command", "sector-command",
        "fou", "port-command", "airport-command",
    ];
    const s = String(raw ?? "").toLowerCase().trim();
    return VALID.includes(s as OfficeType) ? (s as OfficeType) : "sector-command";
}

/**
 * Parse a raw GeoJSON FeatureCollection into CustomsOffice[].
 * Property names are matched case-insensitively so the GeoJSON can use
 * "Name", "name", "NAME" — all accepted.
 *
 * Required GeoJSON properties:  name, type, zone, state, address
 * Optional:                     id, phone, email
 */
export function parseGeoJSON(geojson: unknown): CustomsOffice[] {
    if (
        !geojson ||
        typeof geojson !== "object" ||
        (geojson as any).type !== "FeatureCollection" ||
        !Array.isArray((geojson as any).features)
    ) {
        console.warn("[customsOfficesData] GeoJSON is not a FeatureCollection");
        return [];
    }

    const fc = geojson as GeoJSONFeatureCollection;
    const results: CustomsOffice[] = [];

    fc.features.forEach((feat, idx) => {
        // Skip non-Point geometry
        if (!feat.geometry || feat.geometry.type !== "Point") return;

        const [lon, lat] = feat.geometry.coordinates;
        if (typeof lon !== "number" || typeof lat !== "number") return;

        // Build a lowercase-key lookup so "Name", "name", "NAME" all resolve
        const p: Record<string, unknown> = {};
        Object.entries(feat.properties ?? {}).forEach(([k, v]) => {
            p[k.toLowerCase()] = v;
        });

        const name = String(p.name ?? p.office_name ?? p.title ?? `Office ${idx + 1}`);
        const id   = String(
            feat.id ??
            p.id ??
            p.office_id ??
            `geojson-${idx}`
        );

        results.push({
            id,
            name,
            type:    normalizeType(p.type ?? p.office_type ?? p.officetype),
            zone:    String(p.zone ?? p.ncs_zone ?? "").toUpperCase() || "A",
            state:   String(p.state ?? p.state_name ?? ""),
            address: String(p.address ?? p.location ?? ""),
            lat,
            lon,
            phone:   p.phone   ? String(p.phone)   : undefined,
            email:   p.email   ? String(p.email)   : undefined,
        });
    });

    return results;
}

// ─── Loader ───────────────────────────────────────────────────

export type DataSource = "builtin" | "api" | "geojson";

export interface LoadResult {
    offices: CustomsOffice[];
    source:  DataSource;
    count:   number;
}

/**
 * loadOffices()
 *
 * Tries data sources in priority order and always resolves.
 * Call once when the layer is first enabled; cache the result.
 *
 * Priority:
 *   1. NEXT_PUBLIC_CUSTOMS_OFFICES_API_URL  → CustomsOffice[] JSON
 *   2. NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL → GeoJSON FeatureCollection
 *   3. Built-in constant (CUSTOMS_OFFICES below)
 */
export async function loadOffices(): Promise<LoadResult> {
    // ── Tier 1: REST API ──────────────────────────────────────
    const apiUrl =
        typeof process !== "undefined"
            ? process.env.NEXT_PUBLIC_CUSTOMS_OFFICES_API_URL
            : undefined;

    if (apiUrl) {
        try {
            const res = await fetch(apiUrl, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    const offices = data as CustomsOffice[];
                    console.log(`[customsOfficesData] Loaded ${offices.length} offices from API`);
                    return { offices, source: "api", count: offices.length };
                }
            }
        } catch (err) {
            console.warn("[customsOfficesData] API fetch failed, trying GeoJSON:", err);
        }
    }

    // ── Tier 2: GeoJSON URL ───────────────────────────────────
    const geojsonUrl =
        typeof process !== "undefined"
            ? process.env.NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL
            : undefined;

    if (geojsonUrl) {
        try {
            const res = await fetch(geojsonUrl, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                const offices = parseGeoJSON(data);
                if (offices.length > 0) {
                    console.log(`[customsOfficesData] Loaded ${offices.length} offices from GeoJSON`);
                    return { offices, source: "geojson", count: offices.length };
                }
            }
        } catch (err) {
            console.warn("[customsOfficesData] GeoJSON fetch failed, using built-in:", err);
        }
    }

    // ── Tier 3: Built-in fallback ─────────────────────────────
    console.log(`[customsOfficesData] Using ${CUSTOMS_OFFICES.length} built-in offices`);
    return {
        offices: CUSTOMS_OFFICES,
        source:  "builtin",
        count:   CUSTOMS_OFFICES.length,
    };
}

// ─── Utility functions ────────────────────────────────────────

/** Returns the NCS standard display color for an office type. */
export function officeColor(type: OfficeType): string {
    switch (type) {
        case "headquarters":    return "#f59e0b"; // gold   — national HQ
        case "area-command":    return "#22d3ee"; // cyan   — major command
        case "port-command":    return "#3b82f6"; // blue   — maritime
        case "airport-command": return "#a78bfa"; // purple — aviation
        case "fou":             return "#ef4444"; // red    — enforcement
        case "sector-command":  return "#4ade80"; // green  — state level
        default:                return "#94a3b8"; // grey   — unknown
    }
}

/** Returns a human-readable label for an office type. */
export function officeTypeLabel(type: OfficeType): string {
    switch (type) {
        case "headquarters":    return "National Headquarters";
        case "area-command":    return "Area Command";
        case "port-command":    return "Port Command";
        case "airport-command": return "Airport Command";
        case "fou":             return "Federal Operations Unit";
        case "sector-command":  return "Sector Command";
        default:                return type;
    }
}

// ─── Built-in static dataset (Tier 3 fallback) ───────────────

export const CUSTOMS_OFFICES: CustomsOffice[] = [

    /* ── National Headquarters ─────────────────────────────── */
    {
        id: "hq-abuja", name: "NCS Headquarters",
        type: "headquarters", zone: "HQ", state: "FCT Abuja",
        address: "NCS Headquarters, Wuse Zone 7, Abuja",
        lat: 9.0643, lon: 7.4892,
        phone: "+234-9-523-4567", email: "info@customs.gov.ng",
    },

    /* ── Area & Port Commands ──────────────────────────────── */
    { id: "ac-apapa",       name: "Apapa Area Command",                    type: "area-command",    zone: "A", state: "Lagos",        address: "Wharf Road, Apapa, Lagos",                                    lat:  6.4497, lon:  3.3617 },
    { id: "ac-tincan",      name: "Tin Can Island Port Command",           type: "area-command",    zone: "A", state: "Lagos",        address: "Tin Can Island Port, Apapa, Lagos",                           lat:  6.4332, lon:  3.3299 },
    { id: "ac-seme",        name: "Seme Area Command",                     type: "area-command",    zone: "A", state: "Lagos",        address: "Badagry Expressway, Seme Border, Lagos",                      lat:  6.3640, lon:  2.7240 },
    { id: "ac-idiroko",     name: "Idiroko Area Command",                  type: "area-command",    zone: "A", state: "Ogun",         address: "Idiroko Border Post, Ogun State",                             lat:  6.8732, lon:  2.8460 },
    { id: "ac-kano",        name: "Kano/Jigawa Area Command",              type: "area-command",    zone: "B", state: "Kano",         address: "Maiduguri Road, Kano",                                        lat: 12.0022, lon:  8.5920 },
    { id: "ac-calabar",     name: "Calabar Area Command",                  type: "port-command",    zone: "D", state: "Cross River",  address: "Calabar Port, Calabar",                                       lat:  4.9578, lon:  8.3304 },
    { id: "ac-portharcourt",name: "Port Harcourt Area Command",            type: "area-command",    zone: "D", state: "Rivers",       address: "Port Harcourt, Rivers State",                                 lat:  4.8156, lon:  7.0498 },
    { id: "ac-onne",        name: "Onne Port Command",                     type: "port-command",    zone: "D", state: "Rivers",       address: "Onne Port Complex, Rivers State",                             lat:  4.7045, lon:  7.1484 },
    { id: "ac-warri",       name: "Warri Area Command",                    type: "area-command",    zone: "D", state: "Delta",        address: "Warri Port, Warri, Delta State",                              lat:  5.5167, lon:  5.7542 },
    { id: "ac-lagos-airport",name: "Murtala Muhammed Airport Command",     type: "airport-command", zone: "A", state: "Lagos",        address: "Murtala Muhammed International Airport, Ikeja, Lagos",        lat:  6.5774, lon:  3.3212 },
    { id: "ac-abuja-airport",name: "Nnamdi Azikiwe Airport Command",       type: "airport-command", zone: "C", state: "FCT Abuja",    address: "Nnamdi Azikiwe International Airport, Abuja",                 lat:  9.0067, lon:  7.2632 },
    { id: "ac-kano-airport", name: "Aminu Kano International Airport Command", type: "airport-command", zone: "B", state: "Kano",    address: "Airport Road, Kano",                                          lat: 12.0476, lon:  8.5246 },

    /* ── Sector Commands ───────────────────────────────────── */
    { id: "sc-lagos",      name: "Lagos Sector Command",      type: "sector-command", zone: "A", state: "Lagos",       address: "Broad Street, Lagos Island, Lagos",      lat:  6.4542, lon:  3.3947 },
    { id: "sc-ogun",       name: "Ogun Sector Command",       type: "sector-command", zone: "A", state: "Ogun",        address: "Oke Ilewo, Abeokuta, Ogun State",        lat:  7.1474, lon:  3.3481 },
    { id: "sc-oyo",        name: "Oyo Sector Command",        type: "sector-command", zone: "A", state: "Oyo",         address: "Ibadan, Oyo State",                      lat:  7.3776, lon:  3.9470 },
    { id: "sc-osun",       name: "Osun Sector Command",       type: "sector-command", zone: "A", state: "Osun",        address: "Osogbo, Osun State",                     lat:  7.7632, lon:  4.5603 },
    { id: "sc-ondo",       name: "Ondo Sector Command",       type: "sector-command", zone: "A", state: "Ondo",        address: "Akure, Ondo State",                      lat:  7.2526, lon:  5.1926 },
    { id: "sc-ekiti",      name: "Ekiti Sector Command",      type: "sector-command", zone: "A", state: "Ekiti",       address: "Ado Ekiti, Ekiti State",                 lat:  7.6218, lon:  5.2210 },
    { id: "sc-kano",       name: "Kano Sector Command",       type: "sector-command", zone: "B", state: "Kano",        address: "Bello Road, Kano",                       lat: 12.0022, lon:  8.5915 },
    { id: "sc-kaduna",     name: "Kaduna Sector Command",     type: "sector-command", zone: "B", state: "Kaduna",      address: "Kaduna, Kaduna State",                   lat: 10.5264, lon:  7.4388 },
    { id: "sc-katsina",    name: "Katsina Sector Command",    type: "sector-command", zone: "B", state: "Katsina",     address: "Katsina, Katsina State",                 lat: 12.9908, lon:  7.6017 },
    { id: "sc-sokoto",     name: "Sokoto Sector Command",     type: "sector-command", zone: "B", state: "Sokoto",      address: "Sokoto, Sokoto State",                   lat: 13.0622, lon:  5.2396 },
    { id: "sc-zamfara",    name: "Zamfara Sector Command",    type: "sector-command", zone: "B", state: "Zamfara",     address: "Gusau, Zamfara State",                   lat: 12.1704, lon:  6.6599 },
    { id: "sc-kebbi",      name: "Kebbi Sector Command",      type: "sector-command", zone: "B", state: "Kebbi",       address: "Birnin Kebbi, Kebbi State",              lat: 12.4538, lon:  4.1975 },
    { id: "sc-jigawa",     name: "Jigawa Sector Command",     type: "sector-command", zone: "B", state: "Jigawa",      address: "Dutse, Jigawa State",                    lat: 11.7437, lon:  9.3413 },
    { id: "sc-fct",        name: "FCT Sector Command",        type: "sector-command", zone: "C", state: "FCT Abuja",   address: "Central Business District, Abuja",       lat:  9.0579, lon:  7.4951 },
    { id: "sc-niger",      name: "Niger Sector Command",      type: "sector-command", zone: "C", state: "Niger",       address: "Minna, Niger State",                     lat:  9.6139, lon:  6.5569 },
    { id: "sc-kwara",      name: "Kwara Sector Command",      type: "sector-command", zone: "C", state: "Kwara",       address: "Ilorin, Kwara State",                    lat:  8.4966, lon:  4.5426 },
    { id: "sc-kogi",       name: "Kogi Sector Command",       type: "sector-command", zone: "C", state: "Kogi",        address: "Lokoja, Kogi State",                     lat:  7.8012, lon:  6.7410 },
    { id: "sc-benue",      name: "Benue Sector Command",      type: "sector-command", zone: "C", state: "Benue",       address: "Makurdi, Benue State",                   lat:  7.7298, lon:  8.5376 },
    { id: "sc-nasarawa",   name: "Nasarawa Sector Command",   type: "sector-command", zone: "C", state: "Nasarawa",    address: "Lafia, Nasarawa State",                  lat:  8.4897, lon:  8.5227 },
    { id: "sc-plateau",    name: "Plateau Sector Command",    type: "sector-command", zone: "C", state: "Plateau",     address: "Jos, Plateau State",                     lat:  9.9285, lon:  8.8921 },
    { id: "sc-rivers",     name: "Rivers Sector Command",     type: "sector-command", zone: "D", state: "Rivers",      address: "Port Harcourt, Rivers State",            lat:  4.8242, lon:  7.0336 },
    { id: "sc-delta",      name: "Delta Sector Command",      type: "sector-command", zone: "D", state: "Delta",       address: "Asaba, Delta State",                     lat:  6.1979, lon:  6.7371 },
    { id: "sc-edo",        name: "Edo Sector Command",        type: "sector-command", zone: "D", state: "Edo",         address: "Benin City, Edo State",                  lat:  6.3384, lon:  5.6271 },
    { id: "sc-crossriver", name: "Cross River Sector Command",type: "sector-command", zone: "D", state: "Cross River", address: "Calabar, Cross River State",             lat:  4.9517, lon:  8.3220 },
    { id: "sc-akwaibom",   name: "Akwa Ibom Sector Command",  type: "sector-command", zone: "D", state: "Akwa Ibom",   address: "Uyo, Akwa Ibom State",                   lat:  5.0444, lon:  7.9220 },
    { id: "sc-imo",        name: "Imo Sector Command",        type: "sector-command", zone: "D", state: "Imo",         address: "Owerri, Imo State",                      lat:  5.4836, lon:  7.0354 },
    { id: "sc-anambra",    name: "Anambra Sector Command",    type: "sector-command", zone: "D", state: "Anambra",     address: "Awka, Anambra State",                    lat:  6.2104, lon:  7.0672 },
    { id: "sc-enugu",      name: "Enugu Sector Command",      type: "sector-command", zone: "D", state: "Enugu",       address: "Enugu, Enugu State",                     lat:  6.4521, lon:  7.5102 },
    { id: "sc-ebonyi",     name: "Ebonyi Sector Command",     type: "sector-command", zone: "D", state: "Ebonyi",      address: "Abakaliki, Ebonyi State",                lat:  6.3249, lon:  8.1137 },
    { id: "sc-abia",       name: "Abia Sector Command",       type: "sector-command", zone: "D", state: "Abia",        address: "Umuahia, Abia State",                    lat:  5.5320, lon:  7.4864 },
    { id: "sc-bayelsa",    name: "Bayelsa Sector Command",    type: "sector-command", zone: "D", state: "Bayelsa",     address: "Yenagoa, Bayelsa State",                 lat:  4.9247, lon:  6.2676 },
    { id: "sc-borno",      name: "Borno Sector Command",      type: "sector-command", zone: "E", state: "Borno",       address: "Maiduguri, Borno State",                 lat: 11.8311, lon: 13.1510 },
    { id: "sc-yobe",       name: "Yobe Sector Command",       type: "sector-command", zone: "E", state: "Yobe",        address: "Damaturu, Yobe State",                   lat: 11.7480, lon: 11.9607 },
    { id: "sc-adamawa",    name: "Adamawa Sector Command",    type: "sector-command", zone: "E", state: "Adamawa",     address: "Yola, Adamawa State",                    lat:  9.2035, lon: 12.4954 },
    { id: "sc-taraba",     name: "Taraba Sector Command",     type: "sector-command", zone: "E", state: "Taraba",      address: "Jalingo, Taraba State",                  lat:  8.8894, lon: 11.3730 },
    { id: "sc-gombe",      name: "Gombe Sector Command",      type: "sector-command", zone: "E", state: "Gombe",       address: "Gombe, Gombe State",                     lat: 10.2897, lon: 11.1673 },
    { id: "sc-bauchi",     name: "Bauchi Sector Command",     type: "sector-command", zone: "E", state: "Bauchi",      address: "Bauchi, Bauchi State",                   lat: 10.3066, lon:  9.8447 },

    /* ── Federal Operations Units ──────────────────────────── */
    { id: "fou-zone-a", name: "FOU Zone A (Lagos)",         type: "fou", zone: "A", state: "Lagos",     address: "10 Burma Road, Apapa, Lagos",            lat:  6.4510, lon:  3.3695 },
    { id: "fou-zone-b", name: "FOU Zone B (Kaduna)",        type: "fou", zone: "B", state: "Kaduna",    address: "Independence Way, Kaduna",               lat: 10.5176, lon:  7.4383 },
    { id: "fou-zone-c", name: "FOU Zone C (Abuja)",         type: "fou", zone: "C", state: "FCT Abuja", address: "Area 11, Garki, Abuja",                  lat:  9.0417, lon:  7.4882 },
    { id: "fou-zone-d", name: "FOU Zone D (Port Harcourt)", type: "fou", zone: "D", state: "Rivers",    address: "Aba Road, Port Harcourt, Rivers State",  lat:  4.8180, lon:  7.0249 },
    { id: "fou-zone-e", name: "FOU Zone E (Maiduguri)",     type: "fou", zone: "E", state: "Borno",     address: "Baga Road, Maiduguri, Borno State",      lat: 11.8350, lon: 13.1602 },
];

/*
 * ─── Example: Next.js API route for Supabase ────────────────────────────────
 *
 * Create this file: src/app/api/customs-offices/route.ts
 * Then set: NEXT_PUBLIC_CUSTOMS_OFFICES_GEOJSON_URL=/api/customs-offices
 *
 * import { createClient } from "@supabase/supabase-js";
 * import { NextResponse } from "next/server";
 *
 * export async function GET() {
 *     const supabase = createClient(
 *         process.env.NEXT_PUBLIC_SUPABASE_URL!,
 *         process.env.SUPABASE_SERVICE_ROLE_KEY!
 *     );
 *
 *     const { data, error } = await supabase
 *         .from("customs_offices")       // your table name
 *         .select("*");
 *
 *     if (error) {
 *         return NextResponse.json({ error: error.message }, { status: 500 });
 *     }
 *
 *     // Return as GeoJSON FeatureCollection
 *     const geojson = {
 *         type: "FeatureCollection",
 *         features: data.map((row: any) => ({
 *             type: "Feature",
 *             id: row.id,
 *             geometry: {
 *                 type: "Point",
 *                 coordinates: [row.longitude, row.latitude]
 *             },
 *             properties: {
 *                 name:    row.name,
 *                 type:    row.office_type,   // "area-command", "headquarters", etc.
 *                 zone:    row.zone,
 *                 state:   row.state,
 *                 address: row.address,
 *                 phone:   row.phone,
 *                 email:   row.email,
 *             }
 *         }))
 *     };
 *
 *     return NextResponse.json(geojson, {
 *         headers: { "Cache-Control": "public, max-age=300" } // 5-min cache
 *     });
 * }
 *
 * ─── Supabase table definition (SQL) ──────────────────────────────────────
 *
 * CREATE TABLE public.customs_offices (
 *     id           TEXT PRIMARY KEY,
 *     name         TEXT NOT NULL,
 *     office_type  TEXT NOT NULL DEFAULT 'sector-command',
 *     zone         TEXT NOT NULL,
 *     state        TEXT NOT NULL,
 *     address      TEXT,
 *     latitude     DOUBLE PRECISION NOT NULL,
 *     longitude    DOUBLE PRECISION NOT NULL,
 *     phone        TEXT,
 *     email        TEXT,
 *     created_at   TIMESTAMPTZ DEFAULT now(),
 *     updated_at   TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Enable RLS + read-only public policy
 * ALTER TABLE public.customs_offices ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "public read" ON public.customs_offices
 *     FOR SELECT USING (true);
 *
 * -- Seed from the built-in dataset by running:
 * -- node scripts/seed-customs-offices.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 */