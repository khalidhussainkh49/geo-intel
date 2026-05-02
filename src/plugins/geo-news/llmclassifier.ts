/**
 * llmClassifier.ts  — NCS GeoIntel
 *
 * Multi-provider LLM classifier for Nigerian news articles.
 *
 * ── Provider priority chain ───────────────────────────────────
 *
 *   Providers are tried in order until one succeeds.
 *   Order is controlled by the LLM_PROVIDER env var (see below).
 *   On any failure (timeout, bad JSON, API error, missing key)
 *   the next provider in the chain is tried automatically.
 *   If every LLM provider fails, keyword rules run as the last resort.
 *
 * ── Environment variables ─────────────────────────────────────
 *
 *   LLM_PROVIDER=claude          Primary provider to use.
 *                                Values: claude | openai | deepseek | local
 *                                Default: auto (first available key wins)
 *
 *   LLM_PROVIDER_FALLBACK=openai,deepseek,local
 *                                Comma-separated fallback order.
 *                                Default: all remaining providers tried in
 *                                the order: claude → openai → deepseek → local
 *
 *   ANTHROPIC_API_KEY=sk-ant-... Claude (Anthropic)
 *   OPENAI_API_KEY=sk-...        OpenAI  (GPT-4o-mini by default)
 *   DEEPSEEK_API_KEY=sk-...      DeepSeek
 *   LOCAL_LLM_URL=http://ai1.nigeriatradehub.gov.ng/api/generate
 *                                Custom / locally-hosted model endpoint.
 *                                Compatible with Ollama's /api/generate format.
 *   LOCAL_LLM_MODEL=llama3       Model name sent to the local endpoint.
 *                                Default: "llama3"
 *   LOCAL_LLM_API_KEY=           Optional bearer token for the local endpoint.
 *
 * ── Provider wire formats ──────────────────────────────────────
 *
 *   claude   → Anthropic Messages API  /v1/messages
 *   openai   → OpenAI Chat Completions /v1/chat/completions
 *              (also works with any OpenAI-compatible API)
 *   deepseek → DeepSeek Chat API       /v1/chat/completions
 *              (identical schema to OpenAI)
 *   local    → Ollama /api/generate    (generate, not chat)
 *              Set LOCAL_LLM_URL to your endpoint.
 *
 * ── Fallback chain ─────────────────────────────────────────────
 *
 *   Tier 1  Selected LLM provider(s) — tried in priority order
 *   Tier 2  Keyword rules             — fast, deterministic
 *   Tier 3  Default                   — category:other, severity:low
 */

