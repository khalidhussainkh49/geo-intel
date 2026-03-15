import type { GeoEntity } from "@/core/plugins/PluginTypes";

/** Parse a single raw Insecam camera object into a GeoEntity. */
export function parseInsecamCamera(cam: any, index: number): GeoEntity {
    return {
        id: `insecam-${cam.id || index}`,
        pluginId: "camera",
        latitude: parseFloat(cam.loclat),
        longitude: parseFloat(cam.loclon),
        timestamp: new Date(),
        label: cam.city || cam.country || "Insecam Camera",
        properties: {
            ...cam,
            stream: cam.image,
            preview_url: cam.image,
            categories: cam.manufacturer ? [cam.manufacturer] : [],
        },
    };
}

/**
 * Consumes the NDJSON stream from `/api/camera/insecam` and calls
 * `onBatch` for every batch of cameras received.
 * Returns a promise that resolves when the stream is fully consumed.
 */
export async function streamInsecamCameras(
    category: string,
    limit: number,
    onBatch: (entities: GeoEntity[]) => void,
    signal?: AbortSignal,
): Promise<void> {
    const res = await fetch(
        `/api/camera/insecam?category=${category}&limit=${limit}`,
        { signal },
    );
    if (!res.ok || !res.body) {
        throw new Error("Failed to connect to Insecam stream");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let globalIndex = 0;

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (potentially incomplete) line in the buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const parsed = JSON.parse(line);
                if (parsed.cameras && Array.isArray(parsed.cameras)) {
                    const entities = parsed.cameras.map((cam: any) =>
                        parseInsecamCamera(cam, globalIndex++)
                    );
                    onBatch(entities);
                }
            } catch {
                // Malformed line — skip
            }
        }
    }
}
