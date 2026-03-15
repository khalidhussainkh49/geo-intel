import { createClient } from "@supabase/supabase-js";

export async function getLatestFromSupabase() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) return null;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const withTimeout = async <T>(promiseLike: PromiseLike<T>, ms = 10000): Promise<T> => {
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<T>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`Supabase request timed out after ${ms / 1000}s`)), ms);
        });

        try {
            return await Promise.race([
                Promise.resolve(promiseLike),
                timeoutPromise
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    };

    try {
        console.log("[Aviation Polling] Fetching latest timestamp from Supabase...");
        const { data: latestTS, error: tsError } = await withTimeout(
            supabase.from("aviation_history").select("timestamp").order("timestamp", { ascending: false }).limit(1)
        ) as { data: any, error: any };

        if (tsError) {
            console.error("[Aviation Polling] Supabase timestamp fetch error:", tsError.message);
            return null;
        }
        if (!latestTS || latestTS.length === 0) {
            console.log("[Aviation Polling] No historical data found in Supabase.");
            return null;
        }

        const timestamp = latestTS[0].timestamp;
        console.log(`[Aviation Polling] Found latest data from ${timestamp}. Fetching record batch...`);

        const { data: records, error: recError } = await withTimeout(
            supabase.from("aviation_history").select("*").eq("timestamp", timestamp)
        ) as { data: any, error: any };

        if (recError) {
            console.error("[Aviation Polling] Supabase records batch fetch error:", recError.message);
            return null;
        }
        if (!records) return null;

        console.log(`[Aviation Polling] Success! Retrieved ${records.length} historical states.`);

        const states = records.map((r: any) => [
            r.icao24, r.callsign, null, Math.floor(new Date(r.timestamp).getTime() / 1000), Math.floor(new Date(r.timestamp).getTime() / 1000), r.longitude, r.latitude, r.altitude, r.altitude === null || r.altitude <= 0, r.speed, r.heading, null, null, r.altitude, null, false, 0
        ]);

        return {
            states,
            time: Math.floor(new Date(timestamp).getTime() / 1000),
            _source: "supabase",
            _isFallback: true
        };
    } catch (e) {
        console.error("[Aviation Polling] Fallback error:", e);
        return null;
    }
}

export async function recordToSupabase(states: any[], timeSecs: number) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) return;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const timestamp = new Date(timeSecs * 1000).toISOString();

    const records = states
        .filter(s => s[5] !== null && s[6] !== null)
        .map(s => ({
            timestamp,
            icao24: s[0],
            callsign: s[1]?.trim() || null,
            longitude: s[5],
            latitude: s[6],
            altitude: s[7],
            speed: s[9],
            heading: s[10],
        }));

    if (records.length === 0) return;

    const CHUNK_SIZE = 500;
    let successCount = 0;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const chunk = records.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from("aviation_history").insert(chunk);

        if (error) {
            const errorMsg = error.message;
            if (errorMsg && errorMsg.includes("<!DOCTYPE html>")) {
                console.error(`[Aviation Polling] Failed to insert chunk: Supabase Host returned HTML error (likely Cloudflare 522/502). Instance might be paused.`);
                break; // Stop further chunk inserts if host is down
            } else {
                console.error(`[Aviation Polling] Failed to insert chunk:`, error.message);
            }
        } else {
            successCount += chunk.length;
        }
    }

    console.log(`[Aviation Polling] Recorded ${successCount}/${records.length} states to Supabase.`);
}
