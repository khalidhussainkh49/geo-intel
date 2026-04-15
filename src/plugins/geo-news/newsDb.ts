/**
 * newsDb.ts  — Supabase persistence for geo_news_articles
 *
 * ── Why "TypeError: fetch failed" happens ────────────────────
 *
 * This error comes from Node.js's native fetch() failing at the
 * network layer before Supabase even sees the request. Causes:
 *
 *   1. NEXT_PUBLIC_SUPABASE_URL is wrong / missing / has a typo
 *      e.g. missing "https://", trailing slash, wrong project ref
 *
 *   2. The module-level singleton `let _client` is created during
 *      Next.js module evaluation (before env vars are available
 *      in some deployment setups), so the URL baked into the
 *      client is undefined/"undefined"
 *
 *   3. DNS resolution failure in the server environment
 *      (e.g. restricted outbound network in some hosting setups)
 *
 *   4. Supabase project is paused (free tier pauses after 1 week
 *      of inactivity) — responds with a connection refused error
 *
 * ── Fixes applied in this version ───────────────────────────
 *
 *   - Client is created fresh per request (not module-level)
 *     so env vars are always read at call time
 *   - Detailed validation of URL and key before creating client
 *   - Explicit timeout via AbortSignal on the underlying fetch
 *   - Retry once on transient network errors
 *   - Clear console messages that tell you exactly what is wrong
 *
 * ── Required environment variables ──────────────────────────
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...   (Settings → API → service_role)
 *
 *   ⚠  Common mistakes:
 *     - Using the anon key instead of the service_role key
 *     - Putting quotes around the values in .env.local
 *     - Using SUPABASE_URL instead of NEXT_PUBLIC_SUPABASE_URL
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RawNewsArticle } from "./geoNewsTypes";

// ─── Environment validation ───────────────────────────────────

function getValidatedEnv(): { url: string; key: string } | null {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

    if (!url || !key) {
        console.error(
            "[newsDb] ❌ Missing environment variables.\n" +
            "  Set in .env.local:\n" +
            "    NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co\n" +
            "    SUPABASE_SERVICE_ROLE_KEY=eyJ..."
        );
        return null;
    }

    if (!url.startsWith("https://")) {
        console.error(
            `[newsDb] ❌ NEXT_PUBLIC_SUPABASE_URL must start with https://\n` +
            `  Got: "${url}"`
        );
        return null;
    }

    if (!url.includes(".supabase.co")) {
        console.error(
            `[newsDb] ❌ NEXT_PUBLIC_SUPABASE_URL doesn't look right.\n` +
            `  Expected format: https://<project-ref>.supabase.co\n` +
            `  Got: "${url}"`
        );
        return null;
    }

    if (!key.startsWith("eyJ")) {
        console.error(
            `[newsDb] ❌ SUPABASE_SERVICE_ROLE_KEY doesn't look like a JWT.\n` +
            `  Make sure you're using the service_role key, not the anon key.`
        );
        return null;
    }

    return { url, key };
}

// ─── Client factory ───────────────────────────────────────────
// Create fresh per function call — avoids module-evaluation timing
// issues where env vars aren't set yet when the singleton is created.
// Supabase client is lightweight; creation is not expensive.

function makeClient(): SupabaseClient | null {
    const env = getValidatedEnv();
    if (!env) return null;

    return createClient(env.url, env.key, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        },
        global: {
            // Timeout individual Supabase HTTP requests at 15 seconds
            fetch: (url, options = {}) => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 15_000);
                return fetch(url, { ...options, signal: controller.signal })
                    .finally(() => clearTimeout(timer));
            },
        },
    });
}

// ─── DB row type ──────────────────────────────────────────────

interface DbRow {
    id: string;
    title: string;
    summary: string | null;
    source: string;
    source_id: string;
    url: string;
    image_url: string | null;
    published_at: string;
    fetched_at: string;
    latitude: number;
    longitude: number;
    state: string | null;
    lga: string | null;
    category: string;
    severity: string;
    keywords: string[];
    country: string;
}

function sanitizeStr(str: string | null | undefined, maxLen = 0): string | null {
    if (!str) return null;
    let s = str.replace(/\0/g, ""); // Remove null bytes
    if (maxLen > 0) s = s.slice(0, maxLen);
    return s || null;
}

function articleToRow(article: RawNewsArticle, sourceId: string): DbRow {
    return {
        id: article.id,
        title: sanitizeStr(article.title, 1000) ?? "No Title",
        summary: sanitizeStr(article.summary, 2000),
        source: sanitizeStr(article.source, 0) ?? "Unknown",
        source_id: sanitizeStr(sourceId, 0) ?? "unknown",
        url: sanitizeStr(article.url, 2000) ?? "",
        image_url: sanitizeStr(article.imageUrl, 2000),
        published_at: article.publishedAt,
        fetched_at: new Date().toISOString(),
        latitude: Number.isNaN(article.latitude) ? 0 : article.latitude,
        longitude: Number.isNaN(article.longitude) ? 0 : article.longitude,
        state: sanitizeStr(article.state, 100),
        lga: sanitizeStr(article.lga, 100),
        category: article.category,
        severity: article.severity,
        keywords: (article.keywords ?? []).map(k => k.replace(/\0/g, "")).slice(0, 20),
        country: "NG",
    };
}

function rowToArticle(row: DbRow): RawNewsArticle {
    return {
        id: row.id,
        title: row.title,
        summary: row.summary ?? "",
        source: row.source,
        url: row.url,
        imageUrl: row.image_url ?? undefined,
        publishedAt: row.published_at,
        latitude: row.latitude,
        longitude: row.longitude,
        state: row.state ?? "",
        lga: row.lga ?? undefined,
        category: row.category as any,
        severity: row.severity as any,
        keywords: row.keywords ?? [],
    };
}

// ─── Retry wrapper ────────────────────────────────────────────

async function withRetry<T>(
    label: string,
    fn: () => Promise<T>,
    retries = 1
): Promise<T | null> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const isLast = attempt === retries;
            const msg = err?.message ?? String(err);
            const isNetwork = msg.includes("fetch failed") ||
                msg.includes("ECONNREFUSED") ||
                msg.includes("ETIMEDOUT") ||
                err?.name === "AbortError";

            if (isNetwork) {
                console.error(
                    `[newsDb] ❌ Network error on ${label} (attempt ${attempt + 1}/${retries + 1}): ${msg}\n` +
                    (isLast
                        ? "  Possible causes:\n" +
                        "    • Supabase project is paused (free tier → Resume in dashboard)\n" +
                        "    • NEXT_PUBLIC_SUPABASE_URL is incorrect\n" +
                        "    • Outbound network restricted in this environment"
                        : "  Retrying...")
                );
            } else {
                console.error(`[newsDb] ❌ Error on ${label}: ${msg}`);
            }

            if (isLast) return null;

            // Wait 2 seconds before retry
            await new Promise(r => setTimeout(r, 2000));
        }
    }
    return null;
}

// ─── Public API ───────────────────────────────────────────────

const CHUNK_SIZE = 50;

/**
 * Fetch recent articles from Supabase.
 * This is the primary read path — called by /api/geo-news GET.
 */