import type { AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";

// ─── Shared types ─────────────────────────────────────────────

export interface ClassificationResult {
    category: AlertCategory;
    severity: AlertSeverity;
    keywords: string[];
    reason?: string;
    confidence: number;
    method: "llm" | "keyword" | "default";
    provider?: string;          // which LLM provider succeeded
}

interface ArticleInput {
    index: number;
    title: string;
    summary: string;
}

interface LlmArticleResult {
    index: number;
    category: string;
    severity: string;
    keywords: string[];
    reason: string;
    confidence: number;
}

// ─── Validation helpers ───────────────────────────────────────

const VALID_CATEGORIES = new Set<AlertCategory>([
    "terrorism", "banditry", "kidnapping", "flooding",
    "communal-clash", "armed-robbery", "military-op",
    "protest", "accident", "other",
]);
const VALID_SEVERITIES = new Set<AlertSeverity>([
    "critical", "high", "medium", "low",
]);

function isValidCategory(v: string): v is AlertCategory {
    return VALID_CATEGORIES.has(v as AlertCategory);
}
function isValidSeverity(v: string): v is AlertSeverity {
    return VALID_SEVERITIES.has(v as AlertSeverity);
}

// ─── Shared prompt ────────────────────────────────────────────
// Same prompt goes to every provider — JSON-only output,
// Nigeria-specific context, confidence scoring.

const SYSTEM_PROMPT = `You are an intelligence analyst for the Nigeria Customs Service (NCS) GeoIntel platform. Classify Nigerian news articles by event type and severity for security and disaster monitoring.

CATEGORIES (pick exactly one):
- terrorism       : Boko Haram, ISWAP, bombings, IEDs, suicide attacks, jihadist attacks
- banditry        : armed bandits, cattle rustling, rural armed attacks, highway robbery in rural areas
- kidnapping      : abductions, hostage-taking, ransom demands, missing persons
- flooding        : floods, heavy rainfall, dam breaks, landslides, erosion disasters
- communal-clash  : farmer-herder conflicts, ethnic/tribal clashes, inter-community violence, reprisal attacks
- armed-robbery   : urban robberies, highway robbery, one-chance crimes, robbery at gunpoint
- military-op     : military operations, troop deployments, army offensives, security force actions
- protest         : demonstrations, riots, strikes, civil unrest, road blockades
- accident        : road crashes, building collapses, industrial explosions, pipeline fires
- other           : anything that does not fit the above

SEVERITY (pick exactly one):
- critical : mass casualties, major terrorist attack, large-scale kidnapping (10+ victims)
- high     : fatalities confirmed, significant attack, kidnapping (1-9 victims), severe flooding
- medium   : injuries, attempted attack, minor security incident
- low      : no immediate harm, unconfirmed report, threat alert, minor protest

RULES:
1. Classify the ACTUAL EVENT, not the reporter or responder.
2. Pick the PRIMARY/most severe event type if multiple apply.
3. Military operations AGAINST terrorists → "military-op" unless the attack is the focus.
4. Extract up to 6 keywords/phrases from the actual text.
5. Keep "reason" to one sentence.
6. Confidence: 0.9-1.0=clear, 0.7-0.89=likely, 0.5-0.69=uncertain, <0.5=use "other".

Respond ONLY with a valid JSON array. No markdown fences, no text outside the array.`;

function buildUserPrompt(articles: ArticleInput[]): string {
    return `Classify these ${articles.length} Nigerian news articles:

${articles.map(a =>
        `[${a.index}]\nTITLE: ${a.title}\nSUMMARY: ${a.summary.slice(0, 300)}`
    ).join("\n\n")}

Return a JSON array of exactly ${articles.length} objects:
[{"index":<N>,"category":"<cat>","severity":"<sev>","keywords":["<kw>",...],"reason":"<sentence>","confidence":<0-1>},...]`;
}

// ─── Response parser (shared by all providers) ────────────────

function parseResponse(raw: string, providerName: string): Map<number, LlmArticleResult> {
    const results = new Map<number, LlmArticleResult>();

    const cleaned = raw
        .replace(/^```(?:json)?\s*/im, "")
        .replace(/\s*```\s*$/m, "")
        .trim();

    // Find the JSON array even if there's leading/trailing prose
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) {
        console.warn(`[llmClassifier:${providerName}] No JSON array found in response`);
        return results;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(arrayMatch[0]);
    } catch (e) {
        console.warn(`[llmClassifier:${providerName}] JSON parse error:`, e);
        return results;
    }

    if (!Array.isArray(parsed)) {
        console.warn(`[llmClassifier:${providerName}] Parsed value is not an array`);
        return results;
    }

    for (const item of parsed as any[]) {
        if (
            typeof item.index !== "number" ||
            !isValidCategory(String(item.category ?? "")) ||
            !isValidSeverity(String(item.severity ?? ""))
        ) continue;

        results.set(item.index, {
            index: item.index,
            category: item.category,
            severity: item.severity,
            keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 8) : [],
            reason: typeof item.reason === "string" ? item.reason.slice(0, 200) : "",
            confidence: typeof item.confidence === "number"
                ? Math.max(0, Math.min(1, item.confidence))
                : 0.7,
        });
    }

    return results;
}

// ─── Provider: Claude (Anthropic) ────────────────────────────

async function callClaude(
    articles: ArticleInput[],
    timeoutMs: number
): Promise<Map<number, LlmArticleResult>> {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) return new Map();

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: ctrl.signal,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: process.env.CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
                max_tokens: 2048,
                system: SYSTEM_PROMPT,
                messages: [{ role: "user", content: buildUserPrompt(articles) }],
            }),
        });

        clearTimeout(timer);
        if (!res.ok) {
            console.warn(`[llmClassifier:claude] HTTP ${res.status}`);
            return new Map();
        }

        const data = await res.json();
        const text = data?.content?.[0]?.text ?? "";
        const result = parseResponse(text, "claude");
        console.log(`[llmClassifier:claude] ${result.size}/${articles.length} classified`);
        return result;

    } catch (err: any) {
        clearTimeout(timer);
        console.warn(`[llmClassifier:claude] Failed: ${err.message}`);
        return new Map();
    }
}

// ─── Provider: OpenAI ─────────────────────────────────────────
// Also handles any OpenAI-compatible endpoint (together.ai, groq, etc.)
// by setting OPENAI_BASE_URL.

