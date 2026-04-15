/**
 * src/app/api/geo-news/route.ts
 *
 * GET  /api/geo-news
 *   Returns articles from Supabase.
 *   The plugin fetches ALL articles (?limit=2000) and filters
 *   client-side by timeRange — this is faster than a round-trip
 *   per time window button press.
 *
 *   Optional query params (for admin/debug use):
 *     ?limit=2000
 *     ?hours=168        override time cutoff
 *     ?severity=critical,high
 *     ?category=terrorism
 *     ?state=Borno
 *
 * POST /api/geo-news
 *   Runs the RSS pipeline → saves new articles to Supabase.
 *   Protected by x-cron-secret or Authorization: Bearer header.
 */

import { NextRequest, NextResponse } from "next/server";
import { getRecentArticles } from "@/plugins/geo-news/newsDb";
import { runNewsPipeline }   from "@/plugins/geo-news/newsPipeline";
import type { AlertSeverity, AlertCategory } from "@/core/state/alertsSlice";

export const dynamic = "force-dynamic";

// ─── GET ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
    try {
        const sp = req.nextUrl.searchParams;

        // Default: return last 168 hours (7 days) — the widest window.
        // The plugin holds all of these in memory and filters client-side.
        const hours    = Math.max(1, Math.min(
            parseInt(sp.get("hours") ?? "168", 10), 168
        ));
        const limit    = Math.max(1, Math.min(
            parseInt(sp.get("limit") ?? "2000", 10), 5000
        ));
        const sevParam = sp.get("severity");
        const catParam = sp.get("category");
        const state    = sp.get("state") ?? undefined;

        const severity = sevParam ? (sevParam.split(",") as AlertSeverity[]) : undefined;
        const category = catParam ? (catParam.split(",") as AlertCategory[]) : undefined;

        const articles = await getRecentArticles({
            hours,
            limit,
            severity,
            category,
            state,
        });

        // Sort: severity first, then newest
        const SEV_RANK: Record<string, number> = {
            critical: 0, high: 1, medium: 2, low: 3,
        };
        articles.sort((a, b) => {
            const sd = (SEV_RANK[a.severity] ?? 4) - (SEV_RANK[b.severity] ?? 4);
            if (sd !== 0) return sd;
            return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        });

        return NextResponse.json(articles, {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
                "X-Article-Count": String(articles.length),
            },
        });

    } catch (err) {
        console.error("[geo-news/GET] Error:", err);
        return NextResponse.json([], { status: 200 });
    }
}

// ─── POST (cron trigger) ──────────────────────────────────────