export async function getRecentArticles(options: {
    hours?: number;
    limit?: number;
    severity?: string[];
    category?: string[];
    state?: string;
} = {}): Promise<RawNewsArticle[]> {

    const {
        hours = 168,   // default 7 days — plugin filters client-side
        limit = 2000,
        severity,
        category,
        state,
    } = options;

    const result = await withRetry("getRecentArticles", async () => {
        const sb = makeClient();
        if (!sb) throw new Error("Supabase client could not be created — check env vars");

        const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

        let query = sb
            .from("geo_news_articles")
            .select("id, title, summary, source, url, image_url, published_at, latitude, longitude, state, lga, category, severity, keywords")
            .gte("published_at", cutoff)
            .order("published_at", { ascending: false })
            .limit(limit);

        if (severity?.length) query = query.in("severity", severity);
        if (category?.length) query = query.in("category", category);
        if (state) query = query.ilike("state", `%${state}%`);

        const { data, error } = await query;

        if (error) {
            // Supabase query errors are not network errors — log them clearly
            console.error(
                `[newsDb] ❌ Query error in getRecentArticles:\n` +
                `  Code:    ${error.code}\n` +
                `  Message: ${error.message}\n` +
                `  Details: ${error.details ?? "none"}\n` +
                `  Hint:    ${error.hint ?? "none"}\n` +
                `\n  If code is "42P01" the table doesn't exist — run sql_migration.sql`
            );
            throw new Error(error.message);
        }

        return data ?? [];
    });

    if (!result) return [];

    const articles = (result as DbRow[]).map(rowToArticle);
    console.log(`[newsDb] ✓ getRecentArticles: ${articles.length} rows (last ${hours}h)`);
    return articles;
}

