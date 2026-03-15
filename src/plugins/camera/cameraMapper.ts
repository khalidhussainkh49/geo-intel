import type { GeoEntity } from "@/core/plugins/PluginTypes";

/** Default height above ground for mounted traffic cameras (metres). */
const DEFAULT_CAMERA_ALT = 8;

/** Map a raw URL/File camera object to a GeoEntity. */
export function mapRawCamera(cam: any, index: number, prefix: string): GeoEntity {
    return {
        id: `camera-${prefix}-${index}`,
        pluginId: "camera",
        latitude: cam.latitude,
        longitude: cam.longitude,
        altitude: cam.altitude ?? cam.elevation ?? DEFAULT_CAMERA_ALT,
        timestamp: new Date(),
        label: cam.city || cam.country || "Unknown Camera",
        properties: { ...cam },
    };
}
