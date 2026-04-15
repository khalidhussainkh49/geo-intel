/**
 * rssParser.ts
 *
 * Lightweight RSS 2.0 / Atom / RDF parser.
 * No external dependencies — uses the Node.js built-in DOMParser
 * via the @xmldom/xmldom package which Next.js bundles in the
 * server runtime.
 *
 * Usage:
 *   const items = await fetchRss("https://punchng.com/feed/", "Punch Nigeria");
 */

export interface RssItem {
    title:       string;
    link:        string;
    description: string;
    pubDate:     Date;
    source:      string;
    imageUrl?:   string;
}

const FETCH_TIMEOUT_MS = 8_000;
const MAX_ITEMS_PER_SOURCE = 30;

// ─── XML text extraction helper ───────────────────────────────

function text(el: Element | null, tag: string): string {
    if (!el) return "";
    const found = el.getElementsByTagName(tag)[0];
    if (!found) return "";
    return (found.textContent ?? "").trim();
}

function attr(el: Element | null, tag: string, attribute: string): string {
    if (!el) return "";
    const found = el.getElementsByTagName(tag)[0];
    if (!found) return "";
    return (found.getAttribute(attribute) ?? "").trim();
}

// ─── Parse RSS 2.0 ────────────────────────────────────────────

function parseRss2(doc: Document, sourceName: string): RssItem[] {
    const items: RssItem[] = [];
    const nodes = doc.getElementsByTagName("item");

    for (let i = 0; i < Math.min(nodes.length, MAX_ITEMS_PER_SOURCE); i++) {
        const item = nodes[i];

        const title = text(item, "title") || "(no title)";
        const link  = text(item, "link") ||
                      attr(item, "guid", "") ||
                      "";

        if (!link) continue;

        const description =
            text(item, "description") ||
            text(item, "content:encoded") ||
            text(item, "summary") || "";

        const pubDateStr = text(item, "pubDate") || text(item, "dc:date");
        const pubDate    = pubDateStr ? new Date(pubDateStr) : new Date();

        // Image: try media:content, enclosure, or og:image in description
        let imageUrl: string | undefined;
        const mediaContent = item.getElementsByTagName("media:content")[0];
        const enclosure    = item.getElementsByTagName("enclosure")[0];
        if (mediaContent) {
            imageUrl = mediaContent.getAttribute("url") ?? undefined;
        } else if (enclosure) {
            const type = enclosure.getAttribute("type") ?? "";
            if (type.startsWith("image/")) {
                imageUrl = enclosure.getAttribute("url") ?? undefined;
            }
        }

        // Fallback: extract first <img src> from description HTML
        if (!imageUrl && description.includes("<img")) {
            const match = description.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (match) imageUrl = match[1];
        }

        items.push({
            title,
            link,
            description: description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
            pubDate: isNaN(pubDate.getTime()) ? new Date() : pubDate,
            source: sourceName,
            imageUrl,
        });
    }

    return items;
}

// ─── Parse Atom ───────────────────────────────────────────────

function parseAtom(doc: Document, sourceName: string): RssItem[] {
    const items: RssItem[] = [];
    const nodes = doc.getElementsByTagName("entry");

    for (let i = 0; i < Math.min(nodes.length, MAX_ITEMS_PER_SOURCE); i++) {
        const entry = nodes[i];

        const title       = text(entry, "title") || "(no title)";
        const linkEl      = entry.getElementsByTagName("link")[0];
        const link        = linkEl?.getAttribute("href") ?? text(entry, "id") ?? "";

        if (!link) continue;

        const description =
            text(entry, "content") ||
            text(entry, "summary") || "";

        const pubDateStr  = text(entry, "published") || text(entry, "updated");
        const pubDate     = pubDateStr ? new Date(pubDateStr) : new Date();

        let imageUrl: string | undefined;
        const mediaContent = entry.getElementsByTagName("media:content")[0];
        if (mediaContent) imageUrl = mediaContent.getAttribute("url") ?? undefined;

        items.push({
            title,
            link,
            description: description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
            pubDate: isNaN(pubDate.getTime()) ? new Date() : pubDate,
            source: sourceName,
            imageUrl,
        });
    }

    return items;
}

// ─── Parse RDF (RSS 1.0) ──────────────────────────────────────

function parseRdf(doc: Document, sourceName: string): RssItem[] {
    // RDF uses <item> nodes — delegate to RSS2 parser which handles them
    return parseRss2(doc, sourceName);
}

// ─── Main fetch function ──────────────────────────────────────