/**
 * Upsert articles into Supabase.
 * Called by the pipeline after fetching from RSS sources.
 */
export async function saveArticles(
    articles: RawNewsArticle[],
    sourceId: string
): Promise<number> {
    if (articles.length === 0) return 0;

    let inserted = 0;

    for (let i = 0; i < articles.length; i += CHUNK_SIZE) {
        const chunk = articles.slice(i, i + CHUNK_SIZE);

        const result = await withRetry(`saveArticles[${sourceId}] chunk ${i}`, async () => {
            const sb = makeClient();
            if (!sb) throw new Error("Supabase client could not be created");

            const rows = chunk.map(a => articleToRow(a, sourceId));

            const { error, count } = await sb
                .from("geo_news_articles")
                .upsert(rows, {
                    onConflict: "url",
                    ignoreDuplicates: true,
                    count: "exact",
                });

            if (error) {
                console.error(`[newsDb] ❌ Upsert error (${sourceId}): ${error.message}`);
                throw new Error(error.message);
            }

            return count ?? 0;
        });

        inserted += result ?? 0;
    }

    return inserted;
}

/**
 * Return only the IDs from the given list that are NOT already in the DB.
 * Used by the pipeline to skip re-processing known articles.
 */
export async function filterNewIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    const result = await withRetry("filterNewIds", async () => {
        const sb = makeClient();
        if (!sb) throw new Error("Supabase client could not be created");

        const { data, error } = await sb
            .from("geo_news_articles")
            .select("id")
            .in("id", ids);

        if (error) throw new Error(error.message);
        return data ?? [];
    });

    if (!result) {
        // On failure, assume all are new — better to re-process than to skip
        return ids;
    }

    const existing = new Set(result.map((r: { id: string }) => r.id));
    return ids.filter(id => !existing.has(id));
}

/**
 * Article count per source for the last 24h.
 * Useful for health checks / admin panels.
 */
export async function getSourceStats(): Promise<Record<string, number>> {
    const result = await withRetry("getSourceStats", async () => {
        const sb = makeClient();
        if (!sb) throw new Error("Supabase client could not be created");

        const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
        const { data, error } = await sb
            .from("geo_news_articles")
            .select("source_id")
            .gte("fetched_at", cutoff);

        if (error) throw new Error(error.message);
        return data ?? [];
    });

    if (!result) return {};

    const counts: Record<string, number> = {};
    for (const row of result) {
        counts[row.source_id] = (counts[row.source_id] ?? 0) + 1;
    }
    return counts;
}

/**
 * Delete articles older than `days` days.
 */
export async function pruneOldArticles(days = 30): Promise<number> {
    const result = await withRetry("pruneOldArticles", async () => {
        const sb = makeClient();
        if (!sb) throw new Error("Supabase client could not be created");

        const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
        const { count, error } = await sb
            .from("geo_news_articles")
            .delete({ count: "exact" })
            .lt("published_at", cutoff);

        if (error) throw new Error(error.message);
        return count ?? 0;
    });

    return result ?? 0;
}

/**
 * Health check — verifies Supabase connection and table existence.
 * Call from /api/geo-news/health to diagnose issues.
 */
export async function checkDbHealth(): Promise<{
    ok: boolean;
    message: string;
    count?: number;
}> {
    const env = getValidatedEnv();
    if (!env) {
        return { ok: false, message: "Missing or invalid environment variables" };
    }

    try {
        const sb = makeClient()!;
        const { count, error } = await sb
            .from("geo_news_articles")
            .select("*", { count: "exact", head: true });

        if (error) {
            if (error.code === "42P01") {
                return {
                    ok: false,
                    message: "Table 'geo_news_articles' does not exist — run sql_migration.sql",
                };
            }
            return { ok: false, message: `Query error: ${error.message}` };
        }

        return {
            ok: true,
            message: `Connected. ${count ?? 0} total articles in table.`,
            count: count ?? 0,
        };
    } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
            return {
                ok: false,
                message:
                    "Cannot reach Supabase. Check:\n" +
                    "  1. NEXT_PUBLIC_SUPABASE_URL is correct\n" +
                    "  2. Supabase project is not paused\n" +
                    "  3. Outbound HTTPS (port 443) is not blocked",
            };
        }
        return { ok: false, message: msg };
    }
}



