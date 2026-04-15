import { NextResponse } from "next/server";

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const TTL_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const input = searchParams.get("input");

    if (!input || typeof input !== "string") {
        return NextResponse.json({ error: "Input is required" }, { status: 400 });
    }

    const userKey = request.headers.get("X-User-Google-Key");
    const apiKey = userKey || process.env.GOOGLE_MAPS_API_KEY;

    const cachePrefix = userKey ? `user:${userKey.slice(0, 8)}:` : "";
    const cacheKey = `${cachePrefix}${input.toLowerCase().trim()}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
        return NextResponse.json(cached.data);
    }

    try {
        // --- 1. Try Google Maps First ---
        if (apiKey) {
            const googleUrl = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
                input
            )}&types=(regions)&key=${apiKey}`;

            const googleRes = await fetch(googleUrl);
            const googleData = await googleRes.json();

            if (googleData.status === "OK" || googleData.status === "ZERO_RESULTS") {
                const predictions = googleData.predictions.map((p: any) => ({
                    description: p.description,
                    placeId: p.place_id,
                    mainText: p.structured_formatting?.main_text || p.description,
                    secondaryText: p.structured_formatting?.secondary_text || "",
                    types: p.types,
                    source: "google"
                }));

                const result = { predictions };
                cache.set(cacheKey, { data: result, expiresAt: Date.now() + TTL_MS });
                return NextResponse.json(result);
            }

            console.warn("Google API returned non-OK status, falling back to OpenStreetMap...");
        }

        // --- 2. Fallback: OpenStreetMap (Nominatim) ---
        // Note: Nominatim is for "search", not "autocomplete", but works similarly for search inputs.
        const osmUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(input)}&format=json&addressdetails=1&limit=5`;

        const osmRes = await fetch(osmUrl, {
            headers: {
                "User-Agent": "NCS-GeoIntel/1.0 (contact@worldwideview.com)" // Required by OSM policy
            }
        });

        if (!osmRes.ok) {
            const text = await osmRes.text();
            console.error("OSM API responded with error:", text);
            throw new Error(`OSM API error: ${osmRes.status}`);
        }

        const osmData = await osmRes.json();

        const predictions = osmData.map((item: any) => ({
            description: item.display_name,
            placeId: `osm-${item.place_id}`, // Prefixing to avoid ID collisions
            mainText: item.name || item.display_name.split(',')[0],
            secondaryText: item.display_name.split(',').slice(1).join(',').trim(),
            types: [item.type || "region"],
            source: "osm"
        }));

        const result = { predictions };
        cache.set(cacheKey, { data: result, expiresAt: Date.now() + TTL_MS });
        return NextResponse.json(result);

    } catch (error) {
        console.error("Error in Places Route (both providers failed):", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}



// import { NextResponse } from "next/server";

// // Server-side cache: keyed by normalised input, 1-hour TTL
// const cache = new Map<string, { data: unknown; expiresAt: number }>();
// const TTL_MS = 60 * 60 * 1000; // 1 hour

// export async function GET(request: Request) {
//     const { searchParams } = new URL(request.url);
//     const input = searchParams.get("input");

//     if (!input || typeof input !== "string") {
//         return NextResponse.json({ error: "Input is required" }, { status: 400 });
//     }

//     // Use user-provided key if present in header, otherwise fall back to .env
//     const userKey = request.headers.get("X-User-Google-Key");
//     const apiKey = userKey || process.env.GOOGLE_MAPS_API_KEY;
//     if (!apiKey) {
//         console.error("GOOGLE_MAPS_API_KEY is not defined and no user key provided");
//         return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
//     }

//     // Separate cache entries for user-provided keys vs default
//     const cachePrefix = userKey ? `user:${userKey.slice(0, 8)}:` : "";
//     const cacheKey = `${cachePrefix}${input.toLowerCase().trim()}`;
//     const cached = cache.get(cacheKey);
//     if (cached && Date.now() < cached.expiresAt) {
//         return NextResponse.json(cached.data);
//     }

//     try {
//         // Types parameter to restrict to cities and regions
//         const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
//             input
//         )}&types=(regions)&key=${apiKey}`;

//         const response = await fetch(url);
//         const data = await response.json();

//         if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
//             console.error("Google Places API Error:", data);
//             return NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 });
//         }

//         const predictions = data.predictions.map((p: any) => ({
//             description: p.description,
//             placeId: p.place_id,
//             mainText: p.structured_formatting?.main_text || p.description,
//             secondaryText: p.structured_formatting?.secondary_text || "",
//             types: p.types,
//         }));

//         const result = { predictions };
//         cache.set(cacheKey, { data: result, expiresAt: Date.now() + TTL_MS });
//         return NextResponse.json(result);
//     } catch (error) {
//         console.error("Error in Places Autocomplete route:", error);
//         return NextResponse.json({ error: "Internal server error" }, { status: 500 });
//     }
// }
