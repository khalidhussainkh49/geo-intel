"use client";

/**
 * GeoNewsPlugin v3
 *
 * Strategy: fetch ALL articles from the DB on toggle, hold them in
 * memory, then filter by timeRange client-side every time the time
 * window button changes.
 *
 * Why this is better than passing ?hours= to the API:
 *   - No round-trip to the server every time the user presses 1h/6h/24h
 *   - The CacheLayer/IndexedDB problem is bypassed — we manage our own
 *     in-memory store and never let stale data show
 *   - The PollingManager 5-min interval re-fetches from DB to pick up
 *     new articles saved by the server poller
 *   - Time window filtering is instant (no network latency)
 *
 * Data flow:
 *   1. Toggle ON  → fetch("/api/geo-news?limit=2000") → store all in
 *      this._allArticles
 *   2. Immediately filter _allArticles by current timeRange → return
 *      entities → globe renders them
 *   3. User presses "2H" button → TimelineSync calls
 *      pluginManager.updateTimeRange(newTimeRange) → fetch() called
 *      again with new timeRange → re-filter _allArticles → return
 *      filtered entities → globe updates instantly
 *   4. PollingManager fires every 5 min → fetch() called →
 *      re-fetches DB (picks up new articles) → re-filters → globe
 *      updates
 */

import { Newspaper } from "lucide-react";
import type {
    WorldPlugin,
    GeoEntity,
    TimeRange,
    PluginContext,
    LayerConfig,
    CesiumEntityOptions,
    FilterDefinition,
} from "@/core/plugins/PluginTypes";
import { useStore } from "@/core/state/store";
import type { GeoAlert, AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";
import type { RawNewsArticle } from "./geoNewsTypes";
import { GeoNewsDetail } from "./GeoNewsDetail";

// ─── Color / size maps ────────────────────────────────────────

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
    critical: "#ef4444",
    high:     "#f97316",
    medium:   "#f59e0b",
    low:      "#22d3ee",
};

const CATEGORY_SIZE: Record<AlertCategory, number> = {
    terrorism:        12,
    banditry:         10,
    kidnapping:       11,
    flooding:         10,
    "communal-clash":  9,
    "armed-robbery":   8,
    "military-op":     8,
    protest:           7,
    accident:          7,
    other:             7,
};

// ─── Helpers ──────────────────────────────────────────────────

function articleToEntity(article: RawNewsArticle, pluginId: string): GeoEntity {
    return {
        id:        article.id,
        pluginId,
        latitude:  article.latitude,
        longitude: article.longitude,
        altitude:  0,
        timestamp: new Date(article.publishedAt),
        label:     article.title,
        properties: {
            title:       article.title,
            summary:     article.summary      ?? "",
            source:      article.source,
            url:         article.url,
            imageUrl:    article.imageUrl     ?? null,
            category:    article.category,
            severity:    article.severity,
            state:       article.state        ?? "",
            lga:         article.lga          ?? null,
            keywords:    Array.isArray(article.keywords) ? article.keywords : [],
            publishedAt: article.publishedAt,
        },
    };
}

function articleToAlert(article: RawNewsArticle): GeoAlert {
    return {
        id:          article.id,
        title:       article.title,
        summary:     article.summary ?? "",
        source:      article.source,
        url:         article.url,
        imageUrl:    article.imageUrl,
        category:    article.category,
        severity:    article.severity,
        latitude:    article.latitude,
        longitude:   article.longitude,
        state:       article.state  ?? "",
        lga:         article.lga,
        publishedAt: new Date(article.publishedAt),
        fetchedAt:   new Date(),
        dismissed:   false,
        toasted:     false,
    };
}

/**
 * Filter an article array to only those within the given timeRange.
 * TimeRange.start is the cutoff — articles published before it are excluded.
 */
function filterByTimeRange(articles: RawNewsArticle[], timeRange: TimeRange): RawNewsArticle[] {
    const start = timeRange.start.getTime();
    const end   = timeRange.end.getTime();
    return articles.filter(a => {
        const t = new Date(a.publishedAt).getTime();
        return t >= start && t <= end;
    });
}

// ─── Plugin ───────────────────────────────────────────────────

export class GeoNewsPlugin implements WorldPlugin {
    id          = "geo-news";
    name        = "Geo News";
    description = "Real-time security & disaster news geotagged on Nigeria";
    icon        = Newspaper;
    category    = "conflict" as const;
    version     = "3.0.0";

    /**
     * Tell PluginManager to skip IndexedDB cache on toggle.
     * GeoNewsPlugin manages its own in-memory store (_allArticles)
     * so stale IndexedDB data must never block the fresh DB fetch.
     */
    readonly skipCache = true;

    private context: PluginContext | null = null;

    /**
     * In-memory store of ALL articles fetched from the DB.
     * Populated on first fetch, refreshed every 5 minutes.
     * Time filtering is done against this array every time
     * fetch() is called — no extra network requests needed.
     */
    private _allArticles: RawNewsArticle[] = [];

    /** Tracks IDs pushed to alertsSlice to avoid duplicate toasts. */
    private _pushedIds = new Set<string>();

    /** Timestamp of the last successful DB fetch. */
    private _lastFetchAt = 0;

