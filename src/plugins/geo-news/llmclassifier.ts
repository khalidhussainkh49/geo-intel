/**
 * llmClassifier.ts
 *
 * LLM-first classification for Nigeria geo-news articles.
 *
 * Strategy (three tiers, tried in order):
 *
 *   Tier 1 — Claude (claude-sonnet-4-20250514)
 *     Articles are batched (up to 20 per API call) and sent to Claude
 *     with a structured JSON prompt. Claude classifies each article with
 *     category, severity, keywords, a short reason, and a confidence score.
 *     This handles nuance that keywords miss:
 *       • "Soldiers neutralise 12 Boko Haram" → terrorism + military-op
 *       • "Community loses homes to flood" → flooding, not banditry
 *       • "NCS intercepts 500 cartons of tramadol" → armed-robbery
 *       • Ambiguous headlines resolved by reading the summary
 *
 *   Tier 2 — Keyword rules (fast, deterministic)
 *     Used when:
 *       a) ANTHROPIC_API_KEY is not set
 *       b) Claude API call fails or times out
 *       c) Claude returns malformed JSON
 *     This is the original classifyArticle() from newsPipeline.ts,
 *     preserved intact as the fallback.
 *
 *   Tier 3 — Default
 *     category: "other", severity: "low"
 *     Used when both LLM and keywords produce no match.
 *
 * ── Environment variable ──────────────────────────────────────
 *   ANTHROPIC_API_KEY=sk-ant-...
 *   (same key used by the rest of the NCS GeoIntel system)
 *
 * ── Cost estimate ─────────────────────────────────────────────
 *   claude-sonnet-4-20250514 at batch size 20:
 *   ~300 input tokens + ~200 output tokens per article batch call
 *   = ~500 tokens per 20 articles ≈ $0.0015 per pipeline run
 *   At 5-min poll interval = ~$0.43/day — negligible.
 *
 * ── Timeout / rate-limit handling ────────────────────────────
 *   Each Claude call has a 30s timeout.
 *   On any error (rate limit, timeout, JSON parse), the entire batch
 *   falls back to keyword classification — no articles are lost.
 */

