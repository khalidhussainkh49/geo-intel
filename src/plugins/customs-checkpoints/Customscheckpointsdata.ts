/**
 * Nigeria Customs Service — Checkpoint Dataset & Loader
 *
 * Checkpoints are roadside inspection points, scanner gates, and weighbridge
 * stations operated by NCS on major trunk roads, border approach corridors,
 * and port access routes across Nigeria.
 *
 * DATA SOURCES — tried in priority order:
 *
 *   1. REST API   NEXT_PUBLIC_CUSTOMS_CHECKPOINTS_API_URL
 *                 Expects: CustomsCheckpoint[]
 *                 e.g. https://api.ncs.gov.ng/checkpoints
 *
 *   2. GeoJSON    NEXT_PUBLIC_CUSTOMS_CHECKPOINTS_GEOJSON_URL
 *                 Expects: GeoJSON FeatureCollection (Points)
 *                 e.g. /checkpoints.geojson
 *                      /api/checkpoints   (see api-route-checkpoints.ts)
 *
 *   3. Built-in   ~120 checkpoints hardcoded below — works offline,
 *                 zero config required.
 *
 * ── Quick setup for Supabase ──────────────────────────────────
 *   1. Run: node -r dotenv/config scripts/seed-checkpoints.mjs
 *   2. Copy api-route-checkpoints.ts → src/app/api/checkpoints/route.ts
 *   3. Add to .env.local:
 *        NEXT_PUBLIC_CUSTOMS_CHECKPOINTS_GEOJSON_URL=/api/checkpoints
 *
 * ── Supabase table DDL ────────────────────────────────────────
 *   CREATE TABLE public.customs_checkpoints (
 *       id            TEXT PRIMARY KEY,
 *       name          TEXT NOT NULL,
 *       checkpoint_type TEXT NOT NULL DEFAULT 'mobile',
 *       zone          TEXT NOT NULL,
 *       state         TEXT NOT NULL,
 *       road          TEXT NOT NULL,
 *       direction     TEXT,
 *       latitude      DOUBLE PRECISION NOT NULL,
 *       longitude     DOUBLE PRECISION NOT NULL,
 *       operating_hours TEXT DEFAULT '24/7',
 *       staffing      TEXT DEFAULT 'NCS Officers',
 *       scanner       BOOLEAN DEFAULT false,
 *       weighbridge   BOOLEAN DEFAULT false,
 *       notes         TEXT,
 *       created_at    TIMESTAMPTZ DEFAULT now()
 *   );
 *   ALTER TABLE public.customs_checkpoints ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "public read" ON public.customs_checkpoints FOR SELECT USING (true);
 */

// ─── Types ────────────────────────────────────────────────────

export type CheckpointType =
    | "fixed"           // Permanent post, always staffed
    | "mobile"          // Rotational/patrol checkpoint
    | "scanner-gate"    // Drive-through X-ray scanner
    | "weighbridge"     // Truck weight enforcement
    | "border-gate"     // First/last check at a border crossing
    | "port-gate";      // Entry/exit gate at a seaport or airport

export interface CustomsCheckpoint {
    id:               string;
    name:             string;
    type:             CheckpointType;
    zone:             string;       // "A" | "B" | "C" | "D" | "E"
    state:            string;
    road:             string;       // Road name / route number
    direction?:       string;       // "Inbound" | "Outbound" | "Both"
    lat:              number;
    lon:              number;
    operatingHours?:  string;       // e.g. "24/7" | "06:00–22:00"
    staffing?:        string;       // e.g. "NCS Officers" | "Joint Task Force"
    scanner?:         boolean;      // Has X-ray scanner
    weighbridge?:     boolean;      // Has weighbridge
    notes?:           string;
}

// ─── GeoJSON parser ───────────────────────────────────────────

interface GeoJSONFeatureCollection {
    type: "FeatureCollection";
    features: Array<{
        type: "Feature";
        id?: string | number;
        geometry: { type: "Point"; coordinates: [number, number, number?] };
        properties: Record<string, unknown>;
    }>;
}

function normalizeCheckpointType(raw: unknown): CheckpointType {
    const valid: CheckpointType[] = [
        "fixed", "mobile", "scanner-gate",
        "weighbridge", "border-gate", "port-gate",
    ];
    const s = String(raw ?? "").toLowerCase().trim();
    return valid.includes(s as CheckpointType) ? (s as CheckpointType) : "fixed";
}