// /**
//  * newsDb.ts
//  *
//  * Supabase persistence for geo_news_articles.
//  * All database operations for the GeoNews pipeline live here.
//  *
//  * ── Table DDL ─────────────────────────────────────────────────
//  * Run this SQL once in Supabase Studio → SQL Editor:
//  *
//  * CREATE TABLE public.geo_news_articles (
//  *     id              TEXT PRIMARY KEY,
//  *     title           TEXT NOT NULL,
//  *     summary         TEXT,
//  *     source          TEXT NOT NULL,
//  *     source_id       TEXT NOT NULL,   -- source registry id (e.g. "punch")
//  *     url             TEXT NOT NULL UNIQUE,
//  *     image_url       TEXT,
//  *     published_at    TIMESTAMPTZ NOT NULL,
//  *     fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
//  *     latitude        DOUBLE PRECISION NOT NULL,
//  *     longitude       DOUBLE PRECISION NOT NULL,
//  *     state           TEXT,
//  *     lga             TEXT,
//  *     category        TEXT NOT NULL,
//  *     severity        TEXT NOT NULL,
//  *     keywords        TEXT[] DEFAULT '{}',
//  *     country         TEXT NOT NULL DEFAULT 'NG',
//  *     is_nigeria      BOOLEAN GENERATED ALWAYS AS (country = 'NG') STORED
//  * );
//  *
//  * -- Indexes for common query patterns
//  * CREATE INDEX idx_geo_news_published   ON public.geo_news_articles (published_at DESC);
//  * CREATE INDEX idx_geo_news_category    ON public.geo_news_articles (category);
//  * CREATE INDEX idx_geo_news_severity    ON public.geo_news_articles (severity);
//  * CREATE INDEX idx_geo_news_state       ON public.geo_news_articles (state);
//  * CREATE INDEX idx_geo_news_fetched_at  ON public.geo_news_articles (fetched_at DESC);
//  *
//  * -- Public read-only access
//  * ALTER TABLE public.geo_news_articles ENABLE ROW LEVEL SECURITY;
//  * CREATE POLICY "public read" ON public.geo_news_articles FOR SELECT USING (true);
//  *
//  * -- Auto-delete articles older than 30 days (optional cron, or pg_cron):
//  * -- SELECT cron.schedule('0 3 * * *', $$
//  * --   DELETE FROM geo_news_articles WHERE published_at < now() - interval '30 days';
//  * -- $$);
//  *
//  * ── Environment variables needed ──────────────────────────────
//  * NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
//  * SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//  */

// import { createClient, type SupabaseClient } from "@supabase/supabase-js";
// import type { RawNewsArticle } from "./geoNewsTypes";

// // ─── Supabase client (server-only, uses service role key) ─────

// let _client: SupabaseClient | null = null;

// function getClient(): SupabaseClient | null {
//     if (_client) return _client;
//     const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
//     const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
//     if (!url || !key) {
//         console.warn("[newsDb] Supabase not configured — skipping DB operations");
//         return null;
//     }
//     _client = createClient(url, key, {
//         auth: { persistSession: false },
//     });
//     return _client;
// }

// // ─── DB row type ──────────────────────────────────────────────

// interface DbRow {
//     id:           string;
//     title:        string;
//     summary:      string | null;
//     source:       string;
//     source_id:    string;
//     url:          string;
//     image_url:    string | null;
//     published_at: string;
//     fetched_at:   string;
//     latitude:     number;
//     longitude:    number;
//     state:        string | null;
//     lga:          string | null;
//     category:     string;
//     severity:     string;
//     keywords:     string[];
//     country:      string;
// }

// function articleToRow(article: RawNewsArticle, sourceId: string): DbRow {
//     return {
//         id:           article.id,
//         title:        article.title,
//         summary:      article.summary || null,
//         source:       article.source,
//         source_id:    sourceId,
//         url:          article.url,
//         image_url:    article.imageUrl ?? null,
//         published_at: article.publishedAt,
//         fetched_at:   new Date().toISOString(),
//         latitude:     article.latitude,
//         longitude:    article.longitude,
//         state:        article.state || null,
//         lga:          article.lga ?? null,
//         category:     article.category,
//         severity:     article.severity,
//         keywords:     article.keywords ?? [],
//         country:      "NG",
//     };
// }

