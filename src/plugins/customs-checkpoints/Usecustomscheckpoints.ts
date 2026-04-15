/**
 * useCustomsCheckpoints
 *
 * Manages NCS checkpoint markers on the Cesium globe.
 * Mirrors useCustomsOffices in architecture exactly.
 *
 * Visual design differences from offices:
 *   - Checkpoints use a TRIANGLE marker shape (▲) to distinguish from
 *     the circle/square/diamond shapes used for offices
 *   - Smaller default scale — checkpoints are more numerous
 *   - Labels appear only within 500 km (offices: 2,000 km)
 *     to avoid label clutter at mid-zoom
 *   - Scanner and weighbridge checkpoints get a slightly larger marker
 *
 * Data loading: calls loadCheckpoints() which tries
 *   API → GeoJSON → built-in (same three-tier pattern as offices)
 */

import { useEffect, useRef } from "react";
import {
    BillboardCollection,
    LabelCollection,
    Cartesian3,
    Color,
    VerticalOrigin,
    HorizontalOrigin,
    NearFarScalar,
    DistanceDisplayCondition,
    LabelStyle,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";
import {
    loadCheckpoints,
    checkpointColor,
    type CustomsCheckpoint,
    type CheckpointType,
} from "./Customscheckpointsdata";
import type { GeoEntity } from "@/core/plugins/PluginTypes";

// ─── Triangle marker SVG ──────────────────────────────────────
// Checkpoints use upward-pointing triangle to distinguish from offices.
// Optional inner symbol for scanner (S) and weighbridge (W) types.

function makeCheckpointSvg(fill: string, type: CheckpointType): string {
    // Inner symbol varies by type
    let inner = "";
    if (type === "scanner-gate") {
        // Small eye shape — scanning
        inner = `<ellipse cx="16" cy="16" rx="5" ry="3" fill="none" stroke="white" stroke-width="1.5" opacity="0.9"/>
                 <circle cx="16" cy="16" r="1.5" fill="white" opacity="0.9"/>`;
    } else if (type === "weighbridge") {
        // Simple horizontal bar — scale/balance
        inner = `<rect x="11" y="15" width="10" height="2" fill="white" opacity="0.9"/>`;
    } else if (type === "border-gate") {
        // Vertical bar — barrier
        inner = `<rect x="15" y="11" width="2" height="10" fill="white" opacity="0.9"/>`;
    } else if (type === "port-gate") {
        // Small anchor-like cross
        inner = `<line x1="16" y1="11" x2="16" y2="21" stroke="white" stroke-width="1.5" opacity="0.9"/>
                 <line x1="12" y1="15" x2="20" y2="15" stroke="white" stroke-width="1.5" opacity="0.9"/>`;
    } else {
        // Default: small white circle
        inner = `<circle cx="16" cy="18" r="2.5" fill="white" opacity="0.9"/>`;
    }

    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`,
        // Triangle pointing up
        `<polygon points="16,4 30,28 2,28" fill="${fill}" stroke="white" stroke-width="1.5" opacity="0.92"/>`,
        inner,
        `</svg>`,
    ].join("");
    return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function markerForCheckpoint(type: CheckpointType): { image: string; scale: number } {
    const color = checkpointColor(type);
    const scale = type === "scanner-gate" || type === "weighbridge" || type === "border-gate" || type === "port-gate"
        ? 1.1
        : 0.85;
    return { image: makeCheckpointSvg(color, type), scale };
}

// ─── GeoEntity builder ────────────────────────────────────────

function checkpointToGeoEntity(cp: CustomsCheckpoint): GeoEntity {
    return {
        id:        `customs-checkpoint-${cp.id}`,
        pluginId:  "customs-checkpoints",
        latitude:  cp.lat,
        longitude: cp.lon,
        altitude:  0,
        timestamp: new Date(),
        label:     cp.name,
        properties: {
            name:           cp.name,
            type:           cp.type,
            zone:           cp.zone,
            state:          cp.state,
            road:           cp.road,
            direction:      cp.direction   ?? null,
            operatingHours: cp.operatingHours ?? "24/7",
            staffing:       cp.staffing    ?? "NCS Officers",
            scanner:        cp.scanner     ?? false,
            weighbridge:    cp.weighbridge ?? false,
            notes:          cp.notes       ?? null,
        },
    };
}

// ─── Primitive builder ────────────────────────────────────────

function buildCollections(
    viewer: CesiumViewer,
    checkpoints: CustomsCheckpoint[]
): { billboards: BillboardCollection; labels: LabelCollection } {
    const billboards = viewer.scene.primitives.add(new BillboardCollection());
    const labels     = viewer.scene.primitives.add(new LabelCollection());

    for (const cp of checkpoints) {
        const position         = Cartesian3.fromDegrees(cp.lon, cp.lat, 0);
        const { image, scale } = markerForCheckpoint(cp.type);
        const geoEntity        = checkpointToGeoEntity(cp);

        billboards.add({
            position,
            image,
            scale,
            verticalOrigin:           VerticalOrigin.BOTTOM,  // triangle tip touches position
            horizontalOrigin:         HorizontalOrigin.CENTER,
            id:                       { _wwvEntity: geoEntity },
            scaleByDistance:          new NearFarScalar(1e3, 1.1, 2e6, 0.5),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Show checkpoints when closer than offices — there are more of them
            distanceDisplayCondition: new DistanceDisplayCondition(0, 5_000_000),
        });

        labels.add({
            position,
            text:                     cp.name,
            font:                     "400 10px Inter, sans-serif",
            fillColor:                Color.WHITE,
            outlineColor:             Color.BLACK.withAlpha(0.7),
            outlineWidth:             2,
            style:                    LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin:           VerticalOrigin.TOP,
            horizontalOrigin:         HorizontalOrigin.CENTER,
            pixelOffset:              { x: 0, y: 6 } as any,
            id:                       { _wwvEntity: geoEntity },
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            // Labels only within 500 km — avoid clutter at mid-zoom
            distanceDisplayCondition: new DistanceDisplayCondition(0, 500_000),
            scaleByDistance:          new NearFarScalar(5e3, 1.0, 5e5, 0.5),
        });
    }

    return { billboards, labels };
}

// ─── Hook ─────────────────────────────────────────────────────

export function useCustomsCheckpoints(
    viewer: CesiumViewer | null,
    enabled: boolean
) {
    const billboardsRef = useRef<BillboardCollection | null>(null);
    const labelsRef     = useRef<LabelCollection     | null>(null);
    const loadingRef    = useRef(false);
    const builtRef      = useRef(false);

    function destroyCollections() {
        if (!viewer || viewer.isDestroyed()) return;
        try {
            if (billboardsRef.current) {
                viewer.scene.primitives.remove(billboardsRef.current);
                billboardsRef.current = null;
            }
            if (labelsRef.current) {
                viewer.scene.primitives.remove(labelsRef.current);
                labelsRef.current = null;
            }
        } catch { /* viewer partially destroyed */ }
        builtRef.current = false;
    }

    // Load + build on first enable
    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return;
        if (!enabled) return;
        if (builtRef.current) return;
        if (loadingRef.current) return;

        loadingRef.current = true;

        loadCheckpoints().then(({ checkpoints, source, count }) => {
            loadingRef.current = false;
            if (!viewer || viewer.isDestroyed()) return;

            const { billboards, labels } = buildCollections(viewer, checkpoints);
            billboardsRef.current = billboards;
            labelsRef.current     = labels;
            builtRef.current      = true;

            billboards.show = true;
            labels.show     = true;

            console.log(
                `[useCustomsCheckpoints] Rendered ${count} checkpoints` +
                ` (source: ${source})`
            );
        });

    }, [viewer, enabled]);

    // Show / hide without rebuild
    useEffect(() => {
        if (!builtRef.current) return;
        if (billboardsRef.current) billboardsRef.current.show = enabled;
        if (labelsRef.current)     labelsRef.current.show     = enabled;
    }, [enabled]);

    // Cleanup
    useEffect(() => {
        return () => destroyCollections();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewer]);
}