    /** How stale the in-memory store can be before we force a refresh.
     *  Set to 4.5 min so the 5-min poller always triggers a refresh. */
    private readonly REFRESH_INTERVAL_MS = 4.5 * 60 * 1000;

    async initialize(ctx: PluginContext): Promise<void> {
        this.context = ctx;
    }

    destroy(): void {
        this.context      = null;
        this._allArticles = [];
        this._pushedIds.clear();
        this._lastFetchAt = 0;
    }

    // ─── fetch() ─────────────────────────────────────────────────
    //
    // Called by PollingManager:
    //   a) Immediately when layer is toggled ON
    //   b) Every 5 minutes while layer is enabled
    //   c) When TimelineSync calls pluginManager.updateTimeRange()
    //      (i.e. when user presses 1H / 6H / 24H / 48H / 7D)
    //
    // On (a) and (b): re-fetch from DB, update _allArticles
    // On (c): timeRange changed — filter existing _allArticles, no re-fetch
    //         unless the store is stale
    //
    async fetch(timeRange: TimeRange): Promise<GeoEntity[]> {
        const now = Date.now();
        const storeIsStale = (now - this._lastFetchAt) > this.REFRESH_INTERVAL_MS;

        // ── Step 1: Refresh from DB if needed ──────────────────
        if (storeIsStale || this._allArticles.length === 0) {
            await this._refreshFromDb();
        }

        // ── Step 2: Filter by timeRange (client-side, instant) ─
        const filtered = filterByTimeRange(this._allArticles, timeRange);

        // ── Step 3: Map to GeoEntities ─────────────────────────
        const entities: GeoEntity[] = [];
        const newAlerts: GeoAlert[] = [];

        for (const article of filtered) {
            if (
                typeof article.latitude  !== "number" ||
                typeof article.longitude !== "number" ||
                !article.id || !article.title
            ) continue;

            entities.push(articleToEntity(article, this.id));

            if (!this._pushedIds.has(article.id)) {
                this._pushedIds.add(article.id);
                newAlerts.push(articleToAlert(article));
            }
        }

        // ── Step 4: Push new alerts to store ───────────────────
        if (newAlerts.length > 0) {
            useStore.getState().addAlerts(newAlerts);
        }

        console.log(
            `[GeoNewsPlugin] ${entities.length}/${this._allArticles.length} articles` +
            ` in window (${new Date(timeRange.start).toISOString().slice(11,16)}` +
            ` → ${new Date(timeRange.end).toISOString().slice(11,16)} UTC)`
        );

        return entities;
    }

    // ─── DB refresh ───────────────────────────────────────────────

    private async _refreshFromDb(): Promise<void> {
        try {
            // Fetch ALL articles from the DB — no time filter here.
            // We have plenty of room: 2000 articles × ~1KB = ~2MB in memory.
            // Time filtering is done client-side in filterByTimeRange().
            const url = `/api/geo-news?limit=2000`;
            console.log(`[GeoNewsPlugin] Refreshing from DB: ${url}`);

            const res = await fetch(url, { cache: "no-store" });

            if (!res.ok) {
                console.error(`[GeoNewsPlugin] API error ${res.status}: ${res.statusText}`);
                this.context?.onError(new Error(`geo-news API ${res.status}`));
                return; // keep _allArticles as-is if we have stale data
            }

            const articles: RawNewsArticle[] = await res.json();

            if (!Array.isArray(articles)) {
                console.error("[GeoNewsPlugin] API returned non-array:", typeof articles);
                return;
            }

            this._allArticles = articles;
            this._lastFetchAt = Date.now();

            console.log(`[GeoNewsPlugin] Loaded ${articles.length} total articles from DB`);

        } catch (err) {
            console.error("[GeoNewsPlugin] DB refresh failed:", err);
            this.context?.onError(err instanceof Error ? err : new Error(String(err)));
            // Don't clear _allArticles — stale data is better than nothing
        }
    }

    // ─── WorldPlugin interface ────────────────────────────────────

    /** Poll every 5 minutes to pick up new articles from the server poller */
    getPollingInterval(): number {
        return 5 * 60 * 1000;
    }

    getLayerConfig(): LayerConfig {
        return {
            color:           "#ef4444",
            clusterEnabled:  true,
            clusterDistance: 60,
            maxEntities:     2000,
        };
    }

    renderEntity(entity: GeoEntity): CesiumEntityOptions {
        const severity = (entity.properties.severity as AlertSeverity) ?? "low";
        const category = (entity.properties.category as AlertCategory) ?? "other";
        return {
            type:         "point",
            color:        SEVERITY_COLOR[severity] ?? "#94a3b8",
            size:         CATEGORY_SIZE[category]  ?? 8,
            outlineColor: "#ffffff",
            outlineWidth: 1.5,
            labelText:    entity.label,
            labelFont:    "11px Inter, system-ui, sans-serif",
        };
    }

    getDetailComponent() {
        return GeoNewsDetail;
    }