import type { AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";

// ─── Types ────────────────────────────────────────────────────

export interface ClassificationResult {
    category: AlertCategory;
    severity: AlertSeverity;
    keywords: string[];
    reason?: string;       // Claude's one-line explanation
    confidence: number;       // 0–1, from Claude; 1.0 for keyword matches
    method: "llm" | "keyword" | "default";
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

// ─── Keyword fallback (preserved from newsPipeline.ts) ───────

interface KeywordRule {
    keywords: string[];
    category: AlertCategory;
    severity: AlertSeverity;
}

const KEYWORD_RULES: KeywordRule[] = [
    {
        keywords: [
            "boko haram", "iswap", "islamic state west africa",
            "jnim", "ansaru", "jas", "ied", "suicide bomb",
            "suicide bomber", "car bomb", "improvised explosive",
            "insurgent", "jihadist", "bomb blast", "rocket attack",
        ],
        category: "terrorism", severity: "critical",
    },
    {
        keywords: [
            "kidnap", "abduct", "abduction", "hostage",
            "ransom demand", "students abduct", "schoolchildren abducted",
            "workers abducted", "travelers kidnapped", "missing persons",
        ],
        category: "kidnapping", severity: "critical",
    },
    {
        keywords: [
            "bandit", "bandits", "banditry", "armed bandits",
            "cattle rustl", "rustling", "bandit attack", "bandit kill",
            "gunmen attack",
        ],
        category: "banditry", severity: "high",
    },
    {
        keywords: [
            "flood", "flooding", "flash flood", "heavy rainfall",
            "submerge", "dam break", "overflow", "riverbank burst",
            "landslide", "erosion disaster",
        ],
        category: "flooding", severity: "high",
    },
    {
        keywords: [
            "communal clash", "herdsmen attack", "farmer herdsmen",
            "ethnic clash", "tribal clash", "village attack",
            "community attack", "reprisal attack", "intercommunal",
        ],
        category: "communal-clash", severity: "high",
    },
    {
        keywords: [
            "armed robbery", "robbery attack", "highway robbery",
            "robbery suspect", "one chance", "robbers kill",
        ],
        category: "armed-robbery", severity: "medium",
    },
    {
        keywords: [
            "troops kill", "soldiers kill", "army neutralise",
            "army killed", "military operation", "military offensive",
            "airstrikes", "military strike", "troops arrest",
        ],
        category: "military-op", severity: "medium",
    },
    {
        keywords: [
            "protest", "riot", "demonstration", "unrest",
            "civil disturbance", "strike", "blockade road",
        ],
        category: "protest", severity: "low",
    },
    {
        keywords: [
            "road accident", "auto crash", "tanker explosion",
            "pipeline explosion", "collapsed building", "building collapse",
        ],
        category: "accident", severity: "medium",
    },
    // catch-all
    {
        keywords: [
            "attack", "kill", "killed", "dead", "casualties",
            "fatalities", "massacre", "ambush", "gunshot", "shot dead",
        ],
        category: "banditry", severity: "medium",
    },
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

// ─── Valid values for Claude response validation ───────────────

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

// ─── Claude batch classifier ──────────────────────────────────

const SYSTEM_PROMPT = `You are an intelligence analyst for the Nigeria Customs Service (NCS) GeoIntel platform. Your task is to classify Nigerian news articles by event type and severity for security and disaster monitoring.

CATEGORIES (pick exactly one):
- terrorism       : Boko Haram, ISWAP, bombings, IEDs, suicide attacks, jihadist attacks
- banditry        : armed bandits, cattle rustling, rural armed attacks, highway robbers in rural areas
- kidnapping      : abductions, hostage-taking, ransom demands, missing persons cases
- flooding        : floods, heavy rainfall, dam breaks, landslides, erosion disasters
- communal-clash  : farmer-herder conflicts, ethnic/tribal clashes, inter-community violence, reprisal attacks
- armed-robbery   : urban robberies, highway robbery, one-chance crimes, robbery at gunpoint
- military-op     : military operations, troop deployments, army offensives, security force actions
- protest         : demonstrations, riots, strikes, civil unrest, road blockades
- accident        : road crashes, building collapses, industrial explosions, pipeline fires
- other           : anything that does not fit the above

SEVERITY (pick exactly one):
- critical : mass casualties, major terrorist attack, large-scale kidnapping (10+ victims), city-level flooding
- high     : fatalities confirmed, significant attack, kidnapping (1–9 victims), severe flooding
- medium   : injuries, attempted attack, minor security incident, localised flooding
- low      : no immediate harm, unconfirmed report, threat alert, minor protest

RULES:
1. Base classification on the ACTUAL EVENT described, not on who is reporting it.
2. If an article covers multiple event types, pick the PRIMARY/most severe one.
3. Military operations AGAINST terrorists → category is "military-op" unless the attack itself is the focus.
4. Extract up to 6 specific keywords/phrases that triggered your classification (actual words from the text).
5. Keep "reason" to one sentence maximum.
6. Confidence: 0.9–1.0 = very clear, 0.7–0.89 = likely, 0.5–0.69 = uncertain, below 0.5 = use "other".

Respond ONLY with a JSON array. No markdown, no explanation outside the JSON.`;

const USER_PROMPT_TEMPLATE = (articles: ArticleInput[]) => `Classify these ${articles.length} Nigerian news articles:

${articles.map(a => `[${a.index}]
TITLE: ${a.title}
SUMMARY: ${a.summary.slice(0, 300)}`).join("\n\n")}

Respond with a JSON array of exactly ${articles.length} objects, one per article, in the same order:
[
  {
    "index": <number matching the [N] above>,
    "category": "<one of the valid categories>",
    "severity": "<one of the valid severities>",
    "keywords": ["<word from text>", ...],
    "reason": "<one sentence>",
    "confidence": <0.0–1.0>
  },
  ...
]`;

async function classifyBatchWithLlm(
    articles: ArticleInput[]
): Promise<Map<number, LlmArticleResult>> {
    const results = new Map<number, LlmArticleResult>();

    if (!process.env.ANTHROPIC_API_KEY) {
        return results; // no key → empty map → keyword fallback
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": process.env.ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 2000,
                system: SYSTEM_PROMPT,
                messages: [
                    {
                        role: "user",
                        content: USER_PROMPT_TEMPLATE(articles),
                    },
                ],
            }),
        });

        clearTimeout(timer);

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            console.warn(
                `[llmClassifier] Claude API ${response.status}: ${body.slice(0, 200)}`
            );
            return results;
        }

        const data = await response.json();
        const text = data?.content?.[0]?.text ?? "";

        // Strip any accidental markdown fences
        const cleaned = text
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/, "")
            .trim();

        const parsed: LlmArticleResult[] = JSON.parse(cleaned);

        if (!Array.isArray(parsed)) {
            console.warn("[llmClassifier] Claude response is not an array");
            return results;
        }

        for (const item of parsed) {
            if (
                typeof item.index !== "number" ||
                !isValidCategory(item.category) ||
                !isValidSeverity(item.severity)
            ) {
                continue; // skip malformed items
            }
            results.set(item.index, {
                index: item.index,
                category: item.category,
                severity: item.severity,
                keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 8) : [],
                reason: typeof item.reason === "string" ? item.reason : "",
                confidence: typeof item.confidence === "number"
                    ? Math.max(0, Math.min(1, item.confidence))
                    : 0.7,
            });
        }

        console.log(
            `[llmClassifier] Claude classified ${results.size}/${articles.length} articles`
        );

    } catch (err: any) {
        clearTimeout(timer);
        const isTimeout = err?.name === "AbortError";
        console.warn(
            `[llmClassifier] Claude call failed (${isTimeout ? "timeout" : err.message})` +
            ` — falling back to keyword classifier`
        );
    }

    return results;
}

