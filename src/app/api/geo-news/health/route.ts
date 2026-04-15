/**
 * src/app/api/geo-news/health/route.ts
 *
 * Instant diagnostic endpoint. Open this URL in your browser:
 *   https://your-domain.com/api/geo-news/health
 *
 * Returns a JSON object with:
 *   ok      — true if Supabase is reachable and table exists
 *   message — human-readable status or error explanation
 *   count   — total articles in the table (when ok = true)
 *   env     — which env vars are set (values masked)
 *
 * Check this first whenever you see "fetch failed".
 */

import { NextResponse } from "next/server";
import { checkDbHealth } from "@/plugins/geo-news/newsDb";

export const dynamic = "force-dynamic";

export async function GET() {
    // ── Environment variable check ────────────────────────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const cronSecret  = process.env.CRON_SECRET;

    const env = {
        NEXT_PUBLIC_SUPABASE_URL:
            supabaseUrl
                ? `✓ set (${supabaseUrl.replace(/^https:\/\/([^.]+).*/, "https://$1.supabase.co")})`
                : "❌ NOT SET",
        SUPABASE_SERVICE_ROLE_KEY:
            serviceKey
                ? `✓ set (${serviceKey.slice(0, 10)}...)`
                : "❌ NOT SET",
        CRON_SECRET:
            cronSecret ? "✓ set" : "⚠ not set (POST endpoint unprotected)",
    };

    // ── DB health check ───────────────────────────────────────
    const health = await checkDbHealth();

    return NextResponse.json(
        {
            ok:      health.ok,
            message: health.message,
            count:   health.count,
            env,
            timestamp: new Date().toISOString(),
        },
        {
            status:  health.ok ? 200 : 503,
            headers: { "Cache-Control": "no-store" },
        }
    );
}