async function callOpenAI(
    articles: ArticleInput[],
    timeoutMs: number
): Promise<Map<number, LlmArticleResult>> {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return new Map();

    const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: "POST",
            signal: ctrl.signal,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${key}`,
            },
            body: JSON.stringify({
                model,
                max_tokens: 2048,
                temperature: 0.1,   // low temperature for consistent JSON
                response_format: { type: "json_object" }, // works on gpt-4o models
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: buildUserPrompt(articles) },
                ],
            }),
        });

        clearTimeout(timer);
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[llmClassifier:openai] HTTP ${res.status}: ${body.slice(0, 200)}`);
            return new Map();
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        const result = parseResponse(text, "openai");
        console.log(`[llmClassifier:openai] ${result.size}/${articles.length} classified`);
        return result;

    } catch (err: any) {
        clearTimeout(timer);
        console.warn(`[llmClassifier:openai] Failed: ${err.message}`);
        return new Map();
    }
}

// ─── Provider: DeepSeek ───────────────────────────────────────
// Uses the same OpenAI-compatible /v1/chat/completions format.

async function callDeepSeek(
    articles: ArticleInput[],
    timeoutMs: number
): Promise<Map<number, LlmArticleResult>> {
    const key = process.env.DEEPSEEK_API_KEY?.trim();
    if (!key) return new Map();

    const model = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
            method: "POST",
            signal: ctrl.signal,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${key}`,
            },
            body: JSON.stringify({
                model,
                max_tokens: 2048,
                temperature: 0.1,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: buildUserPrompt(articles) },
                ],
            }),
        });

        clearTimeout(timer);
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[llmClassifier:deepseek] HTTP ${res.status}: ${body.slice(0, 200)}`);
            return new Map();
        }

        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        const result = parseResponse(text, "deepseek");
        console.log(`[llmClassifier:deepseek] ${result.size}/${articles.length} classified`);
        return result;

    } catch (err: any) {
        clearTimeout(timer);
        console.warn(`[llmClassifier:deepseek] Failed: ${err.message}`);
        return new Map();
    }
}

// ─── Provider: Local / Ollama endpoint ───────────────────────
// Default target: http://ai1.nigeriatradehub.gov.ng/api/generate
// Compatible with Ollama's /api/generate wire format.
// Also works with any server that accepts { model, prompt, stream:false }.

async function callLocal(
    articles: ArticleInput[],
    timeoutMs: number
): Promise<Map<number, LlmArticleResult>> {
    const url = (process.env.LOCAL_LLM_URL ?? "http://ai1.nigeriatradehub.gov.ng/api/generate").trim();
    const model = process.env.LOCAL_LLM_MODEL ?? "llama3";
    const apiKey = process.env.LOCAL_LLM_API_KEY?.trim(); // optional

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    // Build a combined system+user prompt for models that only accept
    // a single "prompt" field (Ollama /api/generate style)
    const fullPrompt = `${SYSTEM_PROMPT}\n\n${buildUserPrompt(articles)}`;

    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch(url, {
            method: "POST",
            signal: ctrl.signal,
            headers,
            body: JSON.stringify({
                model,
                prompt: fullPrompt,
                stream: false,          // Ollama: return full response, not streaming
                options: {
                    temperature: 0.1,
                    num_predict: 2048,
                },
            }),
        });

        clearTimeout(timer);

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn(`[llmClassifier:local] HTTP ${res.status}: ${body.slice(0, 200)}`);
            return new Map();
        }

        const data = await res.json();

        // Ollama returns { response: "..." }
        // Some custom endpoints return { text: "..." } or { content: "..." }
        // or OpenAI-style { choices: [{message:{content:"..."}}] }
        const text =
            data?.response ??  // Ollama
            data?.text ??  // simple custom
            data?.content ??  // another common field
            data?.choices?.[0]?.message?.content ??  // OpenAI-compatible
            data?.choices?.[0]?.text ??  // some local servers
            "";

        if (!text) {
            console.warn("[llmClassifier:local] Empty response. Raw:", JSON.stringify(data).slice(0, 300));
            return new Map();
        }

        const result = parseResponse(String(text), "local");
        console.log(`[llmClassifier:local] ${result.size}/${articles.length} classified via ${url}`);
        return result;

    } catch (err: any) {
        clearTimeout(timer);
        console.warn(`[llmClassifier:local] Failed (${err.message})`);
        return new Map();
    }
}

// ─── Provider registry ────────────────────────────────────────

type ProviderName = "claude" | "openai" | "deepseek" | "local";

