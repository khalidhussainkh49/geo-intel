/**
 * gdeltFallback.ts
 *
 * Used when Supabase is not configured or the DB is empty.
 * Queries GDELT (free, no API key) directly and returns articles.
 * This is the same logic that was in the original api-route.ts.
 */

import { geocodeText }    from "./nigeriaLocations";
import { classifyArticle, isNigeriaRelevant, makeId } from "./newsPipeline";
import type { RawNewsArticle } from "./geoNewsTypes";

export async function fetchGdeltFallback(): Promise<RawNewsArticle[]> {
    try {
        const query = encodeURIComponent('(bandit OR "boko haram" OR kidnap OR flood OR attack OR killed OR explosion) sourcelang:english (sourcecountry:NI OR Nigeria OR Nigerian)');
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=75&format=json&timespan=1440`;

        console.log("Fetching from GDELT:", url);

        const res = await fetch(url, {
            cache: 'no-store', // Replacement for next: { revalidate: 0 } if not in Next.js
            headers: { "User-Agent": "Mozilla/5.0" }, // Sometimes custom UAs are flagged
        });

        if (!res.ok) {
            console.error(`GDELT API Error: ${res.status} ${res.statusText}`);
            return [];
        }

        const data = await res.json();
        
        // Check if GDELT returned an empty object or an error message
        if (!data.articles) {
            console.warn("GDELT returned no articles. Check query syntax.");
            return [];
        }

        const articles: RawNewsArticle[] = [];

        for (const item of data.articles) {
            // Log one item to see the structure if it's failing
            // console.log("Processing item:", item.url);

            const title = (item.title ?? "").trim();
            if (!isNigeriaRelevant(title)) continue;

            const location = geocodeText(title);
            if (!location) continue;

            const { category, severity, keywords } = classifyArticle(title, "");

            // Robust date handling
            let isoDate = new Date().toISOString();
            if (item.seendate) {
                isoDate = item.seendate.replace(
                    /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
                    "$1-$2-$3T$4:$5:$6Z"
                );
            }

            articles.push({
                id: makeId(item.url),
                title,
                summary: "",
                source: item.domain ?? "GDELT",
                url: item.url,
                publishedAt: isoDate,
                latitude: location.lat,
                longitude: location.lon,
                state: location.state,
                lga: location.lga,
                category,
                severity,
                keywords,
            });
        }

        console.log(`Successfully processed ${articles.length} articles.`);
        return articles;
    } catch (err) {
        console.error("[gdeltFallback] Critical Failure:", err);
        return [];
    }
}

// export async function fetchGdeltFallback(): Promise<RawNewsArticle[]> {
//     try {
//         const query = encodeURIComponent(
//             '(bandit OR "boko haram" OR kidnap OR flood OR attack OR killed OR explosion) ' +
//             'sourcelang:english ' +
//             '(sourcecountry:NI OR Nigeria OR Nigerian)'
//         );
//         const url =
//             `https://api.gdeltproject.org/api/v2/doc/doc` +
//             `?query=${query}&mode=artlist&maxrecords=75&format=json&timespan=1440`;

//         const res = await fetch(url, {
//             next: { revalidate: 0 },
//             headers: { "User-Agent": "NCS-GeoIntel/2.0" },
//         });

//         if (!res.ok) return [];

//         const data  = await res.json();
//         const items = data.articles ?? [];
//         const articles: RawNewsArticle[] = [];

//         for (const item of items) {
//             const title   = (item.title ?? "").trim();
//             const rawDate = item.seendate ?? "";

//             const text = `${title}`;
//             if (!isNigeriaRelevant(text)) continue;

//             const location = geocodeText(text);
//             if (!location) continue;

//             const { category, severity, keywords } = classifyArticle(title, "");

//             const isoDate = rawDate
//                 ? rawDate.replace(
//                     /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/,
//                     "$1-$2-$3T$4:$5:$6Z"
//                 )
//                 : new Date().toISOString();

//             articles.push({
//                 id:          makeId(item.url),
//                 title,
//                 summary:     "",
//                 source:      item.domain ?? "GDELT",
//                 url:         item.url,
//                 publishedAt: isoDate,
//                 latitude:    location.lat,
//                 longitude:   location.lon,
//                 state:       location.state,
//                 lga:         location.lga,
//                 category,
//                 severity,
//                 keywords,
//             });
//         }

//         return articles;
//     } catch (err) {
//         console.warn("[gdeltFallback] failed:", err);
//         return [];
//     }
// }