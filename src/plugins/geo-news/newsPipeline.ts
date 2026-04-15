/**
 * newsPipeline.ts
 *
 * Core server-side pipeline that:
 *   1. Fetches RSS from every source in parallel (with concurrency limit)
 *   2. Classifies each article (category + severity + keywords)
 *   3. Filters to Nigeria-relevant content only
 *   4. Geocodes each article to a lat/lon
 *   5. Deduplicates against existing DB records
 *   6. Saves new articles to Supabase
 *   7. Returns the saved articles
 *
 * Called by:
 *   - /api/geo-news/route.ts      → on client poll (GET request)
 *   - /api/geo-news/poll/route.ts → on server cron (POST request)
 *   - instrumentation.ts          → on server startup for initial load
 */

import { ALL_SOURCES, type NewsSource } from "./newsSources";
import { fetchRss, fetchAcled, type RssItem, type AcledEvent } from "./rssParser";
import { geocodeText } from "./nigeriaLocations";
import { saveArticles, filterNewIds } from "./newsDb";
import type { RawNewsArticle } from "./geoNewsTypes";
import type { AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";

// ─── Keyword classification rules ────────────────────────────

interface KeywordRule {
    keywords: string[];
    category: AlertCategory;
    severity: AlertSeverity;
}

const KEYWORD_RULES: KeywordRule[] = [
    { keywords: ["boko haram", "iswap", "islamic state west africa", "jnim", "ansaru", "jas", "ied", "suicide bomb", "suicide bomber", "car bomb", "improvised explosive"], category: "terrorism", severity: "critical" },
    { keywords: ["explosion", "bomb blast", "rocket attack", "gunmen attack", "insurgent", "jihadist"], category: "terrorism", severity: "critical" },
    { keywords: ["kidnap", "abduct", "abduction", "hostage", "ransom demand", "students abduct", "schoolchildren", "workers abducted", "travelers kidnapped"], category: "kidnapping", severity: "critical" },
    { keywords: ["bandit", "bandits", "banditry", "armed bandits", "cattle rustl", "rustling", "bandit attack", "bandit kill"], category: "banditry", severity: "high" },
    { keywords: ["flood", "flooding", "flash flood", "heavy rainfall", "submerge", "dam break", "overflow", "riverbank", "landslide", "erosion disaster"], category: "flooding", severity: "high" },
    { keywords: ["communal clash", "herdsmen attack", "farmer herdsmen", "ethnic clash", "tribal clash", "village attack", "community attack", "reprisal attack", "intercommunal"], category: "communal-clash", severity: "high" },
    { keywords: ["armed robbery", "robbery attack", "highway robbery", "robbery suspect", "one chance", "robbers kill"], category: "armed-robbery", severity: "medium" },
    { keywords: ["troops kill", "soldiers kill", "army neutralise", "army killed", "military operation", "military offensive", "airstrikes", "military strike", "troops arrest"], category: "military-op", severity: "medium" },
    { keywords: ["protest", "riot", "demonstration", "unrest", "civil disturbance", "strike", "shutdown", "blockade road"], category: "protest", severity: "low" },
    { keywords: ["accident", "road accident", "auto crash", "tanker explosion", "pipeline explosion", "collapsed building"], category: "accident", severity: "medium" },
    // Catch-all — must be last
    { keywords: ["attack", "kill", "killed", "dead", "casualties", "fatalities", "massacre", "ambush", "gunshot", "shot dead"], category: "banditry", severity: "medium" },
];

const NIGERIA_TERMS = new Set([
    "nigeria", "nigerian", "nig ",
    "kaduna", "zamfara", "katsina", "kano", "sokoto", "kebbi",
    "borno", "yobe", "adamawa", "gombe", "bauchi", "plateau", "nasarawa",
    "benue", "niger state", "kwara", "kogi", "fct", "abuja",
    "lagos", "ogun", "oyo", "osun", "ondo", "ekiti",
    "enugu", "anambra", "imo", "abia", "ebonyi",
    "rivers state", "bayelsa", "delta state", "edo state", "cross river", "akwa ibom",
    "taraba", "jigawa", "maiduguri", "zaria", "ibadan", "port harcourt",
    "kano state", "jos", "ilorin", "warri", "benin city", "onitsha",
]);

export function classifyArticle(title: string, body: string): {
    category: AlertCategory;
    severity: AlertSeverity;
    keywords: string[];
} {
    const text = `${title} ${body}`.toLowerCase();
    const matched = new Set<string>();
    let category: AlertCategory = "other";
    let severity: AlertSeverity = "low";

    for (const rule of KEYWORD_RULES) {
        for (const kw of rule.keywords) {
            if (text.includes(kw)) {
                matched.add(kw);
                if (category === "other") {
                    category = rule.category;
                    severity = rule.severity;
                }
            }
        }
        // Stop at first matching rule (rules are in priority order)
        if (category !== "other" && category !== "banditry") break;
    }

    return { category, severity, keywords: [...matched].slice(0, 8) };
}

export function isNigeriaRelevant(text: string): boolean {
    const lower = text.toLowerCase();
    for (const term of NIGERIA_TERMS) {
        if (lower.includes(term)) return true;
    }
    return false;
}

export function makeId(url: string): string {
    let h = 0;
    for (let i = 0; i < url.length; i++) {
        h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
    }
    return `gn-${(h >>> 0).toString(36)}`;
}

// ─── RSS item → RawNewsArticle ────────────────────────────────

function rssItemToArticle(item: RssItem, source: NewsSource): RawNewsArticle | null {
    const text = `${item.title} ${item.description}`;
    if (!isNigeriaRelevant(text)) return null;

    const location = geocodeText(text);
    if (!location) return null;

    const { category, severity, keywords } = classifyArticle(item.title, item.description);

    return {
        id: makeId(item.link),
        title: item.title,
        summary: item.description.slice(0, 500),
        source: source.name,
        url: item.link.startsWith("http") ? item.link : `${source.baseUrl}${item.link}`,
        imageUrl: item.imageUrl,
        publishedAt: item.pubDate.toISOString(),
        latitude: location.lat,
        longitude: location.lon,
        state: location.state,
        lga: location.lga,
        category,
        severity,
        keywords,
    };
}

// ─── ACLED event → RawNewsArticle ─────────────────────────────

function acledEventToArticle(event: AcledEvent): RawNewsArticle | null {
    const lat = parseFloat(event.latitude);
    const lon = parseFloat(event.longitude);
    if (isNaN(lat) || isNaN(lon)) return null;

    const text = `${event.event_type} ${event.actor1} ${event.location} ${event.notes}`;
    const { category, severity, keywords } = classifyArticle(event.event_type, event.notes);
    const location = geocodeText(text);

    return {
        id: makeId(`acled-${event.event_date}-${event.location}-${event.actor1}`),
        title: `[${event.event_type}] ${event.actor1} — ${event.location}`,
        summary: event.notes.slice(0, 500),
        source: "ACLED",
        url: `https://acleddata.com/data-export-tool/`,
        publishedAt: new Date(event.event_date).toISOString(),
        latitude: lat,
        longitude: lon,
        state: location?.state ?? event.location,
        category,
        severity,
        keywords,
    };
}

// ─── Concurrency limiter ──────────────────────────────────────

async function withConcurrency<T>(
    tasks: (() => Promise<T>)[],
    limit: number
): Promise<T[]> {
    const results: T[] = [];
    let index = 0;

    async function worker() {
        while (index < tasks.length) {
            const i = index++;
            results[i] = await tasks[i]();
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
}

// ─── Main pipeline function ───────────────────────────────────

export interface PipelineResult {
    total: number;    // articles processed
    saved: number;    // new articles saved to DB
    skipped: number;    // duplicates skipped
    bySource: Record<string, number>;
    errors: string[];
    articles: RawNewsArticle[];  // all processed articles (including existing ones)
}

export async function runNewsPipeline(options: {
    sourcesToRun?: string[];   // subset of source IDs; defaults to all
    saveToDb?: boolean;    // default true
    concurrency?: number;     // max parallel fetches; default 8
} = {}): Promise<PipelineResult> {
    const {
        sourcesToRun,
        saveToDb = true,
        concurrency = 8,
    } = options;

    const sources = sourcesToRun
        ? ALL_SOURCES.filter(s => sourcesToRun.includes(s.id))
        : ALL_SOURCES.filter(s => s.id !== "acled"); // ACLED handled separately

    const result: PipelineResult = {
        total: 0,
        saved: 0,
        skipped: 0,
        bySource: {},
        errors: [],
        articles: [],
    };

    // ── Fetch all RSS feeds with concurrency limit ─────────────
    const tasks = sources.map(source => async () => {
        try {
            const items = await fetchRss(source.rssUrl, source.name);
            const articles: RawNewsArticle[] = [];

            for (const item of items) {
                const article = rssItemToArticle(item, source);
                if (article) articles.push(article);
            }

            result.bySource[source.id] = articles.length;
            return { source, articles };
        } catch (err: any) {
            result.errors.push(`${source.id}: ${err.message}`);
            result.bySource[source.id] = 0;
            return { source, articles: [] as RawNewsArticle[] };
        }
    });

    const batchResults = await withConcurrency(tasks, concurrency);

    // ── Collect all articles ───────────────────────────────────
    const allArticles: RawNewsArticle[] = [];
    for (const { articles } of batchResults) {
        allArticles.push(...articles);
    }

    // ── ACLED (separate non-RSS source) ────────────────────────
    if (!sourcesToRun || sourcesToRun.includes("acled")) {
        try {
            const events = await fetchAcled();
            const acledArticles: RawNewsArticle[] = [];
            for (const event of events) {
                const article = acledEventToArticle(event);
                if (article) acledArticles.push(article);
            }
            result.bySource["acled"] = acledArticles.length;
            allArticles.push(...acledArticles);
        } catch (err: any) {
            result.errors.push(`acled: ${err.message}`);
        }
    }

    result.total = allArticles.length;

    // ── Deduplicate within this batch ──────────────────────────
    const seen = new Map<string, RawNewsArticle>();
    for (const article of allArticles) {
        if (!seen.has(article.id)) seen.set(article.id, article);
    }
    const unique = [...seen.values()];

    // ── DB deduplication + save ────────────────────────────────
    if (saveToDb && unique.length > 0) {
        // Find which IDs are genuinely new
        const allIds = unique.map(a => a.id);
        const newIds = new Set(await filterNewIds(allIds));
        const toSave = unique.filter(a => newIds.has(a.id));

        result.skipped = unique.length - toSave.length;

        if (toSave.length > 0) {
            // Group by source for individual upsert calls
            const bySource = new Map<string, RawNewsArticle[]>();
            for (const article of toSave) {
                const sourceId = batchResults.find(r =>
                    r.articles.some(a => a.id === article.id)
                )?.source.id ?? "unknown";
                if (!bySource.has(sourceId)) bySource.set(sourceId, []);
                bySource.get(sourceId)!.push(article);
            }

            let totalSaved = 0;
            for (const [sourceId, articles] of bySource) {
                totalSaved += await saveArticles(articles, sourceId);
            }
            result.saved = totalSaved;
        }
    }

    result.articles = unique;
    return result;
}