interface Provider {
    name: ProviderName;
    call: (articles: ArticleInput[], timeoutMs: number) => Promise<Map<number, LlmArticleResult>>;
    hasKey: () => boolean;
}

const PROVIDERS: Provider[] = [
    {
        name: "claude",
        call: callClaude,
        hasKey: () => !!process.env.ANTHROPIC_API_KEY?.trim(),
    },
    {
        name: "openai",
        call: callOpenAI,
        hasKey: () => !!process.env.OPENAI_API_KEY?.trim(),
    },
    {
        name: "deepseek",
        call: callDeepSeek,
        hasKey: () => !!process.env.DEEPSEEK_API_KEY?.trim(),
    },
    {
        name: "local",
        call: callLocal,
        // Local endpoint is "available" if URL is set OR if we use the default NTH URL
        hasKey: () => true,
    },
];

const PROVIDER_MAP = new Map(PROVIDERS.map(p => [p.name, p]));

/**
 * Build the ordered list of providers to try for this run.
 *
 * Rules:
 *   1. If LLM_PROVIDER is set, that provider goes first.
 *   2. If LLM_PROVIDER_FALLBACK is set, those follow in order.
 *   3. Otherwise, all providers that have a key are tried in
 *      default order: claude → openai → deepseek → local.
 *   4. Providers without a key/config are skipped silently.
 */
function buildProviderChain(): Provider[] {
    const primary = process.env.LLM_PROVIDER?.trim().toLowerCase() as ProviderName | undefined;
    const fallback = process.env.LLM_PROVIDER_FALLBACK?.trim().toLowerCase();

    if (primary || fallback) {
        const names: ProviderName[] = [];
        if (primary) names.push(primary as ProviderName);
        if (fallback) {
            fallback.split(",").forEach(n => {
                const name = n.trim() as ProviderName;
                if (name && !names.includes(name)) names.push(name);
            });
        }
        // Add any remaining providers not already listed
        PROVIDERS.forEach(p => {
            if (!names.includes(p.name)) names.push(p.name);
        });
        return names
            .map(n => PROVIDER_MAP.get(n))
            .filter((p): p is Provider => !!p && p.hasKey());
    }

    // Default: all providers that have credentials, in default order
    return PROVIDERS.filter(p => p.hasKey());
}

// ─── Keyword fallback ─────────────────────────────────────────

interface KeywordRule {
    keywords: string[];
    category: AlertCategory;
    severity: AlertSeverity;
}

const KEYWORD_RULES: KeywordRule[] = [
    { keywords: ["boko haram", "iswap", "islamic state west africa", "jnim", "ansaru", "jas", "ied", "suicide bomb", "suicide bomber", "car bomb", "improvised explosive", "insurgent", "jihadist", "bomb blast", "rocket attack"], category: "terrorism", severity: "critical" },
    { keywords: ["kidnap", "abduct", "abduction", "hostage", "ransom demand", "students abduct", "schoolchildren abducted", "workers abducted", "travelers kidnapped", "missing persons"], category: "kidnapping", severity: "critical" },
    { keywords: ["bandit", "bandits", "banditry", "armed bandits", "cattle rustl", "rustling", "bandit attack", "bandit kill", "gunmen attack"], category: "banditry", severity: "high" },
    { keywords: ["flood", "flooding", "flash flood", "heavy rainfall", "submerge", "dam break", "overflow", "riverbank burst", "landslide", "erosion disaster"], category: "flooding", severity: "high" },
    { keywords: ["communal clash", "herdsmen attack", "farmer herdsmen", "ethnic clash", "tribal clash", "village attack", "community attack", "reprisal attack", "intercommunal"], category: "communal-clash", severity: "high" },
    { keywords: ["armed robbery", "robbery attack", "highway robbery", "robbery suspect", "one chance", "robbers kill"], category: "armed-robbery", severity: "medium" },
    { keywords: ["troops kill", "soldiers kill", "army neutralise", "army killed", "military operation", "military offensive", "airstrikes", "military strike", "troops arrest"], category: "military-op", severity: "medium" },
    { keywords: ["protest", "riot", "demonstration", "unrest", "civil disturbance", "strike", "blockade road"], category: "protest", severity: "low" },
    { keywords: ["road accident", "auto crash", "tanker explosion", "pipeline explosion", "collapsed building", "building collapse"], category: "accident", severity: "medium" },
    { keywords: ["attack", "kill", "killed", "dead", "casualties", "fatalities", "massacre", "ambush", "gunshot", "shot dead"], category: "banditry", severity: "medium" },
];