// function rowToArticle(row: DbRow): RawNewsArticle {
//     return {
//         id:          row.id,
//         title:       row.title,
//         summary:     row.summary ?? "",
//         source:      row.source,
//         url:         row.url,
//         imageUrl:    row.image_url ?? undefined,
//         publishedAt: row.published_at,
//         latitude:    row.latitude,
//         longitude:   row.longitude,
//         state:       row.state ?? "",
//         lga:         row.lga ?? undefined,
//         category:    row.category as any,
//         severity:    row.severity as any,
//         keywords:    row.keywords ?? [],
//     };
// }

// // ─── Public API ───────────────────────────────────────────────

// const CHUNK_SIZE = 50;

// /**
//  * Upsert articles into the database.
//  * Uses ON CONFLICT DO NOTHING so duplicate URLs are silently skipped.
//  * Returns the count of newly inserted rows.
//  */
// export async function saveArticles(
//     articles: RawNewsArticle[],
//     sourceId: string
// ): Promise<number> {
//     const sb = getClient();
//     if (!sb || articles.length === 0) return 0;

//     let inserted = 0;

//     for (let i = 0; i < articles.length; i += CHUNK_SIZE) {
//         const chunk = articles.slice(i, i + CHUNK_SIZE);
//         const rows  = chunk.map(a => articleToRow(a, sourceId));

//         const { error, count } = await sb
//             .from("geo_news_articles")
//             .upsert(rows, {
//                 onConflict:        "url",
//                 ignoreDuplicates:  true,
//                 count:             "exact",
//             });

//         if (error) {
//             console.error("[newsDb] upsert error:", error.message);
//         } else {
//             inserted += count ?? 0;
//         }
//     }

//     return inserted;
// }

// /**
//  * Fetch recent articles from the DB, optionally filtered.
//  * Used by the /api/geo-news GET handler so the client always
//  * reads from the DB (the server-side poller writes to it).
//  */
// export async function getRecentArticles(options: {
//     limit?:    number;
//     hours?:    number;      // articles published within last N hours
//     severity?: string[];
//     category?: string[];
//     state?:    string;
// } = {}): Promise<RawNewsArticle[]> {
//     const sb = getClient();
//     if (!sb) return [];

//     const {
//         limit    = 200,
//         hours    = 24,
//         severity,
//         category,
//         state,
//     } = options;

//     const cutoff = new Date(Date.now() - hours * 3600).toISOString();

//     let query = sb
//         .from("geo_news_articles")
//         .select("*")
//         .gte("published_at", cutoff)
//         .order("published_at", { ascending: false })
//         .limit(limit);

//     if (severity?.length) query = query.in("severity", severity);
//     if (category?.length) query = query.in("category", category);
//     if (state)            query = query.ilike("state", `%${state}%`);

//     const { data, error } = await query;

//     if (error) {
//         console.error("[newsDb] select error:", error.message);
//         return [];
//     }

//     return (data ?? []).map(rowToArticle);
// }

// /**
//  * Check which article IDs already exist in the DB.
//  * Used to avoid re-processing articles we've already stored.
//  */
// export async function filterNewIds(ids: string[]): Promise<string[]> {
//     const sb = getClient();
//     if (!sb || ids.length === 0) return ids;

//     const { data } = await sb
//         .from("geo_news_articles")
//         .select("id")
//         .in("id", ids);

//     const existing = new Set((data ?? []).map((r: { id: string }) => r.id));
//     return ids.filter(id => !existing.has(id));
// }

// /**
//  * Get article count per source for the last 24 hours.
//  * Useful for monitoring which sources are producing data.
//  */
// export async function getSourceStats(): Promise<Record<string, number>> {
//     const sb = getClient();
//     if (!sb) return {};

//     const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();

//     const { data } = await sb
//         .from("geo_news_articles")
//         .select("source_id")
//         .gte("fetched_at", cutoff);

//     const counts: Record<string, number> = {};
//     for (const row of (data ?? [])) {
//         counts[row.source_id] = (counts[row.source_id] ?? 0) + 1;
//     }
//     return counts;
// }

// /**
//  * Delete articles older than `days` days.
//  * Call from a scheduled cron route or Supabase pg_cron.
//  */
// export async function pruneOldArticles(days = 30): Promise<number> {
//     const sb = getClient();
//     if (!sb) return 0;

//     const cutoff = new Date(Date.now() - days * 86400_000).toISOString();

//     const { count, error } = await sb
//         .from("geo_news_articles")
//         .delete({ count: "exact" })
//         .lt("published_at", cutoff);

//     if (error) {
//         console.error("[newsDb] prune error:", error.message);
//         return 0;
//     }

//     return count ?? 0;
// }