    getFilterDefinitions(): FilterDefinition[] {
        return [
            {
                id:          "category",
                label:       "Category",
                type:        "select",
                propertyKey: "category",
                options: [
                    { value: "terrorism",      label: "Terrorism / Boko Haram" },
                    { value: "banditry",       label: "Banditry" },
                    { value: "kidnapping",     label: "Kidnapping" },
                    { value: "flooding",       label: "Flooding" },
                    { value: "communal-clash", label: "Communal Clash" },
                    { value: "armed-robbery",  label: "Armed Robbery" },
                    { value: "military-op",    label: "Military Operation" },
                    { value: "protest",        label: "Protest / Unrest" },
                    { value: "accident",       label: "Accident" },
                    { value: "other",          label: "Other" },
                ],
            },
            {
                id:          "severity",
                label:       "Severity",
                type:        "select",
                propertyKey: "severity",
                options: [
                    { value: "critical", label: "Critical" },
                    { value: "high",     label: "High" },
                    { value: "medium",   label: "Medium" },
                    { value: "low",      label: "Low" },
                ],
            },
            {
                id:          "state",
                label:       "State",
                type:        "text",
                propertyKey: "state",
            },
            {
                id:          "title",
                label:       "Keyword Search",
                type:        "text",
                propertyKey: "title",
            },
        ];
    }
}



// "use client";

// /**
//  * GeoNewsPlugin v3
//  *
//  * Strategy: fetch ALL articles from the DB on toggle, hold them in
//  * memory, then filter by timeRange client-side every time the time
//  * window button changes.
//  *
//  * Why this is better than passing ?hours= to the API:
//  *   - No round-trip to the server every time the user presses 1h/6h/24h
//  *   - The CacheLayer/IndexedDB problem is bypassed — we manage our own
//  *     in-memory store and never let stale data show
//  *   - The PollingManager 5-min interval re-fetches from DB to pick up
//  *     new articles saved by the server poller
//  *   - Time window filtering is instant (no network latency)
//  *
//  * Data flow:
//  *   1. Toggle ON  → fetch("/api/geo-news?limit=2000") → store all in
//  *      this._allArticles
//  *   2. Immediately filter _allArticles by current timeRange → return
//  *      entities → globe renders them
//  *   3. User presses "2H" button → TimelineSync calls
//  *      pluginManager.updateTimeRange(newTimeRange) → fetch() called
//  *      again with new timeRange → re-filter _allArticles → return
//  *      filtered entities → globe updates instantly
//  *   4. PollingManager fires every 5 min → fetch() called →
//  *      re-fetches DB (picks up new articles) → re-filters → globe
//  *      updates
//  */

// import { Newspaper } from "lucide-react";
// import type {
//     WorldPlugin,
//     GeoEntity,
//     TimeRange,
//     PluginContext,
//     LayerConfig,
//     CesiumEntityOptions,
//     FilterDefinition,
// } from "@/core/plugins/PluginTypes";
// import { useStore } from "@/core/state/store";
// import type { GeoAlert, AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";
// import type { RawNewsArticle } from "./geoNewsTypes";
// import { GeoNewsDetail } from "./GeoNewsDetail";

// // ─── Color / size maps ────────────────────────────────────────

// const SEVERITY_COLOR: Record<AlertSeverity, string> = {
//     critical: "#ef4444",
//     high:     "#f97316",
//     medium:   "#f59e0b",
//     low:      "#22d3ee",
// };

// const CATEGORY_SIZE: Record<AlertCategory, number> = {
//     terrorism:        12,
//     banditry:         10,
//     kidnapping:       11,
//     flooding:         10,
//     "communal-clash":  9,
//     "armed-robbery":   8,
//     "military-op":     8,
//     protest:           7,
//     accident:          7,
//     other:             7,
// };

// // ─── Helpers ──────────────────────────────────────────────────

// function articleToEntity(article: RawNewsArticle, pluginId: string): GeoEntity {
//     return {
//         id:        article.id,
//         pluginId,
//         latitude:  article.latitude,
//         longitude: article.longitude,
//         altitude:  0,
//         timestamp: new Date(article.publishedAt),
//         label:     article.title,
//         properties: {
//             title:       article.title,
//             summary:     article.summary      ?? "",
//             source:      article.source,
//             url:         article.url,
//             imageUrl:    article.imageUrl     ?? null,
//             category:    article.category,
//             severity:    article.severity,
//             state:       article.state        ?? "",
//             lga:         article.lga          ?? null,
//             keywords:    Array.isArray(article.keywords) ? article.keywords : [],
//             publishedAt: article.publishedAt,
//         },
//     };
// }

// function articleToAlert(article: RawNewsArticle): GeoAlert {
//     return {
//         id:          article.id,
//         title:       article.title,
//         summary:     article.summary ?? "",
//         source:      article.source,
//         url:         article.url,
//         imageUrl:    article.imageUrl,
//         category:    article.category,
//         severity:    article.severity,
//         latitude:    article.latitude,
//         longitude:   article.longitude,
//         state:       article.state  ?? "",
//         lga:         article.lga,
//         publishedAt: new Date(article.publishedAt),
//         fetchedAt:   new Date(),
//         dismissed:   false,
//         toasted:     false,
//     };
// }