export function classifyByKeyword(title: string, body: string): ClassificationResult {
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
        if (category !== "other" && category !== "banditry") break;
    }

    return {
        category,
        severity,
        keywords: [...matched].slice(0, 8),
        confidence: category === "other" ? 0 : 1.0,
        method: "keyword",
    };
}

// ─── Core batch function ──────────────────────────────────────

const TIMEOUT_MS = 30_000;   // 30s per provider attempt
const LLM_BATCH_SIZE = 20;       // articles per LLM call

async function classifyBatch(
    articles: ArticleInput[]
): Promise<{ results: Map<number, LlmArticleResult>; provider: string }> {
    const chain = buildProviderChain();

    if (chain.length === 0) {
        console.log("[llmClassifier] No LLM providers configured — using keyword classifier");
        return { results: new Map(), provider: "none" };
    }

    for (const provider of chain) {
        const results = await provider.call(articles, TIMEOUT_MS);
        if (results.size > 0) {
            return { results, provider: provider.name };
        }
        // This provider returned nothing — try the next one
        console.log(`[llmClassifier] Provider "${provider.name}" returned 0 results, trying next...`);
    }

    console.warn("[llmClassifier] All LLM providers failed — falling back to keyword classifier");
    return { results: new Map(), provider: "none" };
}

// ─── Public API ───────────────────────────────────────────────

/**
 * classifyArticles()
 *
 * Main entry point. Classifies an array of articles in order:
 *   1. Configured LLM provider(s)
 *   2. Keyword rules
 *   3. Default (other/low)
 */
export async function classifyArticles(
    articles: Array<{ title: string; summary: string }>
): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = new Array(articles.length);

    const inputs: ArticleInput[] = articles.map((a, i) => ({
        index: i,
        title: a.title,
        summary: a.summary,
    }));

    // Process in batches of LLM_BATCH_SIZE
    for (let start = 0; start < inputs.length; start += LLM_BATCH_SIZE) {
        const batch = inputs.slice(start, start + LLM_BATCH_SIZE);

        const { results: llmMap, provider } = await classifyBatch(batch);

        for (const input of batch) {
            const llm = llmMap.get(input.index);

            if (llm && llm.confidence >= 0.5) {
                // ── Tier 1: LLM result ─────────────────────────
                results[input.index] = {
                    category: llm.category as AlertCategory,
                    severity: llm.severity as AlertSeverity,
                    keywords: llm.keywords,
                    reason: llm.reason,
                    confidence: llm.confidence,
                    method: "llm",
                    provider,
                };
            } else {
                // ── Tier 2: Keyword fallback ───────────────────
                const article = articles[input.index];
                const kw = classifyByKeyword(article.title, article.summary);

                // If LLM returned low-confidence result, blend its
                // keywords and reason with the keyword classifier's
                // more reliable category/severity
                if (llm && llm.confidence > 0 && llm.confidence < 0.5) {
                    results[input.index] = {
                        ...kw,
                        keywords: [...new Set([...llm.keywords, ...kw.keywords])].slice(0, 8),
                        reason: llm.reason,
                        method: "keyword",
                        provider,
                    };
                } else {
                    results[input.index] = { ...kw, provider: "none" };
                }
            }
        }
    }

    // ── Tier 3: Default for anything still unset ──────────────
    for (let i = 0; i < results.length; i++) {
        if (!results[i]) {
            results[i] = {
                category: "other",
                severity: "low",
                keywords: [],
                confidence: 0,
                method: "default",
                provider: "none",
            };
        }
    }

    return results;
}

/**
 * classifySingle() — convenience wrapper for one article.
 */
export async function classifySingle(
    title: string,
    summary: string
): Promise<ClassificationResult> {
    const [result] = await classifyArticles([{ title, summary }]);
    return result;
}

/**
 * getProviderStatus() — returns which providers are currently configured.
 * Call from /api/geo-news/health to show LLM config in the health check.
 */
export function getProviderStatus(): Record<string, boolean | string> {
    return {
        claude: !!process.env.ANTHROPIC_API_KEY?.trim(),
        openai: !!process.env.OPENAI_API_KEY?.trim(),
        deepseek: !!process.env.DEEPSEEK_API_KEY?.trim(),
        local: true, // always "available" — uses default URL if not set
        primary: process.env.LLM_PROVIDER ?? "auto",
        fallback: process.env.LLM_PROVIDER_FALLBACK ?? "auto",
    };
}