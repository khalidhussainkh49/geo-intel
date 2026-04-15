/**
 * src/app/api/geo-news/export/route.ts
 *
 * Streams a CSV file of geo-news articles directly from Supabase.
 * All filtering happens server-side so the client never has to
 * download the full dataset before exporting a small slice.
 *
 * ── Query parameters ──────────────────────────────────────────
 *
 *   Date / time range (pick ONE approach):
 *     ?from=2024-01-01T00:00:00Z    ISO start datetime (inclusive)
 *     ?to=2024-01-31T23:59:59Z      ISO end   datetime (inclusive)
 *     ?hours=24                     Last N hours (1–8760, i.e. up to 1yr)
 *       → If both ?from/?to and ?hours are provided, ?from/?to wins.
 *
 *   Content filters (all optional, combinable):
 *     ?severity=critical,high       Comma-separated severity levels
 *     ?category=terrorism,flooding  Comma-separated categories
 *     ?state=Borno,Lagos            Comma-separated Nigerian states
 *     ?source=punch,channels        Comma-separated source IDs
 *     ?keyword=bandit               Text search in title+summary
 *
 *   Output control:
 *     ?limit=5000                   Max rows (default 5000, max 50000)
 *     ?columns=id,title,category    Pick only specific columns
 *     ?filename=ncs_export          Custom filename (without .csv)
 *
 * ── Example URLs ──────────────────────────────────────────────
 *
 *   All critical events in Borno in the last 48h:
 *   /api/geo-news/export?hours=48&severity=critical&state=Borno
 *
 *   All terrorism + kidnapping events, Jan 2024:
 *   /api/geo-news/export?from=2024-01-01T00:00:00Z&to=2024-01-31T23:59:59Z&category=terrorism,kidnapping
 *
 *   Last 7 days, all events, custom filename:
 *   /api/geo-news/export?hours=168&filename=weekly_report
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { AlertSeverity, AlertCategory } from "@/core/state/alertsSlice";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // allow up to 30s for large exports

// ─── CSV helpers ──────────────────────────────────────────────

/** Escape a value for CSV: wrap in quotes, double any internal quotes */
function csvCell(val: unknown): string {
    if (val === null || val === undefined) return "";
    const str = Array.isArray(val) ? val.join("; ") : String(val);
    // If contains comma, quote, or newline → wrap in double-quotes
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

function csvRow(values: unknown[]): string {
    return values.map(csvCell).join(",");
}

// ─── All available columns ────────────────────────────────────

interface ColumnDef {
    key: string;          // CSV header name
    db: string | null;   // DB column name (null = computed)
    desc: string;          // description shown in UI
    getValue: (row: any) => unknown;
}

const ALL_COLUMNS: ColumnDef[] = [
    { key: "id", db: "id", desc: "Article ID", getValue: r => r.id },
    { key: "title", db: "title", desc: "Headline", getValue: r => r.title },
    { key: "summary", db: "summary", desc: "Article summary", getValue: r => r.summary },
    { key: "source", db: "source", desc: "News source name", getValue: r => r.source },
    { key: "source_id", db: "source_id", desc: "Source registry ID", getValue: r => r.source_id },
    { key: "url", db: "url", desc: "Article URL", getValue: r => r.url },
    { key: "published_at", db: "published_at", desc: "Published datetime", getValue: r => r.published_at },
    { key: "fetched_at", db: "fetched_at", desc: "Fetched datetime", getValue: r => r.fetched_at },
    { key: "category", db: "category", desc: "Event category", getValue: r => r.category },
    { key: "severity", db: "severity", desc: "Severity level", getValue: r => r.severity },
    { key: "state", db: "state", desc: "Nigerian state", getValue: r => r.state },
    { key: "lga", db: "lga", desc: "Local Government Area", getValue: r => r.lga },
    { key: "latitude", db: "latitude", desc: "Latitude (WGS84)", getValue: r => r.latitude },
    { key: "longitude", db: "longitude", desc: "Longitude (WGS84)", getValue: r => r.longitude },
    { key: "keywords", db: "keywords", desc: "Matched keywords", getValue: r => Array.isArray(r.keywords) ? r.keywords.join("; ") : "" },
    { key: "country", db: "country", desc: "Country code", getValue: r => r.country },
];

const DEFAULT_COLUMNS = ALL_COLUMNS.map(c => c.key);

// ─── Route handler ────────────────────────────────────────────

export async function GET(req: NextRequest) {
    // ── Env check ─────────────────────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!supabaseUrl || !serviceKey) {
        return NextResponse.json(
            { error: "Supabase not configured on this server." },
            { status: 503 }
        );
    }

    const sp = req.nextUrl.searchParams;

    // ── Parse date range ──────────────────────────────────────
    let fromDate: Date;
    let toDate: Date = new Date();

    const fromParam = sp.get("from");
    const toParam = sp.get("to");
    const hoursParam = sp.get("hours");

    if (fromParam) {
        fromDate = new Date(fromParam);
        if (isNaN(fromDate.getTime())) {
            return NextResponse.json({ error: `Invalid ?from date: "${fromParam}"` }, { status: 400 });
        }
        if (toParam) {
            toDate = new Date(toParam);
            if (isNaN(toDate.getTime())) {
                return NextResponse.json({ error: `Invalid ?to date: "${toParam}"` }, { status: 400 });
            }
        }
    } else {
        const hours = Math.max(1, Math.min(parseInt(hoursParam ?? "24", 10), 8760));
        fromDate = new Date(Date.now() - hours * 3_600_000);
    }

    // ── Parse filters ─────────────────────────────────────────
    const severityParam = sp.get("severity");
    const categoryParam = sp.get("category");
    const stateParam = sp.get("state");
    const sourceParam = sp.get("source");
    const keyword = sp.get("keyword")?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(parseInt(sp.get("limit") ?? "5000", 10), 50_000));

    const severities = severityParam
        ? (severityParam.split(",").map(s => s.trim()) as AlertSeverity[])
        : undefined;
    const categories = categoryParam
        ? (categoryParam.split(",").map(s => s.trim()) as AlertCategory[])
        : undefined;
    const states = stateParam
        ? stateParam.split(",").map(s => s.trim())
        : undefined;
    const sources = sourceParam
        ? sourceParam.split(",").map(s => s.trim())
        : undefined;

    // ── Parse column selection ────────────────────────────────
    const colParam = sp.get("columns");
    const wantedKeys = colParam
        ? colParam.split(",").map(s => s.trim())
        : DEFAULT_COLUMNS;

    const columns = ALL_COLUMNS.filter(c => wantedKeys.includes(c.key));
    if (columns.length === 0) {
        return NextResponse.json({ error: "No valid columns selected." }, { status: 400 });
    }

    // ── Parse filename ────────────────────────────────────────
    const rawFilename = sp.get("filename") ?? "ncs_geointel_export";
    const safeFilename = rawFilename.replace(/[^a-z0-9_\-]/gi, "_").slice(0, 80);
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `${safeFilename}_${timestamp}.csv`;

    // ── Build Supabase query ──────────────────────────────────
    const sb = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
            fetch: (url, opts = {}) => {
                const ctrl = new AbortController();
                const t = setTimeout(() => ctrl.abort(), 25_000);
                return fetch(url, { ...opts, signal: ctrl.signal })
                    .finally(() => clearTimeout(t));
            },
        },
    });

    // Select only the DB columns we actually need
    const dbCols = [
        ...new Set(
            columns
                .map(c => c.db)
                .filter(Boolean) as string[]
        ),
    ].join(", ");

    let query = sb
        .from("geo_news_articles")
        .select(dbCols)
        .gte("published_at", fromDate.toISOString())
        .lte("published_at", toDate.toISOString())
        .order("published_at", { ascending: false })
        .limit(limit);

    if (severities?.length) query = query.in("severity", severities);
    if (categories?.length) query = query.in("category", categories);
    if (sources?.length) query = query.in("source_id", sources);

    // State filter: OR across each state (ilike doesn't support array natively)
    // Use .or() with multiple ilike conditions
    if (states?.length) {
        const stateFilter = states
            .map(s => `state.ilike.%${s.replace(/[%_]/g, "\\$&")}%`)
            .join(",");
        query = query.or(stateFilter);
    }

    // ── Execute ───────────────────────────────────────────────
    let data: any[];

    try {
        const { data: rows, error } = await query;

        if (error) {
            console.error("[geo-news/export] Supabase error:", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        data = rows ?? [];

    } catch (err: any) {
        console.error("[geo-news/export] Network error:", err.message);
        return NextResponse.json(
            { error: `Database connection failed: ${err.message}` },
            { status: 503 }
        );
    }

    // ── Optional keyword filter (client-side after DB fetch) ──
    // We do this in JS rather than SQL to support full-text search
    // across both title and summary without full-text indexes
    if (keyword) {
        data = data.filter(row => {
            const text = `${row.title ?? ""} ${row.summary ?? ""}`.toLowerCase();
            return text.includes(keyword);
        });
    }

    // ── Build CSV ─────────────────────────────────────────────

    // Header comment block (metadata about the export)
    const meta = [
        `# NCS GeoIntel — Geo-News Export`,
        `# Generated: ${new Date().toISOString()}`,
        `# Period:    ${fromDate.toISOString()} → ${toDate.toISOString()}`,
        `# Filters:   severity=${severities?.join("+") ?? "all"} | category=${categories?.join("+") ?? "all"} | state=${states?.join("+") ?? "all"} | keyword=${keyword ?? "none"}`,
        `# Records:   ${data.length}`,
        `#`,
    ].join("\n");

    const header = csvRow(columns.map(c => c.key));
    const rows = data.map(row => csvRow(columns.map(c => c.getValue(row))));

    const csv = [meta, header, ...rows].join("\n");

    // ── Return as downloadable file ───────────────────────────
    return new NextResponse(csv, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
            "X-Record-Count": String(data.length),
        },
    });
}

// ── GET /api/geo-news/export?meta=1  → return column list as JSON ──
// Used by the UI to populate the column picker
export async function OPTIONS() {
    return NextResponse.json({
        columns: ALL_COLUMNS.map(c => ({ key: c.key, desc: c.desc })),
        categories: [
            "terrorism", "banditry", "kidnapping", "flooding",
            "communal-clash", "armed-robbery", "military-op",
            "protest", "accident", "other",
        ],
        severities: ["critical", "high", "medium", "low"],
    });
}