// /**
//  * Filter an article array to only those within the given timeRange.
//  * TimeRange.start is the cutoff — articles published before it are excluded.
//  */
// function filterByTimeRange(articles: RawNewsArticle[], timeRange: TimeRange): RawNewsArticle[] {
//     const start = timeRange.start.getTime();
//     const end   = timeRange.end.getTime();
//     return articles.filter(a => {
//         const t = new Date(a.publishedAt).getTime();
//         return t >= start && t <= end;
//     });
// }

// // ─── Plugin ───────────────────────────────────────────────────

// export class GeoNewsPlugin implements WorldPlugin {
//     id          = "geo-news";
//     name        = "Geo News";
//     description = "Real-time security & disaster news geotagged on Nigeria";
//     icon        = Newspaper;
//     category    = "conflict" as const;
//     version     = "3.0.0";

//     /**
//      * Tell PluginManager to skip IndexedDB cache on toggle.
//      * GeoNewsPlugin manages its own in-memory store (_allArticles)
//      * so stale IndexedDB data must never block the fresh DB fetch.
//      */
//     readonly skipCache = true;

//     private context: PluginContext | null = null;

//     /**
//      * In-memory store of ALL articles fetched from the DB.
//      * Populated on first fetch, refreshed every 5 minutes.
//      * Time filtering is done against this array every time
//      * fetch() is called — no extra network requests needed.
//      */
//     private _allArticles: RawNewsArticle[] = [];

//     /** Tracks IDs pushed to alertsSlice to avoid duplicate toasts. */
//     private _pushedIds = new Set<string>();

//     /** Timestamp of the last successful DB fetch. */
//     private _lastFetchAt = 0;

//     /** How stale the in-memory store can be before we force a refresh.
//      *  Set to 4.5 min so the 5-min poller always triggers a refresh. */
//     private readonly REFRESH_INTERVAL_MS = 4.5 * 60 * 1000;

//     async initialize(ctx: PluginContext): Promise<void> {
//         this.context = ctx;
//     }

//     destroy(): void {
//         this.context      = null;
//         this._allArticles = [];
//         this._pushedIds.clear();
//         this._lastFetchAt = 0;
//     }

//     // ─── fetch() ─────────────────────────────────────────────────
//     //
//     // Called by PollingManager:
//     //   a) Immediately when layer is toggled ON
//     //   b) Every 5 minutes while layer is enabled
//     //   c) When TimelineSync calls pluginManager.updateTimeRange()
//     //      (i.e. when user presses 1H / 6H / 24H / 48H / 7D)
//     //
//     // On (a) and (b): re-fetch from DB, update _allArticles
//     // On (c): timeRange changed — filter existing _allArticles, no re-fetch
//     //         unless the store is stale
//     //
//     async fetch(timeRange: TimeRange): Promise<GeoEntity[]> {
//         const now = Date.now();
//         const storeIsStale = (now - this._lastFetchAt) > this.REFRESH_INTERVAL_MS;

//         // ── Step 1: Refresh from DB if needed ──────────────────
//         if (storeIsStale || this._allArticles.length === 0) {
//             await this._refreshFromDb();
//         }

//         // ── Step 2: Filter by timeRange (client-side, instant) ─
//         const filtered = filterByTimeRange(this._allArticles, timeRange);

//         // ── Step 3: Map to GeoEntities ─────────────────────────
//         const entities: GeoEntity[] = [];
//         const newAlerts: GeoAlert[] = [];

//         for (const article of filtered) {
//             if (
//                 typeof article.latitude  !== "number" ||
//                 typeof article.longitude !== "number" ||
//                 !article.id || !article.title
//             ) continue;

//             entities.push(articleToEntity(article, this.id));

//             if (!this._pushedIds.has(article.id)) {
//                 this._pushedIds.add(article.id);
//                 newAlerts.push(articleToAlert(article));
//             }
//         }

//         // ── Step 4: Push new alerts to store ───────────────────
//         if (newAlerts.length > 0) {
//             useStore.getState().addAlerts(newAlerts);
//         }

//         console.log(
//             `[GeoNewsPlugin] ${entities.length}/${this._allArticles.length} articles` +
//             ` in window (${new Date(timeRange.start).toISOString().slice(11,16)}` +
//             ` → ${new Date(timeRange.end).toISOString().slice(11,16)} UTC)`
//         );

//         return entities;
//     }

//     // ─── DB refresh ───────────────────────────────────────────────

//     private async _refreshFromDb(): Promise<void> {
//         try {
//             // Fetch ALL articles from the DB — no time filter here.
//             // We have plenty of room: 2000 articles × ~1KB = ~2MB in memory.
//             // Time filtering is done client-side in filterByTimeRange().
//             const url = `/api/geo-news?limit=2000`;
//             console.log(`[GeoNewsPlugin] Refreshing from DB: ${url}`);

//             const res = await fetch(url, { cache: "no-store" });

//             if (!res.ok) {
//                 console.error(`[GeoNewsPlugin] API error ${res.status}: ${res.statusText}`);
//                 this.context?.onError(new Error(`geo-news API ${res.status}`));
//                 return; // keep _allArticles as-is if we have stale data
//             }

//             const articles: RawNewsArticle[] = await res.json();