// ─── Public API ───────────────────────────────────────────────

const LLM_BATCH_SIZE = 20; // articles per Claude call

/**
 * classifyArticles()
 *
 * Classifies an array of articles using LLM first, keyword fallback second.
 *
 * @param articles  Array of { title, summary } objects
 * @returns         Array of ClassificationResult in the same order
 */
export async function classifyArticles(
    articles: Array<{ title: string; summary: string }>
): Promise<ClassificationResult[]> {
    const results: ClassificationResult[] = new Array(articles.length);

    // Build input list with stable indexes
    const inputs: ArticleInput[] = articles.map((a, i) => ({
        index: i,
        title: a.title,
        summary: a.summary,
    }));

    // Process in batches
    for (let start = 0; start < inputs.length; start += LLM_BATCH_SIZE) {
        const batch = inputs.slice(start, start + LLM_BATCH_SIZE);

        // ── Tier 1: Claude ────────────────────────────────────
        const llmResults = await classifyBatchWithLlm(batch);

        // ── Tier 2: Keyword fallback for any Claude missed ────
        for (const input of batch) {
            const llm = llmResults.get(input.index);

            if (llm && llm.confidence >= 0.5) {
                // Use LLM result
                results[input.index] = {
                    category: llm.category as AlertCategory,
                    severity: llm.severity as AlertSeverity,
                    keywords: llm.keywords,
                    reason: llm.reason,
                    confidence: llm.confidence,
                    method: "llm",
                };
            } else {
                // Fall back to keyword classifier
                const article = articles[input.index];
                const kw = classifyByKeyword(article.title, article.summary);

                if (llm && llm.confidence > 0 && llm.confidence < 0.5) {
                    // Low-confidence LLM result — blend: use keyword category/severity
                    // but keep LLM keywords + reason for richer metadata
                    results[input.index] = {
                        ...kw,
                        keywords: [...new Set([...llm.keywords, ...kw.keywords])].slice(0, 8),
                        reason: llm.reason,
                        method: "keyword",
                    };
                } else {
                    results[input.index] = kw;
                }
            }
        }
    }

    // ── Tier 3: Default for any that slipped through ──────────
    for (let i = 0; i < results.length; i++) {
        if (!results[i]) {
            results[i] = {
                category: "other",
                severity: "low",
                keywords: [],
                confidence: 0,
                method: "default",
            };
        }
    }

    return results;
}

/**
 * classifySingle()
 *
 * Convenience wrapper for classifying one article.
 * Used by ACLED event processing.
 */
export async function classifySingle(
    title: string,
    summary: string
): Promise<ClassificationResult> {
    const [result] = await classifyArticles([{ title, summary }]);
    return result;
}