export async function fetchRss(url: string, sourceName: string): Promise<RssItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
                "Accept":     "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
            },
            next: { revalidate: 0 },
        });

        clearTimeout(timer);

        if (!res.ok) {
            console.warn(`[rssParser] ${sourceName}: HTTP ${res.status}`);
            return [];
        }

        const xml = await res.text();

        // Detect feed type from root element
        const rootMatch = xml.match(/<(rss|feed|rdf:RDF)/i);
        const rootTag   = rootMatch?.[1]?.toLowerCase() ?? "rss";

        // Parse using DOMParser (available in Node.js 18+ / Next.js edge/node runtime)
        let doc: Document;
        try {
            // Next.js App Router runs in Node.js — use a lightweight XML parser
            const { DOMParser } = await import("@xmldom/xmldom");
            const parser = new DOMParser();
            doc = parser.parseFromString(xml, "text/xml");
        } catch {
            // Fallback: try native DOMParser if available (edge runtime)
            if (typeof DOMParser !== "undefined") {
                doc = new DOMParser().parseFromString(xml, "text/xml");
            } else {
                console.warn(`[rssParser] ${sourceName}: No XML parser available`);
                return [];
            }
        }

        if (rootTag === "feed") return parseAtom(doc, sourceName);
        if (rootTag === "rdf:rdf") return parseRdf(doc, sourceName);
        return parseRss2(doc, sourceName);

    } catch (err: any) {
        clearTimeout(timer);
        if (err.name === "AbortError") {
            console.warn(`[rssParser] ${sourceName}: timed out after ${FETCH_TIMEOUT_MS}ms`);
        } else {
            console.warn(`[rssParser] ${sourceName}: ${err.message}`);
        }
        return [];
    }
}

// ─── ACLED JSON fetcher ───────────────────────────────────────

// export interface AcledEvent {
//     event_date: string;
//     event_type: string;
//     actor1:     string;
//     location:   string;
//     latitude:   string;
//     longitude:  string;
//     notes:      string;
// }

// Define the structure of your event for type safety
export interface AcledEvent {
    event_date: string;
    event_type: string;
    actor1: string;
    location: string;
    latitude: string;
    longitude: string;
    notes: string;
}

export async function fetchAcled(): Promise<AcledEvent[]> {
    const email = process.env.ACLED_EMAIL;
    const password = process.env.ACLED_PASSWORD; // You now need your account password

    if (!email || !password) {
        console.error("ACLED credentials missing.");
        return [];
    }

    try {
        // 1. Get the Access Token (Valid for 24 hours)
        const authRes = await fetch("https://acleddata.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                username: email,
                password: password,
                grant_type: "password",
                client_id: "acled"
            }),
        });

        if (!authRes.ok) {
            console.error("Failed to authenticate with ACLED");
            return [];
        }

        const { access_token } = await authRes.json();

        // 2. Fetch the Data using the Bearer Token
        // Note: The base URL for the read API is now https://acleddata.com/api/acled/read
        const queryParams = new URLSearchParams({
            country: "Nigeria",
            limit: "50",
            fields: "event_date|event_type|actor1|location|latitude|longitude|notes",
            _format: "json"
        });

        const dataRes = await fetch(`https://acleddata.com/api/acled/read?${queryParams}`, {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json",
                "User-Agent": "NCS-GeoIntel/2.0"
            },
            next: { revalidate: 3600 } // Optional: Cache for 1 hour
        });

        if (!dataRes.ok) return [];

        const result = await dataRes.json();
        
        // ACLED JSON responses wrap data in a "data" property
        return result.data ?? [];

    } catch (err) {
        console.warn("[AcledFetch] Error:", err);
        return [];
    }
}
// export async function fetchAcled(): Promise<AcledEvent[]> {
//     const apiKey   = process.env.ACLED_API_KEY;
//     const apiEmail = process.env.ACLED_EMAIL;

//     if (!apiKey || !apiEmail) return [];

//     const url = `https://api.acleddata.com/acled/read?` +
//         `key=${apiKey}&email=${encodeURIComponent(apiEmail)}` +
//         `&country=Nigeria&limit=50` +
//         `&fields=event_date|event_type|actor1|location|latitude|longitude|notes` +
//         `&format=json`;

//     try {
//         const res = await fetch(url, {
//             next: { revalidate: 0 },
//             headers: { "User-Agent": "NCS-GeoIntel/2.0" },
//         });
//         if (!res.ok) return [];
//         const data = await res.json();
//         return data.data ?? [];
//     } catch (err) {
//         console.warn("[rssParser] ACLED fetch failed:", err);
//         return [];
//     }
// }