//             if (!Array.isArray(articles)) {
//                 console.error("[GeoNewsPlugin] API returned non-array:", typeof articles);
//                 return;
//             }

//             this._allArticles = articles;
//             this._lastFetchAt = Date.now();

//             console.log(`[GeoNewsPlugin] Loaded ${articles.length} total articles from DB`);

//         } catch (err) {
//             console.error("[GeoNewsPlugin] DB refresh failed:", err);
//             this.context?.onError(err instanceof Error ? err : new Error(String(err)));
//             // Don't clear _allArticles — stale data is better than nothing
//         }
//     }

//     // ─── WorldPlugin interface ────────────────────────────────────

//     /** Poll every 5 minutes to pick up new articles from the server poller */
//     getPollingInterval(): number {
//         return 5 * 60 * 1000;
//     }

//     getLayerConfig(): LayerConfig {
//         return {
//             color:           "#ef4444",
//             clusterEnabled:  true,
//             clusterDistance: 60,
//             maxEntities:     2000,
//         };
//     }

//     renderEntity(entity: GeoEntity): CesiumEntityOptions {
//         const severity = (entity.properties.severity as AlertSeverity) ?? "low";
//         const category = (entity.properties.category as AlertCategory) ?? "other";
//         return {
//             type:         "point",
//             color:        SEVERITY_COLOR[severity] ?? "#94a3b8",
//             size:         CATEGORY_SIZE[category]  ?? 8,
//             outlineColor: "#ffffff",
//             outlineWidth: 1.5,
//             labelText:    entity.label,
//             labelFont:    "11px Inter, system-ui, sans-serif",
//         };
//     }

//     getDetailComponent() {
//         return GeoNewsDetail;
//     }

//     getFilterDefinitions(): FilterDefinition[] {
//         return [
//             {
//                 id:          "category",
//                 label:       "Category",
//                 type:        "select",
//                 propertyKey: "category",
//                 options: [
//                     { value: "terrorism",      label: "Terrorism / Boko Haram" },
//                     { value: "banditry",       label: "Banditry" },
//                     { value: "kidnapping",     label: "Kidnapping" },
//                     { value: "flooding",       label: "Flooding" },
//                     { value: "communal-clash", label: "Communal Clash" },
//                     { value: "armed-robbery",  label: "Armed Robbery" },
//                     { value: "military-op",    label: "Military Operation" },
//                     { value: "protest",        label: "Protest / Unrest" },
//                     { value: "accident",       label: "Accident" },
//                     { value: "other",          label: "Other" },
//                 ],
//             },
//             {
//                 id:          "severity",
//                 label:       "Severity",
//                 type:        "select",
//                 propertyKey: "severity",
//                 options: [
//                     { value: "critical", label: "Critical" },
//                     { value: "high",     label: "High" },
//                     { value: "medium",   label: "Medium" },
//                     { value: "low",      label: "Low" },
//                 ],
//             },
//             {
//                 id:          "state",
//                 label:       "State",
//                 type:        "text",
//                 propertyKey: "state",
//             },
//             {
//                 id:          "title",
//                 label:       "Keyword Search",
//                 type:        "text",
//                 propertyKey: "title",
//             },
//         ];
//     }
// }




// /**
//  * GeoNewsPlugin
//  *
//  * Polls /api/geo-news every 5 minutes.
//  * The fetch() method passes the active timeRange as ?hours=N so the
//  * DB query always matches the time window selected in the header
//  * (1h, 6h, 24h, 48h, 7d buttons).
//  *
//  * Bug fixes in this version:
//  *   1. fetch() now uses timeRange to compute ?hours= param — changing
//  *      the time window header button immediately re-fetches with the
//  *      correct time range.
//  *   2. No GDELT fallback — only reads from the Supabase DB.
//  *   3. Cache is bypassed whenever timeRange changes so stale data
//  *      from a previous window is never shown.
//  */

// import { Newspaper } from "lucide-react";
// import type {
//     WorldPlugin,
//     GeoEntity,
//     TimeRange,
//     PluginContext,
//     LayerConfig,
//     CesiumEntityOptions,
//     FilterDefinition,
// } from "@/core/plugins/PluginTypes";
// import { useStore } from "@/core/state/store";
// import type { GeoAlert, AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";
// import type { RawNewsArticle } from "./geoNewsTypes";
// import { GeoNewsDetail } from "./GeoNewsDetail";

// // ─── Severity → Cesium color ─────────────────────────────────
// const SEVERITY_COLOR: Record<AlertSeverity, string> = {
//     critical: "#ef4444",
//     high:     "#f97316",
//     medium:   "#f59e0b",
//     low:      "#22d3ee",
// };

// // ─── Category → marker size ───────────────────────────────────
// const CATEGORY_SIZE: Record<AlertCategory, number> = {
//     terrorism:        12,
//     banditry:         10,
//     kidnapping:       11,
//     flooding:         10,
//     "communal-clash":  9,
//     "armed-robbery":   8,
//     "military-op":     8,
//     protest:           7,
//     accident:          7,
//     other:             7,
// };

// // ─── Helpers ──────────────────────────────────────────────────