export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const auth = req.headers.get("x-cron-secret")
                  ?? req.headers.get("authorization");
        if (auth !== secret && auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    try {
        const start  = Date.now();
        console.log("[geo-news/POST] Pipeline triggered at", new Date().toISOString());

        const result = await runNewsPipeline({ saveToDb: true, concurrency: 8 });
        const ms     = Date.now() - start;

        console.log(
            `[geo-news/POST] Done in ${ms}ms: ` +
            `${result.total} processed, ${result.saved} saved, ` +
            `${result.skipped} skipped`
        );

        return NextResponse.json({
            ok:        true,
            total:     result.total,
            saved:     result.saved,
            skipped:   result.skipped,
            errors:    result.errors,
            bySource:  result.bySource,
            ms,
            timestamp: new Date().toISOString(),
        });

    } catch (err: any) {
        console.error("[geo-news/POST] Pipeline error:", err);
        return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
}





// /**
//  * src/app/api/geo-news/route.ts
//  *
//  * GET  /api/geo-news
//  *   Reads articles from Supabase.
//  *   Returns [] (empty array) when DB is empty — no GDELT fallback.
//  *
//  *   Query params:
//  *     ?hours=24          articles published in last N hours  (default 24)
//  *     ?limit=500         max rows returned                   (default 500)
//  *     ?severity=critical,high
//  *     ?category=terrorism,kidnapping
//  *     ?state=Borno
//  *
//  *   The plugin sends ?hours= computed from the active timeRange
//  *   so the 1h / 6h / 24h / 48h / 7d header buttons filter the DB.
//  *
//  * POST /api/geo-news
//  *   Runs the full RSS pipeline → saves new articles to Supabase.
//  *   Protected by CRON_SECRET header.
//  *   Called by /api/geo-news/poll (Vercel cron) every 5 minutes.
//  *
//  * ── Required env vars ─────────────────────────────────────────
//  *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
//  *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//  *   CRON_SECRET=any_secret_string
//  */

// import { NextRequest, NextResponse } from "next/server";
// import { getRecentArticles }  from "@/plugins/geo-news/newsDb";
// import { runNewsPipeline }    from "@/plugins/geo-news/newsPipeline";
// import type { AlertSeverity, AlertCategory } from "@/core/state/alertsSlice";

// export const dynamic = "force-dynamic";

// // ─── GET — read articles from DB ─────────────────────────────

// export async function GET(req: NextRequest) {
//     try {
//         const sp = req.nextUrl.searchParams;

//         // Parse query params — all optional
//         const hours    = Math.max(1, Math.min(parseInt(sp.get("hours")  ?? "24",  10), 168));
//         const limit    = Math.max(1, Math.min(parseInt(sp.get("limit")  ?? "500", 10), 2000));
//         const sevParam = sp.get("severity");
//         const catParam = sp.get("category");
//         const state    = sp.get("state") ?? undefined;

//         const severity = sevParam ? (sevParam.split(",") as AlertSeverity[]) : undefined;
//         const category = catParam ? (catParam.split(",") as AlertCategory[]) : undefined;

//         const articles = await getRecentArticles({
//             hours,
//             limit,
//             severity,
//             category,
//             state,
//         });

//         // Sort: severity first (critical → low), then newest first
//         const SEV_RANK: Record<string, number> = {
//             critical: 0, high: 1, medium: 2, low: 3,
//         };
//         articles.sort((a, b) => {
//             const sd = (SEV_RANK[a.severity] ?? 4) - (SEV_RANK[b.severity] ?? 4);
//             if (sd !== 0) return sd;
//             return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
//         });

//         return NextResponse.json(articles, {
//             status:  200,
//             headers: { "Cache-Control": "no-store" },
//         });

//     } catch (err) {
//         console.error("[geo-news/GET] Unhandled error:", err);
//         // Always return a valid array so the plugin doesn't crash
//         return NextResponse.json([], { status: 200 });
//     }
// }

// // ─── POST — run pipeline (called by cron) ────────────────────

// export async function POST(req: NextRequest) {
//     // Protect the pipeline trigger
//     const secret = process.env.CRON_SECRET;
//     if (secret) {
//         const auth = req.headers.get("x-cron-secret")
//                   ?? req.headers.get("authorization");
//         if (auth !== secret && auth !== `Bearer ${secret}`) {
//             return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
//         }
//     }

//     try {
//         const start  = Date.now();
//         console.log("[geo-news/POST] Pipeline triggered at", new Date().toISOString());

//         const result = await runNewsPipeline({ saveToDb: true, concurrency: 8 });
//         const ms     = Date.now() - start;

//         console.log(
//             `[geo-news/POST] Done in ${ms}ms: ` +
//             `${result.total} processed, ${result.saved} saved, ` +
//             `${result.skipped} skipped`
//         );

//         return NextResponse.json({
//             ok:       true,
//             total:    result.total,
//             saved:    result.saved,
//             skipped:  result.skipped,
//             errors:   result.errors,
//             bySource: result.bySource,
//             ms,
//             timestamp: new Date().toISOString(),
//         });

//     } catch (err: any) {
//         console.error("[geo-news/POST] Pipeline error:", err);
//         return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
//     }
// }



// /**
//  * src/app/api/geo-news/route.ts
//  *
//  * GET  /api/geo-news
//  *   → Reads recent articles from Supabase DB.
//  *   → If DB is empty or Supabase is not configured, falls back to
//  *     running the pipeline inline (GDELT + available RSS sources).
//  *   → Accepts query params:
//  *       ?hours=24          articles from last N hours (default 24)
//  *       ?severity=critical,high
//  *       ?category=terrorism,kidnapping
//  *       ?state=Borno
//  *       ?limit=200
//  *
//  * POST /api/geo-news
//  *   → Runs the full news pipeline (fetch all sources → classify → geocode → save).
//  *   → Called by the server-side cron at /api/geo-news/poll.
//  *   → Protected by CRON_SECRET header.
//  *   → Returns pipeline stats (total fetched, saved, errors).
//  *
//  * ── Environment variables ──────────────────────────────────────
//  * Required for DB storage:
//  *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
//  *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//  *
//  * Required to protect the POST cron trigger:
//  *   CRON_SECRET=any_random_secret_string
//  *
//  * Optional additional sources:
//  *   NEWS_API_KEY=your_newsapi_org_key
//  *   ACLED_API_KEY=your_acled_key
//  *   ACLED_EMAIL=your_acled_email
//  */

// import { NextRequest, NextResponse } from "next/server";
// import { getRecentArticles } from "@/plugins/geo-news/newsDb";
// import { runNewsPipeline }   from "@/plugins/geo-news/newsPipeline";
// import { fetchGdeltFallback } from "@/plugins/geo-news/gdeltFallback";
// import type { AlertSeverity, AlertCategory } from "@/core/state/alertsSlice";

// export const dynamic = "force-dynamic";

// // ─── GET — read from DB ───────────────────────────────────────

// export async function GET(req: NextRequest) {
//     try {
//         const sp = req.nextUrl.searchParams;

//         const hours    = parseInt(sp.get("hours")    ?? "24", 10);
//         const limit    = parseInt(sp.get("limit")    ?? "200", 10);
//         const sevParam = sp.get("severity");
//         const catParam = sp.get("category");
//         const state    = sp.get("state") ?? undefined;

//         const severity = sevParam ? sevParam.split(",") as AlertSeverity[] : undefined;
//         const category = catParam ? catParam.split(",") as AlertCategory[] : undefined;

//         // Try DB first
//         let articles = await getRecentArticles({ hours, limit, severity, category, state });

//         // DB is empty or not configured → run pipeline inline as fallback
//         if (articles.length === 0) {
//             console.log("[geo-news/GET] DB empty — running inline fallback fetch");
//             const result = await fetchGdeltFallback();
//             articles = result;
//         }

//         // Sort: critical first, then by date
//         const SEV_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
//         articles.sort((a, b) => {
//             const sd = (SEV_RANK[a.severity] ?? 4) - (SEV_RANK[b.severity] ?? 4);
//             if (sd !== 0) return sd;
//             return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
//         });

//         return NextResponse.json(articles, {
//             headers: { "Cache-Control": "no-store" },
//         });

//     } catch (err) {
//         console.error("[geo-news/GET] error:", err);
//         return NextResponse.json([], { status: 200 });
//     }
// }

// // ─── POST — run pipeline (cron trigger) ──────────────────────

// export async function POST(req: NextRequest) {
//     // Verify cron secret
//     const secret = process.env.CRON_SECRET;
//     if (secret) {
//         const auth = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
//         if (auth !== secret && auth !== `Bearer ${secret}`) {
//             return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
//         }
//     }

//     try {
//         console.log("[geo-news/POST] Running news pipeline...");
//         const start  = Date.now();
//         const result = await runNewsPipeline({ saveToDb: true, concurrency: 8 });
//         const ms     = Date.now() - start;

//         console.log(`[geo-news/POST] Pipeline complete: ${result.saved} saved, ${result.skipped} skipped, ${result.errors.length} errors in ${ms}ms`);

//         return NextResponse.json({
//             ok:      true,
//             total:   result.total,
//             saved:   result.saved,
//             skipped: result.skipped,
//             errors:  result.errors,
//             bySource:result.bySource,
//             ms,
//         });

//     } catch (err: any) {
//         console.error("[geo-news/POST] pipeline error:", err);
//         return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
//     }
// }





// /**
//  * /api/geo-news/route.ts
//  *
//  * Fetches security and disaster news relevant to Nigeria from two sources:
//  *
//  *   1. GDELT Project (free, no API key) — real-time global news events
//  *      Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
//  *      Filter:   sourcecountry:NI OR location:Nigeria + theme filters
//  *
//  *   2. NewsAPI (requires free API key) — aggregates ~80,000 sources
//  *      Endpoint: https://newsapi.org/v2/everything
//  *      Set env:  NEWS_API_KEY=your_key_here
//  *
//  * Both sources are geocoded against the Nigerian locations database,
//  * classified by category (banditry, terrorism, flooding, etc.),
//  * scored for severity, and returned as RawNewsArticle[].
//  *
//  * The plugin polls this endpoint every 5 minutes.
//  *
//  * ── Setup ─────────────────────────────────────────────────────
//  * Copy this file to:  src/app/api/geo-news/route.ts
//  * Add to .env.local:
//  *   NEWS_API_KEY=your_newsapi_org_key   (optional but recommended)
//  *
//  * GDELT is free with no key — it alone provides real-time coverage.
//  */

// import { NextResponse } from "next/server";
// import { geocodeText } from "@/plugins/geo-news/nigeriaLocations";
// import type { RawNewsArticle } from "@/plugins/geo-news/geoNewsTypes";
// import type { AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";

// // ─── Keyword configuration ────────────────────────────────────

// interface KeywordRule {
//     keywords: string[];
//     category: AlertCategory;
//     severity: AlertSeverity;
// }

// const KEYWORD_RULES: KeywordRule[] = [
//     {
//         keywords: ["boko haram", "iswap", "islamic state west africa", "jnim", "ansaru", "jas"],
//         category: "terrorism",
//         severity: "critical",
//     },
//     {
//         keywords: ["bandit", "bandits", "banditry", "armed bandits", "cattle rustl"],
//         category: "banditry",
//         severity: "high",
//     },
//     {
//         keywords: ["kidnap", "abduct", "hostage", "ransom", "missing persons", "schoolchildren abduct"],
//         category: "kidnapping",
//         severity: "critical",
//     },
//     {
//         keywords: ["flood", "flooding", "flash flood", "heavy rain", "submerge", "dam break", "overflow"],
//         category: "flooding",
//         severity: "high",
//     },
//     {
//         keywords: ["communal clash", "herdsmen attack", "farmer herdsmen", "ethnic clash", "tribal clash", "village attack"],
//         category: "communal-clash",
//         severity: "high",
//     },
//     {
//         keywords: ["armed robbery", "robbery attack", "highway robbery", "robbery suspect"],
//         category: "armed-robbery",
//         severity: "medium",
//     },
//     {
//         keywords: ["military operation", "military strike", "troops kill", "soldiers kill", "army neutralise", "military offensive"],
//         category: "military-op",
//         severity: "medium",
//     },
//     {
//         keywords: ["protest", "riot", "demonstration", "unrest", "civil disturbance"],
//         category: "protest",
//         severity: "low",
//     },
//     {
//         keywords: ["explosion", "bomb", "ied", "blast", "suicide bomb", "car bomb"],
//         category: "terrorism",
//         severity: "critical",
//     },
//     {
//         keywords: ["attack", "kill", "dead", "casualties", "fatalities", "massacre", "ambush"],
//         category: "banditry",
//         severity: "medium",
//     },
// ];

// const NIGERIA_FILTER_TERMS = [
//     "nigeria", "nigerian",
//     "kaduna", "zamfara", "katsina", "kano", "sokoto", "kebbi",
//     "borno", "yobe", "adamawa", "gombe", "bauchi", "plateau", "nasarawa",
//     "benue", "niger state", "kwara", "kogi", "fct", "abuja",
//     "lagos", "ogun", "oyo", "osun", "ondo", "ekiti",
//     "enugu", "anambra", "imo", "abia", "ebonyi",
//     "rivers", "bayelsa", "delta", "edo", "cross river", "akwa ibom",
//     "taraba", "jigawa",
// ];

// // ─── Classification ───────────────────────────────────────────

// function classifyArticle(title: string, description: string): {
//     category: AlertCategory;
//     severity: AlertSeverity;
//     keywords: string[];
// } {
//     const text = `${title} ${description}`.toLowerCase();
//     const matched: string[] = [];
//     let category: AlertCategory = "other";
//     let severity: AlertSeverity = "low";

//     // Walk rules in priority order (critical first)
//     const priorityOrder: AlertSeverity[] = ["critical", "high", "medium", "low"];

//     for (const targetSeverity of priorityOrder) {
//         for (const rule of KEYWORD_RULES) {
//             if (rule.severity !== targetSeverity) continue;
//             for (const kw of rule.keywords) {
//                 if (text.includes(kw)) {
//                     matched.push(kw);
//                     if (category === "other") {
//                         category = rule.category;
//                         severity = rule.severity;
//                     }
//                 }
//             }
//         }
//         if (category !== "other") break;
//     }

//     return { category, severity, keywords: [...new Set(matched)] };
// }

// function isNigeriaRelevant(text: string): boolean {
//     const lower = text.toLowerCase();
//     return NIGERIA_FILTER_TERMS.some(t => lower.includes(t));
// }

// function makeId(url: string): string {
//     // Deterministic short ID from URL
//     let h = 0;
//     for (let i = 0; i < url.length; i++) {
//         h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
//     }
//     return `gn-${(h >>> 0).toString(36)}`;
// }

// // ─── GDELT fetcher ────────────────────────────────────────────

// async function fetchGdelt(): Promise<RawNewsArticle[]> {
//     // GDELT free query: Nigeria security themes, last 24h, JSON output
//     const query = encodeURIComponent(
//         '(bandit OR "boko haram" OR kidnap OR flood OR attack OR killed) ' +
//         'sourcelang:english ' +
//         '(sourcecountry:NI OR "Nigeria" OR "Nigerian")'
//     );
//     const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=50&format=json&timespan=1440`; // 1440 min = 24h

//     const res = await fetch(url, {
//         next: { revalidate: 0 },
//         headers: { "User-Agent": "NCS-GeoIntel/1.0" },
//     });

//     if (!res.ok) {
//         console.warn(`[geo-news] GDELT returned ${res.status}`);
//         return [];
//     }

//     const data = await res.json();
//     const articles: RawNewsArticle[] = [];

//     for (const item of (data.articles ?? [])) {
//         const title   = item.title  ?? "";
//         const summary = item.seendate ?? "";
//         const text    = `${title} ${summary}`;

//         if (!isNigeriaRelevant(text)) continue;

//         const location = geocodeText(text);
//         if (!location) continue;

//         const { category, severity, keywords } = classifyArticle(title, summary);

//         articles.push({
//             id:          makeId(item.url),
//             title,
//             summary:     item.seendateraw ?? title,
//             source:      item.domain ?? "GDELT",
//             url:         item.url,
//             publishedAt: new Date(
//                 item.seendate
//                     ? item.seendate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, "$1-$2-$3T$4:$5:$6Z")
//                     : Date.now()
//             ).toISOString(),
//             latitude:    location.lat,
//             longitude:   location.lon,
//             state:       location.state,
//             lga:         location.lga,
//             category,
//             severity,
//             keywords,
//         });
//     }

//     return articles;
// }

// // ─── NewsAPI fetcher ──────────────────────────────────────────

// async function fetchNewsApi(): Promise<RawNewsArticle[]> {
//     const apiKey = process.env.NEWS_API_KEY;
//     if (!apiKey) return [];

//     const queries = [
//         "Nigeria bandit attack killed",
//         "Boko Haram Nigeria",
//         "Nigeria kidnapping abduction",
//         "Nigeria flooding flood",
//         "Nigeria communal clash herdsmen",
//     ];

//     const allArticles: RawNewsArticle[] = [];

//     for (const q of queries) {
//         try {
//             const url = `https://newsapi.org/v2/everything?` +
//                 `q=${encodeURIComponent(q)}` +
//                 `&language=en` +
//                 `&sortBy=publishedAt` +
//                 `&pageSize=10` +
//                 `&apiKey=${apiKey}`;

//             const res = await fetch(url, { next: { revalidate: 0 } });
//             if (!res.ok) continue;

//             const data = await res.json();

//             for (const item of (data.articles ?? [])) {
//                 const title   = item.title       ?? "";
//                 const summary = item.description ?? "";
//                 const text    = `${title} ${summary}`;

//                 if (!isNigeriaRelevant(text)) continue;

//                 const location = geocodeText(text);
//                 if (!location) continue;

//                 const { category, severity, keywords } = classifyArticle(title, summary);

//                 allArticles.push({
//                     id:          makeId(item.url),
//                     title,
//                     summary,
//                     source:      item.source?.name ?? "NewsAPI",
//                     url:         item.url,
//                     imageUrl:    item.urlToImage ?? undefined,
//                     publishedAt: item.publishedAt,
//                     latitude:    location.lat,
//                     longitude:   location.lon,
//                     state:       location.state,
//                     lga:         location.lga,
//                     category,
//                     severity,
//                     keywords,
//                 });
//             }
//         } catch (err) {
//             console.warn("[geo-news] NewsAPI query failed:", err);
//         }
//     }

//     return allArticles;
// }

// // ─── Route handler ────────────────────────────────────────────

// export const dynamic = "force-dynamic";

// export async function GET() {
//     try {
//         const [gdelt, newsapi] = await Promise.allSettled([
//             fetchGdelt(),
//             fetchNewsApi(),
//         ]);

//         const gdeltArticles   = gdelt.status   === "fulfilled" ? gdelt.value   : [];
//         const newsApiArticles = newsapi.status === "fulfilled" ? newsapi.value : [];

//         // Merge + deduplicate by id
//         const seen = new Set<string>();
//         const all: RawNewsArticle[] = [];

//         for (const article of [...gdeltArticles, ...newsApiArticles]) {
//             if (!seen.has(article.id)) {
//                 seen.add(article.id);
//                 all.push(article);
//             }
//         }

//         // Sort by severity then date
//         const severityRank: Record<AlertSeverity, number> = {
//             critical: 0, high: 1, medium: 2, low: 3,
//         };
//         all.sort((a, b) => {
//             const sd = severityRank[a.severity] - severityRank[b.severity];
//             if (sd !== 0) return sd;
//             return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
//         });

//         return NextResponse.json(all, {
//             headers: { "Cache-Control": "no-store" },
//         });

//     } catch (err) {
//         console.error("[geo-news] Route error:", err);
//         return NextResponse.json([], { status: 200 });
//     }
// }