/**
 * lib/geo-news/geoNewsPoller.ts
 *
 * Server-side polling loop for the GeoNews pipeline.
 * Mirrors the aviation polling.ts pattern exactly:
 *   - Uses globalThis to survive Next.js HMR in development
 *   - Exponential backoff on failure (doubles up to 30 min)
 *   - Random jitter (0–10s) to prevent thundering herd
 *   - Guards against concurrent runs with isFetching flag
 *   - Logs per-source stats on every cycle
 *
 * Called once from instrumentation.ts on server startup:
 *   const { startGeoNewsPolling } = await import("./lib/geo-news/geoNewsPoller");
 *   startGeoNewsPolling();
 *
 * The loop runs independently of the client-side plugin.
 * The client plugin polls /api/geo-news GET which reads from the DB.
 * This poller writes to the DB via runNewsPipeline().
 */

import { runNewsPipeline } from "@/plugins/geo-news/newsPipeline";

// ─── Poll interval ────────────────────────────────────────────

const POLL_INTERVAL_MS  = 5 * 60 * 1000;  // 5 minutes — matches cron schedule
const MAX_BACKOFF_MS    = 30 * 60 * 1000; // 30 minutes maximum backoff
const STARTUP_DELAY_MS  = 15 * 1000;      // 15 seconds after server boot before first run
                                           // (gives DB connections time to initialise)

// ─── HMR-safe global state ────────────────────────────────────
// Stored on globalThis so a Next.js hot-reload in dev doesn't
// start a second polling loop alongside the original one.

interface GeoNewsPollerState {
    started:         boolean;
    isFetching:      boolean;
    currentBackoff:  number;
    lastRunAt:       number;
    lastSavedCount:  number;
    consecutiveErrors: number;
    timer:           NodeJS.Timeout | null;
}

function getState(): GeoNewsPollerState {
    const g = globalThis as any;
    if (!g.__geoNewsPollerState) {
        g.__geoNewsPollerState = {
            started:           false,
            isFetching:        false,
            currentBackoff:    POLL_INTERVAL_MS,
            lastRunAt:         0,
            lastSavedCount:    0,
            consecutiveErrors: 0,
            timer:             null,
        } satisfies GeoNewsPollerState;
    }
    return g.__geoNewsPollerState;
}

// ─── Single poll cycle ────────────────────────────────────────

async function pollGeoNews(): Promise<void> {
    const s = getState();

    // Guard against concurrent runs
    if (s.isFetching) {
        console.log("[GeoNewsPoller] Skipping — previous run still in progress");
        scheduleNext();
        return;
    }

    s.isFetching  = true;
    s.lastRunAt   = Date.now();

    try {
        console.log("[GeoNewsPoller] Starting pipeline run...");
        const start  = Date.now();

        const result = await runNewsPipeline({
            saveToDb:    true,
            concurrency: 8,
        });

        const ms = Date.now() - start;

        // Reset backoff on success
        s.currentBackoff    = POLL_INTERVAL_MS;
        s.consecutiveErrors = 0;
        s.lastSavedCount    = result.saved;

        console.log(
            `[GeoNewsPoller] ✓ Done in ${ms}ms — ` +
            `${result.total} processed, ${result.saved} saved, ` +
            `${result.skipped} skipped`
        );

        // Log per-source breakdown if any errors
        if (result.errors.length > 0) {
            console.warn(
                `[GeoNewsPoller] ${result.errors.length} source error(s):`,
                result.errors.join(" | ")
            );
        }

        // Log top sources
        const topSources = Object.entries(result.bySource)
            .filter(([, count]) => count > 0)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5)
            .map(([id, n]) => `${id}:${n}`)
            .join(", ");

        if (topSources) {
            console.log(`[GeoNewsPoller] Top sources: ${topSources}`);
        }

    } catch (err: any) {
        s.consecutiveErrors++;

        // Exponential backoff: double interval up to MAX_BACKOFF_MS
        s.currentBackoff = Math.min(
            s.currentBackoff * 2,
            MAX_BACKOFF_MS
        );

        const isTimeout = err?.name === "AbortError" || err?.name === "TimeoutError";
        const msg = isTimeout ? "connection timed out" : (err?.message ?? String(err));

        console.error(
            `[GeoNewsPoller] ✗ Error #${s.consecutiveErrors}: ${msg}. ` +
            `Backing off to ${s.currentBackoff / 1000}s`
        );

    } finally {
        s.isFetching = false;
        scheduleNext();
    }
}

// ─── Scheduler ────────────────────────────────────────────────

function scheduleNext(): void {
    const s = getState();

    // Clear any existing timer to avoid duplicate scheduling
    if (s.timer) clearTimeout(s.timer);

    // Add jitter: 0–10 seconds random offset
    const jitter = Math.floor(Math.random() * 10_000);
    const delay  = s.currentBackoff + jitter;

    s.timer = setTimeout(pollGeoNews, delay);
}

// ─── Public start function ────────────────────────────────────

/**
 * Start the geo-news polling loop.
 * Safe to call multiple times — only the first call does anything.
 * Called from instrumentation.ts on Node.js runtime startup.
 */
export function startGeoNewsPolling(): void {
    const s = getState();

    if (s.started) {
        console.log("[GeoNewsPoller] Already running — skipping duplicate start");
        return;
    }

    s.started = true;

    console.log(
        `[GeoNewsPoller] Starting — interval: ${POLL_INTERVAL_MS / 1000}s, ` +
        `startup delay: ${STARTUP_DELAY_MS / 1000}s`
    );

    // Delay the first run slightly to let the DB connection pool settle
    s.timer = setTimeout(pollGeoNews, STARTUP_DELAY_MS);
}

/**
 * Stop the polling loop (useful for tests or graceful shutdown).
 */
export function stopGeoNewsPolling(): void {
    const s = getState();
    if (s.timer) clearTimeout(s.timer);
    s.started    = false;
    s.isFetching = false;
    console.log("[GeoNewsPoller] Stopped");
}

/**
 * Returns the current poller state (for health checks / admin panels).
 */
export function getGeoNewsPollerStatus() {
    const s = getState();
    return {
        started:           s.started,
        isFetching:        s.isFetching,
        currentBackoffMs:  s.currentBackoff,
        lastRunAt:         s.lastRunAt ? new Date(s.lastRunAt).toISOString() : null,
        lastSavedCount:    s.lastSavedCount,
        consecutiveErrors: s.consecutiveErrors,
    };
}