// /**
//  * Convert a TimeRange into a ?hours=N query param.
//  *
//  * The header buttons map to these values via timelineSlice:
//  *   "1h"  → 1   hour
//  *   "6h"  → 6   hours
//  *   "24h" → 24  hours
//  *   "48h" → 48  hours
//  *   "7d"  → 168 hours
//  *
//  * We compute the span from timeRange.start → now rather than
//  * hardcoding the timeWindow string, so any custom range also works.
//  */
// function timeRangeToHours(timeRange: TimeRange): number {
//     const diffMs = Date.now() - timeRange.start.getTime();
//     const hours  = Math.ceil(diffMs / 3_600_000); // round up
//     // Clamp: minimum 1h, maximum 168h (7d) to match DB retention
//     return Math.max(1, Math.min(hours, 168));
// }

// /**
//  * Build the full /api/geo-news URL with the correct ?hours= param.
//  * Extra params can be added here in future (severity, category, etc.)
//  */
// function buildApiUrl(timeRange: TimeRange): string {
//     const hours = timeRangeToHours(timeRange);
//     const params = new URLSearchParams({ hours: String(hours), limit: "500" });
//     return `/api/geo-news?${params.toString()}`;
// }

// // ─── Plugin ───────────────────────────────────────────────────

// export class GeoNewsPlugin implements WorldPlugin {
//     id          = "geo-news";
//     name        = "Geo News";
//     description = "Real-time security & disaster news geotagged on Nigeria";
//     icon        = Newspaper;
//     category    = "conflict" as const;
//     version     = "2.0.0";

//     private context: PluginContext | null = null;

//     /** IDs already pushed to alertsSlice — prevents duplicate toasts */
//     private pushedIds = new Set<string>();

//     /**
//      * Track the last timeRange we fetched for.
//      * When timeRange changes (user presses a time button), we clear
//      * pushedIds for that window so alerts show again if the window
//      * expands to include earlier articles.
//      */
//     private lastHours = 0;

//     async initialize(ctx: PluginContext): Promise<void> {
//         this.context = ctx;
//     }

//     destroy(): void {
//         this.context    = null;
//         this.pushedIds.clear();
//         this.lastHours  = 0;
//     }

//     // ─── Core fetch — called by PollingManager ──────────────────
//     //
//     // timeRange comes from pluginManager.context.timeRange which is
//     // updated by:
//     //   a) TimelineSync when the user changes the time window
//     //   b) pluginManager.updateTimeRange() from TimelineSync
//     //
//     async fetch(timeRange: TimeRange): Promise<GeoEntity[]> {
//         const hours = timeRangeToHours(timeRange);

//         // If the time window changed, clear pushed IDs so new
//         // articles in the wider/narrower window get toasted
//         if (hours !== this.lastHours) {
//             this.pushedIds.clear();
//             this.lastHours = hours;
//         }

//         try {
//             const url = buildApiUrl(timeRange);
//             console.log(`[GeoNewsPlugin] Fetching ${url}`);

//             const res = await fetch(url, { cache: "no-store" });

//             if (!res.ok) {
//                 console.error(`[GeoNewsPlugin] API returned ${res.status}`);
//                 this.context?.onError(new Error(`geo-news API ${res.status}`));
//                 return [];
//             }

//             const articles: RawNewsArticle[] = await res.json();

//             if (!Array.isArray(articles)) {
//                 console.error("[GeoNewsPlugin] API did not return an array:", articles);
//                 return [];
//             }

//             const entities:  GeoEntity[] = [];
//             const newAlerts: GeoAlert[]  = [];

//             for (const article of articles) {
//                 // Validate required fields before mapping
//                 if (
//                     typeof article.latitude  !== "number" ||
//                     typeof article.longitude !== "number" ||
//                     !article.id || !article.title
//                 ) {
//                     continue;
//                 }

//                 const entity: GeoEntity = {
//                     id:        article.id,
//                     pluginId:  this.id,
//                     latitude:  article.latitude,
//                     longitude: article.longitude,
//                     altitude:  0,
//                     timestamp: new Date(article.publishedAt),
//                     label:     article.title,
//                     properties: {
//                         title:       article.title,
//                         summary:     article.summary      ?? "",
//                         source:      article.source,
//                         url:         article.url,
//                         imageUrl:    article.imageUrl     ?? null,
//                         category:    article.category,
//                         severity:    article.severity,
//                         state:       article.state        ?? "",
//                         lga:         article.lga          ?? null,
//                         keywords:    Array.isArray(article.keywords) ? article.keywords : [],
//                         publishedAt: article.publishedAt,
//                     },
//                 };

//                 entities.push(entity);

//                 // Push to alertsSlice only for articles not yet seen
//                 if (!this.pushedIds.has(article.id)) {
//                     this.pushedIds.add(article.id);
//                     newAlerts.push({
//                         id:          article.id,
//                         title:       article.title,
//                         summary:     article.summary ?? "",
//                         source:      article.source,
//                         url:         article.url,
//                         imageUrl:    article.imageUrl,
//                         category:    article.category,
//                         severity:    article.severity,
//                         latitude:    article.latitude,
//                         longitude:   article.longitude,
//                         state:       article.state  ?? "",
//                         lga:         article.lga,
//                         publishedAt: new Date(article.publishedAt),
//                         fetchedAt:   new Date(),
//                         dismissed:   false,
//                         toasted:     false,
//                     });
//                 }
//             }

