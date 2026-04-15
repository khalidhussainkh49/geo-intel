import { NextResponse } from "next/server";

const cache = new Map<string, { data: unknown; expiresAt: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const placeId = searchParams.get("place_id");
    const fallbackName = searchParams.get("name"); // Useful for fallback searches

    if (!placeId || typeof placeId !== "string") {
        return NextResponse.json({ error: "place_id is required" }, { status: 400 });
    }

    const userKey = request.headers.get("X-User-Google-Key");
    const apiKey = userKey || process.env.GOOGLE_MAPS_API_KEY;

    const cachePrefix = userKey ? `user:${userKey.slice(0, 8)}:` : "";
    const cacheId = `${cachePrefix}${placeId}`;
    const cached = cache.get(cacheId);
    if (cached && Date.now() < cached.expiresAt) {
        return NextResponse.json(cached.data);
    }

    try {
        // --- 1. Identify Provider ---
        const isOsmId = placeId.startsWith("osm-");

        // --- 2. Try Google Maps (if not an OSM ID and API key exists) ---
        if (!isOsmId && apiKey) {
            const googleUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
                placeId
            )}&fields=geometry,name,types&key=${apiKey}`;

            const response = await fetch(googleUrl);
            const data = await response.json();

            if (data.status === "OK") {
                const location = data.result.geometry?.location;
                const result = {
                    lat: location.lat,
                    lon: location.lng,
                    name: data.result.name,
                    types: data.result.types || [],
                    source: "google",
                };
                cache.set(cacheId, { data: result, expiresAt: Date.now() + TTL_MS });
                return NextResponse.json(result);
            }
            console.warn("Google Details failed, attempting OSM fallback...");
        }

        // --- 3. Fallback: OpenStreetMap (Nominatim) ---
        let osmData;

        if (isOsmId) {
            // If it's a direct OSM ID from our autocomplete fallback
            const numericId = placeId.replace("osm-", "");
            const osmUrl = `https://nominatim.openstreetmap.org/lookup?osm_ids=R${numericId},W${numericId},N${numericId}&format=json`;
            const osmRes = await fetch(osmUrl, { headers: { "User-Agent": "NCS-GeoIntel/1.0 (contact@worldwideview.com)" } });
            if (!osmRes.ok) throw new Error(await osmRes.text());
            const list = await osmRes.json();
            osmData = list[0];
        } else if (fallbackName) {
            // If Google failed but we have a name, try searching OSM by name
            const osmUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fallbackName)}&format=jsonv2&limit=1`;
            const osmRes = await fetch(osmUrl, { headers: { "User-Agent": "NCS-GeoIntel/1.0 (contact@worldwideview.com)" } });
            if (!osmRes.ok) throw new Error(await osmRes.text());
            const list = await osmRes.json();
            console.log(list[0]);
            osmData = list[0];
        }

        if (osmData) {
            const result = {
                lat: parseFloat(osmData.lat),
                lon: parseFloat(osmData.lon),
                name: osmData.display_name,
                types: [osmData.type || "region"],
                source: "osm",
            };
            cache.set(cacheId, { data: result, expiresAt: Date.now() + TTL_MS });
            return NextResponse.json(result);
        }

        return NextResponse.json({ error: "Place not found in any provider" }, { status: 404 });

    } catch (error) {
        console.error("Error in Details fallback route:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}



// import { NextResponse } from "next/server";

// // Server-side cache: keyed by place_id, 24-hour TTL (place geometry is stable)
// const cache = new Map<string, { data: unknown; expiresAt: number }>();
// const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// export async function GET(request: Request) {
//     const { searchParams } = new URL(request.url);
//     const placeId = searchParams.get("place_id");

//     if (!placeId || typeof placeId !== "string") {
//         return NextResponse.json({ error: "place_id is required" }, { status: 400 });
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
//     const cacheId = `${cachePrefix}${placeId}`;
//     const cached = cache.get(cacheId);
//     if (cached && Date.now() < cached.expiresAt) {
//         return NextResponse.json(cached.data);
//     }

//     try {
//         const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(
//             placeId
//         )}&fields=geometry,name,type&key=${apiKey}`;

//         const response = await fetch(url);
//         const data = await response.json();

//         if (data.status !== "OK") {
//             console.error("Google Places Details API Error:", data);
//             return NextResponse.json({ error: "Failed to fetch place details" }, { status: 500 });
//         }

//         const location = data.result.geometry?.location;
//         if (!location) {
//             return NextResponse.json({ error: "No geometry found for place" }, { status: 404 });
//         }

//         const result = {
//             lat: location.lat,
//             lon: location.lng,
//             name: data.result.name,
//             types: data.result.types || [],
//         };
//         cache.set(cacheId, { data: result, expiresAt: Date.now() + TTL_MS });
//         return NextResponse.json(result);
//     } catch (error) {
//         console.error("Error in Places Details route:", error);
//         return NextResponse.json({ error: "Internal server error" }, { status: 500 });
//     }
// }