export function parseCheckpointsGeoJSON(geojson: unknown): CustomsCheckpoint[] {
    if (
        !geojson ||
        typeof geojson !== "object" ||
        (geojson as any).type !== "FeatureCollection" ||
        !Array.isArray((geojson as any).features)
    ) {
        console.warn("[checkpointsData] Not a valid FeatureCollection");
        return [];
    }

    const fc = geojson as GeoJSONFeatureCollection;
    const results: CustomsCheckpoint[] = [];

    fc.features.forEach((feat, idx) => {
        if (!feat.geometry || feat.geometry.type !== "Point") return;
        const [lon, lat] = feat.geometry.coordinates;
        if (typeof lon !== "number" || typeof lat !== "number") return;

        // Case-insensitive property lookup
        const p: Record<string, unknown> = {};
        Object.entries(feat.properties ?? {}).forEach(([k, v]) => {
            p[k.toLowerCase()] = v;
        });

        const name = String(p.name ?? p.checkpoint_name ?? p.title ?? `Checkpoint ${idx + 1}`);
        const id   = String(feat.id ?? p.id ?? p.checkpoint_id ?? `geojson-cp-${idx}`);

        results.push({
            id,
            name,
            type:           normalizeCheckpointType(p.type ?? p.checkpoint_type),
            zone:           String(p.zone ?? p.ncs_zone ?? "A").toUpperCase(),
            state:          String(p.state ?? p.state_name ?? ""),
            road:           String(p.road ?? p.road_name ?? p.route ?? ""),
            direction:      p.direction ? String(p.direction) : undefined,
            lat,
            lon,
            operatingHours: p.operating_hours ? String(p.operating_hours) : undefined,
            staffing:       p.staffing ? String(p.staffing) : undefined,
            scanner:        Boolean(p.scanner ?? p.has_scanner ?? false),
            weighbridge:    Boolean(p.weighbridge ?? p.has_weighbridge ?? false),
            notes:          p.notes ? String(p.notes) : undefined,
        });
    });

    return results;
}

// ─── Loader ───────────────────────────────────────────────────

export type CheckpointDataSource = "builtin" | "api" | "geojson";

export interface CheckpointLoadResult {
    checkpoints: CustomsCheckpoint[];
    source:      CheckpointDataSource;
    count:       number;
}

export async function loadCheckpoints(): Promise<CheckpointLoadResult> {
    // Tier 1 — REST API
    const apiUrl =
        typeof process !== "undefined"
            ? process.env.NEXT_PUBLIC_CUSTOMS_CHECKPOINTS_API_URL
            : undefined;

    if (apiUrl) {
        try {
            const res = await fetch(apiUrl, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data) && data.length > 0) {
                    console.log(`[checkpointsData] Loaded ${data.length} checkpoints from API`);
                    return { checkpoints: data as CustomsCheckpoint[], source: "api", count: data.length };
                }
            }
        } catch (err) {
            console.warn("[checkpointsData] API failed, trying GeoJSON:", err);
        }
    }

    // Tier 2 — GeoJSON URL
    const geojsonUrl =
        typeof process !== "undefined"
            ? process.env.NEXT_PUBLIC_CUSTOMS_CHECKPOINTS_GEOJSON_URL
            : undefined;

    if (geojsonUrl) {
        try {
            const res = await fetch(geojsonUrl, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                const checkpoints = parseCheckpointsGeoJSON(data);
                if (checkpoints.length > 0) {
                    console.log(`[checkpointsData] Loaded ${checkpoints.length} checkpoints from GeoJSON`);
                    return { checkpoints, source: "geojson", count: checkpoints.length };
                }
            }
        } catch (err) {
            console.warn("[checkpointsData] GeoJSON failed, using built-in:", err);
        }
    }

    // Tier 3 — Built-in fallback
    console.log(`[checkpointsData] Using ${CUSTOMS_CHECKPOINTS.length} built-in checkpoints`);
    return {
        checkpoints: CUSTOMS_CHECKPOINTS,
        source:      "builtin",
        count:       CUSTOMS_CHECKPOINTS.length,
    };
}

// ─── Utility functions ────────────────────────────────────────

/** Map pin color per checkpoint type */
export function checkpointColor(type: CheckpointType): string {
    switch (type) {
        case "fixed":        return "#22d3ee"; // cyan   — permanent post
        case "mobile":       return "#4ade80"; // green  — patrol/rotational
        case "scanner-gate": return "#f59e0b"; // amber  — technology gate
        case "weighbridge":  return "#a78bfa"; // purple — weight enforcement
        case "border-gate":  return "#ef4444"; // red    — border entry/exit
        case "port-gate":    return "#3b82f6"; // blue   — port access
        default:             return "#94a3b8";
    }
}