//             // Batch-push new alerts to the store
//             if (newAlerts.length > 0) {
//                 useStore.getState().addAlerts(newAlerts);
//             }

//             console.log(
//                 `[GeoNewsPlugin] ${entities.length} entities loaded` +
//                 ` (window: ${hours}h, ${newAlerts.length} new alerts)`
//             );

//             return entities;

//         } catch (err) {
//             console.error("[GeoNewsPlugin] fetch error:", err);
//             this.context?.onError(err instanceof Error ? err : new Error(String(err)));
//             return [];
//         }
//     }

//     /** Poll every 5 minutes */
//     getPollingInterval(): number {
//         return 5 * 60 * 1000;
//     }

//     getLayerConfig(): LayerConfig {
//         return {
//             color:           "#ef4444",
//             clusterEnabled:  true,
//             clusterDistance: 60,
//             maxEntities:     500,
//         };
//     }

//     renderEntity(entity: GeoEntity): CesiumEntityOptions {
//         const severity = (entity.properties.severity as AlertSeverity) ?? "low";
//         const category = (entity.properties.category as AlertCategory) ?? "other";
//         return {
//             type:         "point",
//             color:        SEVERITY_COLOR[severity] ?? "#94a3b8",
//             size:         CATEGORY_SIZE[category]  ?? 8,
//             outlineColor: "#ffffff",
//             outlineWidth: 1.5,
//             labelText:    entity.label,
//             labelFont:    "11px Inter, system-ui, sans-serif",
//         };
//     }

//     getDetailComponent() {
//         return GeoNewsDetail;
//     }

//     getFilterDefinitions(): FilterDefinition[] {
//         return [
//             {
//                 id:          "category",
//                 label:       "Category",
//                 type:        "select",
//                 propertyKey: "category",
//                 options: [
//                     { value: "terrorism",       label: "Terrorism / Boko Haram" },
//                     { value: "banditry",        label: "Banditry" },
//                     { value: "kidnapping",      label: "Kidnapping" },
//                     { value: "flooding",        label: "Flooding" },
//                     { value: "communal-clash",  label: "Communal Clash" },
//                     { value: "armed-robbery",   label: "Armed Robbery" },
//                     { value: "military-op",     label: "Military Operation" },
//                     { value: "protest",         label: "Protest / Unrest" },
//                     { value: "accident",        label: "Accident" },
//                     { value: "other",           label: "Other" },
//                 ],
//             },
//             {
//                 id:          "severity",
//                 label:       "Severity",
//                 type:        "select",
//                 propertyKey: "severity",
//                 options: [
//                     { value: "critical", label: "Critical" },
//                     { value: "high",     label: "High" },
//                     { value: "medium",   label: "Medium" },
//                     { value: "low",      label: "Low" },
//                 ],
//             },
//             {
//                 id:          "state",
//                 label:       "State",
//                 type:        "text",
//                 propertyKey: "state",
//             },
//             {
//                 id:          "title",
//                 label:       "Keyword Search",
//                 type:        "text",
//                 propertyKey: "title",
//             },
//         ];
//     }
// }






// /**
//  * GeoNewsPlugin
//  *
//  * Polls /api/geo-news every 5 minutes and maps each article to a
//  * GeoEntity on the globe. Each entity carries the full article
//  * metadata in its properties for the Intel panel.
//  *
//  * On every successful fetch it also pushes new articles into the
//  * Zustand alertsSlice so the GeoNewsAlertOverlay can toast them.
//  *
//  * Register in AppShell:
//  *   import { GeoNewsPlugin } from "@/plugins/geo-news";
//  *   pluginRegistry.register(new GeoNewsPlugin());
//  */

// import { Newspaper } from "lucide-react";
// import type {
//     WorldPlugin,
//     GeoEntity,
//     TimeRange,
//     PluginContext,
//     LayerConfig,
//     CesiumEntityOptions,
//     FilterDefinition,
// } from "@/core/plugins/PluginTypes";
// import { useStore } from "@/core/state/store";
// import type { GeoAlert, AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";
// import type { RawNewsArticle } from "./geoNewsTypes";
// import { GeoNewsDetail } from "./GeoNewsDetail";

// // ─── Severity → Cesium color ─────────────────────────────────
// const SEVERITY_COLOR: Record<AlertSeverity, string> = {
//     critical: "#ef4444",  // red
//     high:     "#f97316",  // orange
//     medium:   "#f59e0b",  // amber
//     low:      "#22d3ee",  // cyan
// };

// // ─── Category → marker size ───────────────────────────────────
// const CATEGORY_SIZE: Record<AlertCategory, number> = {
//     terrorism:      12,
//     banditry:       10,
//     kidnapping:     11,
//     flooding:       10,
//     "communal-clash": 9,
//     "armed-robbery":  8,
//     "military-op":    8,
//     protest:          7,
//     accident:         7,
//     other:            7,
// };

// export class GeoNewsPlugin implements WorldPlugin {
//     id          = "geo-news";
//     name        = "Geo News";
//     description = "Real-time security & disaster news geotagged on Nigeria";
//     icon        = Newspaper;
//     category    = "conflict" as const;
//     version     = "1.0.0";

