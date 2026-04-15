/**
 * src/app/api/geo-news/poll/route.ts
 *
 * Cron endpoint that triggers the full news pipeline.
 * Designed to be called by:
 *
 *   a) Vercel Cron (vercel.json config below)
 *   b) External cron service (cron-job.org, Upstash QStash, etc.)
 *   c) Manual POST from your admin panel
 *
 * ── Vercel Cron setup ──────────────────────────────────────────
 * Add to vercel.json in your project root:
 *
 * {
 *   "crons": [
 *     {
 *       "path": "/api/geo-news/poll",
 *       "schedule": "* /5 * * * *"
 *     }
 *   ]
 * }
 * (Remove the space between * and /5 — it's there to avoid the JSDoc closing)
 * This runs every 5 minutes. Vercel sends requests with the
 * Authorization: Bearer ${CRON_SECRET} header automatically.
 *
 * ── External cron (if not using Vercel) ───────────────────────
 * Set up cron-job.org or similar to POST to:
 *   https://your-domain.com/api/geo-news/poll
 * with header:
 *   x-cron-secret: your_CRON_SECRET_value
 *
 * ── Environment variables ──────────────────────────────────────
 *   CRON_SECRET=any_random_string   (protects this endpoint)
 */

import { NextRequest, NextResponse } from "next/server";
import { runNewsPipeline } from "@/plugins/geo-news/newsPipeline";

export const dynamic    = "force-dynamic";
export const maxDuration = 60; // Vercel Pro: up to 300s; Hobby: 10s max

export async function GET(req: NextRequest) {
    // Vercel cron calls with GET + Authorization header
    return handlePoll(req);
}

export async function POST(req: NextRequest) {
    return handlePoll(req);
}

async function handlePoll(req: NextRequest) {
    // Verify cron secret
    const secret = process.env.CRON_SECRET;
    if (secret) {
        const auth = req.headers.get("authorization") ??
                     req.headers.get("x-cron-secret");
        if (auth !== secret && auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    const start = Date.now();
    console.log("[geo-news/poll] Cron triggered at", new Date().toISOString());

    try {
        const result = await runNewsPipeline({
            saveToDb:    true,
            concurrency: 8,
        });

        const ms = Date.now() - start;

        console.log(
            `[geo-news/poll] Done in ${ms}ms: ` +
            `${result.total} processed, ${result.saved} saved, ` +
            `${result.skipped} skipped, ${result.errors.length} source errors`
        );

        if (result.errors.length > 0) {
            console.warn("[geo-news/poll] Source errors:", result.errors);
        }

        return NextResponse.json({
            ok:       true,
            total:    result.total,
            saved:    result.saved,
            skipped:  result.skipped,
            bySource: result.bySource,
            errors:   result.errors,
            ms,
            timestamp: new Date().toISOString(),
        });

    } catch (err: any) {
        const ms = Date.now() - start;
        console.error("[geo-news/poll] Fatal error:", err);
        return NextResponse.json({
            ok:    false,
            error: err.message,
            ms,
        }, { status: 500 });
    }
}