import { NextRequest } from "next/server";
import * as insecam from "insecam-api";
import * as cheerio from "cheerio";

const encoder = new TextEncoder();
const MAX_CONCURRENT = 10;

/** Scrape camera IDs from a page */
async function scrapePageIds(category: string, page: number): Promise<string[]> {
    const url = `http://www.insecam.org/en/by${category}/?page=${page}`;

    const res = await fetch(url, {
        headers: { "User-Agent": "WorldWideView/1.0" },
        cache: "no-store",
    });

    const text = await res.text();
    const $ = cheerio.load(text);

    const ids: string[] = [];
    $(".thumbnail-item__wrap").each(function () {
        const href = $(this).attr("href");
        if (href) ids.push(href.slice(9, -1));
    });

    return ids;
}

/** Fetch camera details safely */
async function fetchCamera(id: string) {
    try {
        return await insecam.camera(id);
    } catch {
        return null;
    }
}

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const category = searchParams.get("category") || "rating";
    const limit = Math.min(
        Math.max(parseInt(searchParams.get("limit") || "90", 10), 6),
        600
    );

    const pagesToFetch = Math.ceil(limit / 6);

    const stream = new ReadableStream({
        async start(controller) {
            const abortSignal = req.signal;

            try {
                // 1. Scrape IDs
                const pagePromises = Array.from({ length: pagesToFetch }, (_, i) =>
                    scrapePageIds(category, i + 1).catch(() => [])
                );

                const pageResults = await Promise.all(pagePromises);
                const cameraIds = pageResults.flat().slice(0, limit);

                if (!cameraIds.length) {
                    controller.enqueue(
                        encoder.encode(JSON.stringify({ error: "No cameras found" }) + "\n")
                    );
                    controller.close();
                    return;
                }

                // 2. Stream progressively (true streaming)
                let active: Promise<void>[] = [];

                for (const id of cameraIds) {
                    if (abortSignal.aborted) {
                        controller.close();
                        return;
                    }

                    const task = (async () => {
                        const cam = await fetchCamera(id);
                        if (!cam) return;

                        controller.enqueue(
                            encoder.encode(JSON.stringify({ cameras: [cam] }) + "\n")
                        );
                    })();

                    active.push(task);

                    // Control concurrency
                    if (active.length >= MAX_CONCURRENT) {
                        await Promise.race(active);
                        active = active.filter(p => !p.then); // clean resolved
                    }
                }

                await Promise.all(active);
                controller.close();

            } catch (err: any) {
                console.error("[Insecam Proxy] Stream error:", err);

                controller.enqueue(
                    encoder.encode(JSON.stringify({ error: err.message }) + "\n")
                );
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
        },
    });
}


// import { NextRequest } from "next/server";
// import * as insecam from "insecam-api";
// import * as cheerio from "cheerio";

// /** Scrape a single page of Insecam and return camera IDs. */
// async function scrapePageIds(category: string, page: number): Promise<string[]> {
//     const url = `http://www.insecam.org/en/by${category}/?page=${page}`;
//     const res = await fetch(url, { headers: { "User-Agent": "WorldWideView/1.0" } });
//     const text = await res.text();
//     const $ = cheerio.load(text);
//     const ids: string[] = [];
//     $(".thumbnail-item__wrap").each(function () {
//         const href = $(this).attr("href");
//         if (href) ids.push(href.slice(9, -1));
//     });
//     return ids;
// }

// /** Fetch camera details for a batch of IDs, returning non-null results. */
// async function fetchCameraBatch(ids: string[]): Promise<any[]> {
//     const results = await Promise.all(
//         ids.map(async (id) => {
//             try { return await insecam.camera(id); }
//             catch { return null; }
//         })
//     );
//     return results.filter(Boolean);
// }

// const MAX_CONCURRENT = 10;

// export async function GET(req: NextRequest) {
//     const { searchParams } = new URL(req.url);
//     const category = searchParams.get("category") || "rating";
//     const limitParam = searchParams.get("limit");
//     const limit = limitParam ? parseInt(limitParam, 10) : 90;
//     const limitSafe = isNaN(limit) || limit < 6 ? 90 : Math.min(limit, 600);
//     const pagesToFetch = Math.ceil(limitSafe / 6);

//     const stream = new ReadableStream({
//         async start(controller) {
//             try {
//                 // 1. Scrape all pages concurrently to collect camera IDs
//                 const pagePromises = Array.from({ length: pagesToFetch }, (_, i) =>
//                     scrapePageIds(category, i + 1).catch(() => [] as string[])
//                 );
//                 const pageResults = await Promise.all(pagePromises);
//                 const cameraIds = pageResults.flat().slice(0, limitSafe);

//                 if (cameraIds.length === 0) {
//                     controller.enqueue(new TextEncoder().encode(
//                         JSON.stringify({ error: "No cameras found" }) + "\n"
//                     ));
//                     controller.close();
//                     return;
//                 }

//                 // 2. Fetch details in batches; stream each batch as NDJSON
//                 for (let i = 0; i < cameraIds.length; i += MAX_CONCURRENT) {
//                     const batch = cameraIds.slice(i, i + MAX_CONCURRENT);
//                     const cameras = await fetchCameraBatch(batch);
//                     if (cameras.length > 0) {
//                         const line = JSON.stringify({ cameras }) + "\n";
//                         controller.enqueue(new TextEncoder().encode(line));
//                     }
//                 }

//                 controller.close();
//             } catch (err: any) {
//                 console.error("[Insecam Proxy] Stream error:", err);
//                 try {
//                     controller.enqueue(new TextEncoder().encode(
//                         JSON.stringify({ error: err.message }) + "\n"
//                     ));
//                 } catch { /* controller may already be closed */ }
//                 controller.close();
//             }
//         },
//     });

//     return new Response(stream, {
//         headers: {
//             "Content-Type": "application/x-ndjson",
//             "Transfer-Encoding": "chunked",
//             "Cache-Control": "no-cache",
//         },
//     });
// }