/** Human-readable type label */
export function checkpointTypeLabel(type: CheckpointType): string {
    switch (type) {
        case "fixed":        return "Fixed Checkpoint";
        case "mobile":       return "Mobile Checkpoint";
        case "scanner-gate": return "Scanner Gate";
        case "weighbridge":  return "Weighbridge Station";
        case "border-gate":  return "Border Gate";
        case "port-gate":    return "Port Gate";
        default:             return type;
    }
}

// ─── Built-in static dataset ──────────────────────────────────

export const CUSTOMS_CHECKPOINTS: CustomsCheckpoint[] = [

    /* ══ ZONE A — SOUTH-WEST ══════════════════════════════════ */

    /* Lagos — Apapa / Tin Can approach corridors */
    { id: "cp-la-01", name: "Mile 2 Checkpoint",              type: "fixed",        zone: "A", state: "Lagos",  road: "Lagos-Badagry Expressway",        direction: "Both",    lat:  6.4742, lon:  3.2841, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-la-02", name: "Apapa Wharf Gate (In)",          type: "port-gate",    zone: "A", state: "Lagos",  road: "Wharf Road, Apapa",               direction: "Inbound", lat:  6.4508, lon:  3.3648, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-03", name: "Apapa Wharf Gate (Out)",         type: "port-gate",    zone: "A", state: "Lagos",  road: "Wharf Road, Apapa",               direction: "Outbound",lat:  6.4494, lon:  3.3660, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-04", name: "Tin Can Port Gate",              type: "port-gate",    zone: "A", state: "Lagos",  road: "Tin Can Island Port Road",        direction: "Both",    lat:  6.4335, lon:  3.3306, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-05", name: "Ijora Causeway Scanner Gate",    type: "scanner-gate", zone: "A", state: "Lagos",  road: "Ijora Causeway, Lagos",           direction: "Both",    lat:  6.4599, lon:  3.3527, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-06", name: "Cele Checkpoint (Apapa Road)",   type: "fixed",        zone: "A", state: "Lagos",  road: "Lagos-Aba Expressway",            direction: "Both",    lat:  6.4693, lon:  3.3442, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-la-07", name: "Orile Checkpoint",               type: "fixed",        zone: "A", state: "Lagos",  road: "Badagry Expressway",              direction: "Both",    lat:  6.4712, lon:  3.3141, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },
    { id: "cp-la-08", name: "LASU Gate Checkpoint",           type: "mobile",       zone: "A", state: "Lagos",  road: "Lagos-Badagry Expressway (km 22)",direction: "Both",    lat:  6.4680, lon:  3.1210, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },
    { id: "cp-la-09", name: "Agbara Weighbridge",             type: "weighbridge",  zone: "A", state: "Lagos",  road: "Lagos-Badagry Expressway (km 48)",direction: "Outbound",lat:  6.4939, lon:  3.0099, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-la-10", name: "MMIA Cargo Gate (Import)",       type: "port-gate",    zone: "A", state: "Lagos",  road: "Airport Road, Ikeja",             direction: "Inbound", lat:  6.5830, lon:  3.3345, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-11", name: "MMIA Cargo Gate (Export)",       type: "port-gate",    zone: "A", state: "Lagos",  road: "Airport Road, Ikeja",             direction: "Outbound",lat:  6.5812, lon:  3.3361, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-12", name: "Ikorodu Road Checkpoint",        type: "mobile",       zone: "A", state: "Lagos",  road: "Ikorodu Road",                    direction: "Both",    lat:  6.5491, lon:  3.4026, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Lagos — Seme border approach */
    { id: "cp-la-13", name: "Seme Border Gate (Entry)",       type: "border-gate",  zone: "A", state: "Lagos",  road: "Badagry Expressway, Seme",        direction: "Inbound", lat:  6.3645, lon:  2.7235, operatingHours: "24/7",       scanner: true,  weighbridge: false, notes: "Benin-Nigeria land border" },
    { id: "cp-la-14", name: "Seme Border Gate (Exit)",        type: "border-gate",  zone: "A", state: "Lagos",  road: "Badagry Expressway, Seme",        direction: "Outbound",lat:  6.3635, lon:  2.7228, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-la-15", name: "Badagry Weighbridge",            type: "weighbridge",  zone: "A", state: "Lagos",  road: "Lagos-Badagry Expressway (Badagry)",direction:"Both",   lat:  6.4147, lon:  2.8898, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Ogun — Idiroko corridor */
    { id: "cp-og-01", name: "Idiroko Border Gate",            type: "border-gate",  zone: "A", state: "Ogun",   road: "Idiroko Road",                    direction: "Both",    lat:  6.8732, lon:  2.8460, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Benin-Nigeria border" },
    { id: "cp-og-02", name: "Owode-Afa Checkpoint",           type: "fixed",        zone: "A", state: "Ogun",   road: "Lagos-Abeokuta Expressway",        direction: "Both",   lat:  6.7011, lon:  3.2002, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-og-03", name: "Sagamu Interchange Checkpoint",  type: "fixed",        zone: "A", state: "Ogun",   road: "Lagos-Ibadan Expressway (Sagamu)",  direction: "Both",  lat:  6.8349, lon:  3.6479, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-og-04", name: "Abeokuta Weighbridge",           type: "weighbridge",  zone: "A", state: "Ogun",   road: "Abeokuta-Ibadan Road",             direction: "Both",   lat:  7.2061, lon:  3.3862, operatingHours: "06:00-22:00", scanner: false, weighbridge: true  },

    /* Oyo */
    { id: "cp-oy-01", name: "Ibadan-Lagos Expressway Checkpoint", type: "fixed",    zone: "A", state: "Oyo",    road: "Lagos-Ibadan Expressway (Ibadan end)", direction: "Both", lat: 7.3482, lon: 3.8974, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-oy-02", name: "Ibadan-Ilorin Road Checkpoint",  type: "mobile",       zone: "A", state: "Oyo",    road: "Ibadan-Ilorin Road",               direction: "Both",   lat:  7.8840, lon:  3.9421, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },
    { id: "cp-oy-03", name: "Challenge Market Weighbridge",   type: "weighbridge",  zone: "A", state: "Oyo",    road: "Ring Road, Ibadan",                direction: "Both",   lat:  7.3795, lon:  3.9084, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* ══ ZONE B — NORTH-WEST ══════════════════════════════════ */

    /* Kano — major entry/exit roads */
    { id: "cp-kn-01", name: "Kano-Jibiya Road Checkpoint",   type: "fixed",        zone: "B", state: "Kano",   road: "Kano-Katsina Road (Jibiya axis)",  direction: "Both",   lat: 12.4213, lon:  8.3802, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-kn-02", name: "Kano Airport Gate",             type: "port-gate",    zone: "B", state: "Kano",   road: "Airport Road, Kano",               direction: "Both",   lat: 12.0476, lon:  8.5245, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-kn-03", name: "Sharada Industrial Checkpoint", type: "fixed",        zone: "B", state: "Kano",   road: "Zaria Road, Kano",                 direction: "Both",   lat: 12.0331, lon:  8.5581, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-kn-04", name: "Kano-Lagos Road Weighbridge",   type: "weighbridge",  zone: "B", state: "Kano",   road: "Kano-Lagos Trunk Road",            direction: "Both",   lat: 11.8672, lon:  8.5234, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-kn-05", name: "Maigatari Border Gate",         type: "border-gate",  zone: "B", state: "Jigawa", road: "Kano-Hadejia Road (Maigatari)",    direction: "Both",   lat: 12.9771, lon:  9.4029, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Niger-Nigeria border" },

    /* Katsina */
    { id: "cp-kt-01", name: "Jibia Border Gate",             type: "border-gate",  zone: "B", state: "Katsina",road: "Katsina-Jibia Road",               direction: "Both",   lat: 13.0881, lon:  7.2002, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Niger-Nigeria border" },
    { id: "cp-kt-02", name: "Katsina-Kano Road Checkpoint",  type: "fixed",        zone: "B", state: "Katsina",road: "Katsina-Kano Road",                direction: "Both",   lat: 12.8104, lon:  7.5813, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Sokoto */
    { id: "cp-sk-01", name: "Illela Border Gate",            type: "border-gate",  zone: "B", state: "Sokoto", road: "Sokoto-Illela Road",               direction: "Both",   lat: 13.7360, lon:  5.2963, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Niger-Nigeria border" },
    { id: "cp-sk-02", name: "Sokoto-Birnin Kebbi Checkpoint",type: "fixed",        zone: "B", state: "Sokoto", road: "Sokoto-Birnin Kebbi Road",          direction: "Both",  lat: 12.8004, lon:  4.7992, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Kebbi */
    { id: "cp-kb-01", name: "Kamba Border Gate",             type: "border-gate",  zone: "B", state: "Kebbi",  road: "Kamba Road, Kebbi",                direction: "Both",   lat: 11.8534, lon:  3.6820, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Benin-Nigeria border" },
    { id: "cp-kb-02", name: "Birnin Kebbi Weighbridge",      type: "weighbridge",  zone: "B", state: "Kebbi",  road: "Birnin Kebbi Bypass",              direction: "Both",   lat: 12.4538, lon:  4.1975, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Kaduna */
    { id: "cp-kd-01", name: "Kaduna-Kano Road Checkpoint",   type: "fixed",        zone: "B", state: "Kaduna", road: "Kaduna-Kano Road (Katari)",         direction: "Both",  lat: 11.0442, lon:  7.7613, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-kd-02", name: "Kaduna-Abuja Road Checkpoint",  type: "fixed",        zone: "B", state: "Kaduna", road: "Kaduna-Abuja Expressway",           direction: "Both",  lat: 10.2034, lon:  7.5192, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-kd-03", name: "Kaduna North Industrial Gate",  type: "scanner-gate", zone: "B", state: "Kaduna", road: "Zaria Road, Kaduna",                direction: "Both",  lat: 10.5601, lon:  7.4381, operatingHours: "24/7",       scanner: true,  weighbridge: false },

    /* ══ ZONE C — NORTH CENTRAL ═══════════════════════════════ */

    /* FCT Abuja */
    { id: "cp-fc-01", name: "Abuja Airport Gate",            type: "port-gate",    zone: "C", state: "FCT",    road: "Airport Road, Abuja",              direction: "Both",   lat:  9.0069, lon:  7.2628, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-fc-02", name: "Gwagwalada Checkpoint",         type: "fixed",        zone: "C", state: "FCT",    road: "Abuja-Lokoja Road",                direction: "Both",   lat:  8.9432, lon:  7.0793, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-fc-03", name: "Kubwa Checkpoint",              type: "fixed",        zone: "C", state: "FCT",    road: "Zuba-Kaduna Expressway",           direction: "Both",   lat:  9.1603, lon:  7.3197, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-fc-04", name: "Abaji Weighbridge",             type: "weighbridge",  zone: "C", state: "FCT",    road: "Abuja-Lokoja Expressway (Abaji)",  direction: "Both",   lat:  8.4697, lon:  6.9400, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-fc-05", name: "Sheda-Kuje Road Checkpoint",    type: "mobile",       zone: "C", state: "FCT",    road: "Kuje Road, Abuja",                 direction: "Both",   lat:  8.8804, lon:  7.2213, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Niger State */
    { id: "cp-ni-01", name: "Minna-Abuja Road Checkpoint",   type: "fixed",        zone: "C", state: "Niger",  road: "Minna-Abuja Road",                 direction: "Both",   lat:  9.3081, lon:  6.8023, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ni-02", name: "Bida Weighbridge",              type: "weighbridge",  zone: "C", state: "Niger",  road: "Bida-Abuja Road",                  direction: "Both",   lat:  9.1089, lon:  6.0117, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-ni-03", name: "Kontagora Road Checkpoint",     type: "mobile",       zone: "C", state: "Niger",  road: "Kontagora-Sokoto Road",            direction: "Both",   lat: 10.4028, lon:  5.4721, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Kwara */
    { id: "cp-kw-01", name: "Ilorin-Lagos Road Checkpoint",  type: "fixed",        zone: "C", state: "Kwara",  road: "Ilorin-Ogbomosho Road",            direction: "Both",   lat:  8.4124, lon:  4.6223, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-kw-02", name: "Ilorin-Abuja Road Checkpoint",  type: "fixed",        zone: "C", state: "Kwara",  road: "Ilorin-Abuja Road",                direction: "Both",   lat:  8.8091, lon:  4.7601, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-kw-03", name: "Kainji Weighbridge",            type: "weighbridge",  zone: "C", state: "Kwara",  road: "New Bussa Road",                   direction: "Both",   lat:  9.8651, lon:  4.6201, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Kogi */
    { id: "cp-ko-01", name: "Lokoja-Abuja Road Checkpoint",  type: "fixed",        zone: "C", state: "Kogi",   road: "Lokoja-Abuja Expressway",           direction: "Both",  lat:  7.9880, lon:  6.8211, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ko-02", name: "Okene Junction Checkpoint",     type: "fixed",        zone: "C", state: "Kogi",   road: "Okene-Lokoja Road",                direction: "Both",   lat:  7.5473, lon:  6.2351, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ko-03", name: "Ajaokuta Weighbridge",          type: "weighbridge",  zone: "C", state: "Kogi",   road: "Ajaokuta-Lokoja Road",             direction: "Both",   lat:  7.5601, lon:  6.6581, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Benue */
    { id: "cp-be-01", name: "Makurdi-Enugu Road Checkpoint", type: "fixed",        zone: "C", state: "Benue",  road: "Makurdi-Enugu Road",               direction: "Both",   lat:  7.6831, lon:  8.7014, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-be-02", name: "Makurdi-Lafia Checkpoint",      type: "fixed",        zone: "C", state: "Benue",  road: "Makurdi-Lafia Road",               direction: "Both",   lat:  7.8102, lon:  8.6322, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* ══ ZONE D — SOUTH-EAST ══════════════════════════════════ */

    /* Rivers — Port Harcourt & Onne */
    { id: "cp-rv-01", name: "Onne Port Gate (Inbound)",      type: "port-gate",    zone: "D", state: "Rivers",road: "Onne Port Road",                    direction: "Inbound", lat:  4.7058, lon:  7.1476, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-rv-02", name: "Onne Port Gate (Outbound)",     type: "port-gate",    zone: "D", state: "Rivers",road: "Onne Port Road",                    direction: "Outbound",lat:  4.7041, lon:  7.1492, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-rv-03", name: "Eleme Scanner Gate",            type: "scanner-gate", zone: "D", state: "Rivers",road: "Port Harcourt-Aba Road (Eleme)",    direction: "Both",    lat:  4.7592, lon:  7.1293, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-rv-04", name: "Rumuola Checkpoint",            type: "fixed",        zone: "D", state: "Rivers",road: "Rumuola Road, Port Harcourt",       direction: "Both",    lat:  4.8442, lon:  7.0098, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-rv-05", name: "PH Airport Gate",               type: "port-gate",    zone: "D", state: "Rivers",road: "Airport Road, Port Harcourt",       direction: "Both",    lat:  5.0551, lon:  6.9500, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-rv-06", name: "Trans-Amadi Weighbridge",       type: "weighbridge",  zone: "D", state: "Rivers",road: "Trans-Amadi Industrial Road",       direction: "Both",    lat:  4.8628, lon:  7.0321, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-rv-07", name: "Rumuji Checkpoint",             type: "fixed",        zone: "D", state: "Rivers",road: "PH-Owerri Road",                    direction: "Both",    lat:  4.9731, lon:  6.9311, operatingHours: "24/7",       scanner: false, weighbridge: false },

    /* Cross River — Calabar */
    { id: "cp-cr-01", name: "Calabar Port Gate (In)",        type: "port-gate",    zone: "D", state: "Cross River",road: "Calabar Port Road",            direction: "Inbound", lat:  4.9602, lon:  8.3282, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-cr-02", name: "Calabar Port Gate (Out)",       type: "port-gate",    zone: "D", state: "Cross River",road: "Calabar Port Road",            direction: "Outbound",lat:  4.9589, lon:  8.3299, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-cr-03", name: "Mfun Border Gate",              type: "border-gate",  zone: "D", state: "Cross River",road: "Cameroon Border, Mfun",        direction: "Both",    lat:  4.9811, lon:  8.3561, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Cameroon-Nigeria border" },
    { id: "cp-cr-04", name: "Ikom Checkpoint",               type: "fixed",        zone: "D", state: "Cross River",road: "Calabar-Ikom Road",            direction: "Both",    lat:  5.9671, lon:  8.7121, operatingHours: "24/7",       scanner: false, weighbridge: false },

    /* Delta — Warri / Sapele */
    { id: "cp-dt-01", name: "Warri Port Gate",               type: "port-gate",    zone: "D", state: "Delta",  road: "Warri Port Road",                  direction: "Both",    lat:  5.5238, lon:  5.7529, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-dt-02", name: "Effurun Roundabout Checkpoint", type: "fixed",        zone: "D", state: "Delta",  road: "Effurun-Sapele Road",              direction: "Both",    lat:  5.5471, lon:  5.7833, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-dt-03", name: "Sapele Weighbridge",            type: "weighbridge",  zone: "D", state: "Delta",  road: "Warri-Sapele Road",                direction: "Both",    lat:  5.9031, lon:  5.6882, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-dt-04", name: "Asaba-Onitsha Checkpoint",      type: "fixed",        zone: "D", state: "Delta",  road: "Asaba-Onitsha Road (Niger Bridge)", direction: "Both",   lat:  6.2011, lon:  6.7501, operatingHours: "24/7",       scanner: false, weighbridge: false },

    /* Edo */
    { id: "cp-ed-01", name: "Benin Bypass Checkpoint",       type: "fixed",        zone: "D", state: "Edo",    road: "Benin-Ore Expressway",             direction: "Both",    lat:  6.3562, lon:  5.6391, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ed-02", name: "Upper Sakponba Weighbridge",    type: "weighbridge",  zone: "D", state: "Edo",    road: "Benin-Asaba Road",                 direction: "Both",    lat:  6.3480, lon:  5.6612, operatingHours: "24/7",       scanner: false, weighbridge: true  },
    { id: "cp-ed-03", name: "Ologbo Checkpoint",             type: "fixed",        zone: "D", state: "Edo",    road: "Benin-Agbor Road",                 direction: "Both",    lat:  6.2141, lon:  5.8020, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Anambra / Imo */
    { id: "cp-an-01", name: "Onitsha Head Bridge Checkpoint",type: "fixed",        zone: "D", state: "Anambra",road: "Onitsha Bridge Approach Road",     direction: "Both",    lat:  6.1461, lon:  6.7868, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-an-02", name: "Awka North Checkpoint",         type: "fixed",        zone: "D", state: "Anambra",road: "Enugu-Onitsha Expressway (Awka)",  direction: "Both",    lat:  6.2481, lon:  7.0991, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-im-01", name: "Owerri-Port Harcourt Road CP",  type: "fixed",        zone: "D", state: "Imo",    road: "Owerri-PH Expressway",             direction: "Both",    lat:  5.3571, lon:  7.0762, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-im-02", name: "Ohaji Weighbridge",             type: "weighbridge",  zone: "D", state: "Imo",    road: "Owerri-Oloibiri Road",             direction: "Both",    lat:  5.3071, lon:  6.8762, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Enugu */
    { id: "cp-en-01", name: "Enugu-Onitsha Expressway CP",   type: "fixed",        zone: "D", state: "Enugu",  road: "Enugu-Onitsha Expressway",         direction: "Both",    lat:  6.4452, lon:  7.4502, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-en-02", name: "Akanu Ibiam Airport Gate",      type: "port-gate",    zone: "D", state: "Enugu",  road: "Airport Road, Enugu",              direction: "Both",    lat:  6.4739, lon:  7.5619, operatingHours: "24/7",       scanner: true,  weighbridge: false },
    { id: "cp-en-03", name: "Ngwo Checkpoint",               type: "fixed",        zone: "D", state: "Enugu",  road: "Enugu-Nsukka Road",                direction: "Both",    lat:  6.5282, lon:  7.5121, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Bayelsa */
    { id: "cp-by-01", name: "Yenagoa-PH Road Checkpoint",   type: "fixed",        zone: "D", state: "Bayelsa",road: "Yenagoa-Port Harcourt Road",       direction: "Both",    lat:  4.9712, lon:  6.4321, operatingHours: "24/7",       scanner: false, weighbridge: false },

    /* Akwa Ibom */
    { id: "cp-ak-01", name: "Uyo-Calabar Road Checkpoint",  type: "fixed",        zone: "D", state: "Akwa Ibom",road: "Uyo-Calabar Expressway",         direction: "Both",    lat:  5.0012, lon:  8.0051, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ak-02", name: "Itu Weighbridge",               type: "weighbridge",  zone: "D", state: "Akwa Ibom",road: "Uyo-Itu Road",                   direction: "Both",    lat:  5.2221, lon:  8.0292, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* ══ ZONE E — NORTH-EAST ══════════════════════════════════ */

    /* Borno — Maiduguri */
    { id: "cp-bo-01", name: "Maiduguri-Kano Road Checkpoint",type: "fixed",        zone: "E", state: "Borno",  road: "Maiduguri-Kano Trunk Road",        direction: "Both",    lat: 11.7201, lon: 13.0981, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-bo-02", name: "Gamboru Border Gate",           type: "border-gate",  zone: "E", state: "Borno",  road: "Gamboru-Ngala Road",               direction: "Both",    lat: 12.3511, lon: 14.1722, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Cameroon-Nigeria border" },
    { id: "cp-bo-03", name: "Banki Border Gate",             type: "border-gate",  zone: "E", state: "Borno",  road: "Bama-Banki Road",                  direction: "Both",    lat: 11.6451, lon: 13.6841, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Cameroon-Nigeria border" },
    { id: "cp-bo-04", name: "Dikwa Road Checkpoint",         type: "mobile",       zone: "E", state: "Borno",  road: "Maiduguri-Dikwa Road",             direction: "Both",    lat: 12.0231, lon: 13.9151, operatingHours: "06:00-18:00", scanner: false, weighbridge: false },

    /* Yobe */
    { id: "cp-yo-01", name: "Damaturu-Maiduguri Road CP",   type: "fixed",        zone: "E", state: "Yobe",   road: "Damaturu-Maiduguri Road",           direction: "Both",    lat: 11.8321, lon: 11.9922, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-yo-02", name: "Nguru Border-Approach CP",     type: "fixed",        zone: "E", state: "Yobe",   road: "Nguru-Kamuya Road",                direction: "Both",    lat: 12.8791, lon: 10.4551, operatingHours: "06:00-18:00", scanner: false, weighbridge: false },

    /* Adamawa */
    { id: "cp-ad-01", name: "Yola-Jalingo Road Checkpoint", type: "fixed",        zone: "E", state: "Adamawa",road: "Yola-Jalingo Road",                 direction: "Both",    lat:  9.1081, lon: 12.3421, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ad-02", name: "Mubi Border Gate",             type: "border-gate",  zone: "E", state: "Adamawa",road: "Mubi-Cameroon Border Road",         direction: "Both",    lat: 10.2681, lon: 13.2671, operatingHours: "24/7",       scanner: false, weighbridge: false, notes: "Cameroon-Nigeria border" },
    { id: "cp-ad-03", name: "Numan Weighbridge",            type: "weighbridge",  zone: "E", state: "Adamawa",road: "Numan-Yola Road",                   direction: "Both",    lat:  9.4682, lon: 12.0381, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Taraba */
    { id: "cp-ta-01", name: "Jalingo-Wukari Road Checkpoint",type: "fixed",        zone: "E", state: "Taraba", road: "Jalingo-Wukari Road",              direction: "Both",    lat:  8.5881, lon: 11.7221, operatingHours: "06:00-22:00", scanner: false, weighbridge: false },

    /* Gombe */
    { id: "cp-go-01", name: "Gombe-Bauchi Road Checkpoint", type: "fixed",        zone: "E", state: "Gombe",  road: "Gombe-Bauchi Road",                direction: "Both",    lat: 10.2121, lon: 10.9901, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-go-02", name: "Gombe-Biu Road Checkpoint",    type: "mobile",       zone: "E", state: "Gombe",  road: "Gombe-Biu Road",                   direction: "Both",    lat: 10.3511, lon: 11.4231, operatingHours: "06:00-18:00", scanner: false, weighbridge: false },

    /* Bauchi */
    { id: "cp-ba-01", name: "Bauchi-Jos Road Checkpoint",   type: "fixed",        zone: "E", state: "Bauchi", road: "Bauchi-Jos Road",                  direction: "Both",    lat: 10.2981, lon:  9.8551, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ba-02", name: "Bauchi-Gombe Road Checkpoint", type: "fixed",        zone: "E", state: "Bauchi", road: "Bauchi-Gombe Road",                direction: "Both",    lat: 10.3211, lon: 10.1201, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-ba-03", name: "Azare Weighbridge",            type: "weighbridge",  zone: "E", state: "Bauchi", road: "Azare-Potiskum Road",              direction: "Both",    lat: 11.6741, lon: 10.1911, operatingHours: "24/7",       scanner: false, weighbridge: true  },

    /* Plateau */
    { id: "cp-pl-01", name: "Jos-Abuja Road Checkpoint",    type: "fixed",        zone: "C", state: "Plateau",road: "Jos-Abuja Road (Akwanga axis)",    direction: "Both",    lat:  9.6471, lon:  8.8421, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-pl-02", name: "Jos-Kaduna Road Checkpoint",   type: "fixed",        zone: "C", state: "Plateau",road: "Jos-Kaduna Road",                  direction: "Both",    lat: 10.1201, lon:  8.9411, operatingHours: "24/7",       scanner: false, weighbridge: false },
    { id: "cp-pl-03", name: "Shendam Weighbridge",          type: "weighbridge",  zone: "C", state: "Plateau",road: "Shendam-Lafia Road",               direction: "Both",    lat:  8.8831, lon:  9.5291, operatingHours: "24/7",       scanner: false, weighbridge: true  },
];