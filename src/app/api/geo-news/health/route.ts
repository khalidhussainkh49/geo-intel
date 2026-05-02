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

// import { NextResponse } from "next/server";
// import { checkDbHealth } from "@/plugins/geo-news/newsDb";

// export const dynamic = "force-dynamic";

// export async function GET() {
//     // ── Environment variable check ────────────────────────────
//     const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
//     const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
//     const cronSecret  = process.env.CRON_SECRET;

//     const env = {
//         NEXT_PUBLIC_SUPABASE_URL:
//             supabaseUrl
//                 ? `✓ set (${supabaseUrl.replace(/^https:\/\/([^.]+).*/, "https://$1.supabase.co")})`
//                 : "❌ NOT SET",
//         SUPABASE_SERVICE_ROLE_KEY:
//             serviceKey
//                 ? `✓ set (${serviceKey.slice(0, 10)}...)`
//                 : "❌ NOT SET",
//         CRON_SECRET:
//             cronSecret ? "✓ set" : "⚠ not set (POST endpoint unprotected)",
//     };

//     // ── DB health check ───────────────────────────────────────
//     const health = await checkDbHealth();

//     return NextResponse.json(
//         {
//             ok:      health.ok,
//             message: health.message,
//             count:   health.count,
//             env,
//             timestamp: new Date().toISOString(),
//         },
//         {
//             status:  health.ok ? 200 : 503,
//             headers: { "Cache-Control": "no-store" },
//         }
//     );
// }





/**
 * src/app/api/geo-news/health/route.ts
 *
 * Diagnostic endpoint. Open in browser:
 *   https://your-domain.com/api/geo-news/health
 *
 * Returns: DB connection status + LLM provider configuration.
 */

import { NextResponse } from "next/server";
import { checkDbHealth } from "@/plugins/geo-news/newsDb";
import { getProviderStatus } from "@/plugins/geo-news/llmclassifier";

export const dynamic = "force-dynamic";

export async function GET() {
    const db = await checkDbHealth();
    const llm = getProviderStatus();

    // Build human-readable provider summary
    const availableProviders = [
        llm.claude ? "claude" : null,
        llm.openai ? "openai" : null,
        llm.deepseek ? "deepseek" : null,
        "local",   // always listed — uses default URL
    ].filter(Boolean);

    return NextResponse.json({
        db: {
            ok: db.ok,
            message: db.message,
            count: db.count,
        },
        llm: {
            primary: llm.primary,
            fallback: llm.fallback,
            availableProviders,
            config: {
                claude: llm.claude ? "✓ ANTHROPIC_API_KEY set" : "✗ not configured",
                openai: llm.openai ? "✓ OPENAI_API_KEY set" : "✗ not configured",
                deepseek: llm.deepseek ? "✓ DEEPSEEK_API_KEY set" : "✗ not configured",
                local: `✓ ${process.env.LOCAL_LLM_URL ?? "http://ai1.nigeriatradehub.gov.ng/api/generate"} (model: ${process.env.LOCAL_LLM_MODEL ?? "llama3"})`,
            },
        },
        env: {
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
                ? `✓ ${process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/^https:\/\/([^.]+).*/, "https://$1.supabase.co")}`
                : "✗ NOT SET",
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY
                ? `✓ set (${process.env.SUPABASE_SERVICE_ROLE_KEY.slice(0, 10)}...)`
                : "✗ NOT SET",
            CRON_SECRET: process.env.CRON_SECRET ? "✓ set" : "⚠ not set",
            LLM_PROVIDER: process.env.LLM_PROVIDER ?? "(auto)",
            LLM_PROVIDER_FALLBACK: process.env.LLM_PROVIDER_FALLBACK ?? "(auto)",
        },
        timestamp: new Date().toISOString(),
    }, {
        status: db.ok ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
    });
}