//     private context: PluginContext | null = null;
//     /** IDs already pushed to alertsSlice — prevents duplicate toasts */
//     private pushedIds = new Set<string>();

//     async initialize(ctx: PluginContext): Promise<void> {
//         this.context = ctx;
//     }

//     destroy(): void {
//         this.context = null;
//         this.pushedIds.clear();
//     }

//     async fetch(_timeRange: TimeRange): Promise<GeoEntity[]> {
//         try {
//             const res = await fetch("/api/geo-news", { cache: "no-store" });
//             if (!res.ok) return [];

//             const articles: RawNewsArticle[] = await res.json();
//             const entities: GeoEntity[] = [];
//             const newAlerts: GeoAlert[] = [];

//             for (const article of articles) {
//                 const entity: GeoEntity = {
//                     id:        article.id,
//                     pluginId:  this.id,
//                     latitude:  article.latitude,
//                     longitude: article.longitude,
//                     altitude:  0,
//                     timestamp: new Date(article.publishedAt),
//                     label:     article.title,
//                     properties: {
//                         title:       article.title,
//                         summary:     article.summary,
//                         source:      article.source,
//                         url:         article.url,
//                         imageUrl:    article.imageUrl    ?? null,
//                         category:    article.category,
//                         severity:    article.severity,
//                         state:       article.state,
//                         lga:         article.lga         ?? null,
//                         keywords:    article.keywords,
//                         publishedAt: article.publishedAt,
//                     },
//                 };
//                 entities.push(entity);

//                 // Push to alerts store if not yet seen
//                 if (!this.pushedIds.has(article.id)) {
//                     this.pushedIds.add(article.id);
//                     newAlerts.push({
//                         id:          article.id,
//                         title:       article.title,
//                         summary:     article.summary,
//                         source:      article.source,
//                         url:         article.url,
//                         imageUrl:    article.imageUrl,
//                         category:    article.category,
//                         severity:    article.severity,
//                         latitude:    article.latitude,
//                         longitude:   article.longitude,
//                         state:       article.state,
//                         lga:         article.lga,
//                         publishedAt: new Date(article.publishedAt),
//                         fetchedAt:   new Date(),
//                         dismissed:   false,
//                         toasted:     false,
//                     });
//                 }
//             }

//             // Batch-push new alerts to the store
//             if (newAlerts.length > 0) {
//                 useStore.getState().addAlerts(newAlerts);
//             }

//             return entities;

//         } catch (err) {
//             console.error("[GeoNewsPlugin] fetch error:", err);
//             this.context?.onError(err instanceof Error ? err : new Error(String(err)));
//             return [];
//         }
//     }

//     /** Poll every 5 minutes */
//     getPollingInterval(): number {
//         return 5 * 60 * 1000;
//     }

//     getLayerConfig(): LayerConfig {
//         return {
//             color:           "#ef4444",
//             clusterEnabled:  true,
//             clusterDistance: 60,
//             maxEntities:     500,
//         };
//     }

//     renderEntity(entity: GeoEntity): CesiumEntityOptions {
//         const severity = entity.properties.severity as AlertSeverity ?? "low";
//         const category = entity.properties.category as AlertCategory ?? "other";
//         return {
//             type:         "point",
//             color:        SEVERITY_COLOR[severity],
//             size:         CATEGORY_SIZE[category] ?? 8,
//             outlineColor: "#ffffff",
//             outlineWidth: 1.5,
//             labelText:    entity.label,
//             labelFont:    "11px Inter, system-ui, sans-serif",
//         };
//     }

//     getDetailComponent() {
//         return GeoNewsDetail;
//     }

//     getFilterDefinitions(): FilterDefinition[] {
//         return [
//             {
//                 id:          "category",
//                 label:       "Category",
//                 type:        "select",
//                 propertyKey: "category",
//                 options: [
//                     { value: "terrorism",       label: "Terrorism / Boko Haram" },
//                     { value: "banditry",         label: "Banditry" },
//                     { value: "kidnapping",       label: "Kidnapping" },
//                     { value: "flooding",         label: "Flooding" },
//                     { value: "communal-clash",   label: "Communal Clash" },
//                     { value: "armed-robbery",    label: "Armed Robbery" },
//                     { value: "military-op",      label: "Military Operation" },
//                     { value: "protest",          label: "Protest / Unrest" },
//                     { value: "other",            label: "Other" },
//                 ],
//             },
//             {
//                 id:          "severity",
//                 label:       "Severity",
//                 type:        "select",
//                 propertyKey: "severity",
//                 options: [
//                     { value: "critical", label: "Critical" },
//                     { value: "high",     label: "High" },
//                     { value: "medium",   label: "Medium" },
//                     { value: "low",      label: "Low" },
//                 ],
//             },
//             {
//                 id:          "state",
//                 label:       "State",
//                 type:        "text",
//                 propertyKey: "state",
//             },
//             {
//                 id:          "title",
//                 label:       "Keyword Search",
//                 type:        "text",
//                 propertyKey: "title",
//             },
//         ];
//     }
// }