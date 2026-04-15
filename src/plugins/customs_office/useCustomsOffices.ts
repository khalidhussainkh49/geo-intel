/**
 * useCustomsOffices
 *
 * Manages NCS office markers on the Cesium globe.
 * Data is loaded via loadOffices() which tries API → GeoJSON → built-in.
 *
 * Behaviour:
 *   - On first enable: calls loadOffices(), builds BillboardCollection +
 *     LabelCollection, logs which data source was used.
 *   - Toggle off/on after first load: just flips collection.show — no refetch.
 *   - If NEXT_PUBLIC_CUSTOMS_OFFICES_API_URL or _GEOJSON_URL env vars change
 *     between renders (e.g. during dev HMR), set resetKey to a new value to
 *     force a full reload. In production this never matters.
 *   - Cleanup: removes both collections on unmount or viewer change.
 *
 * Integration (no change from v1 — same 3 lines in GlobeView.tsx):
 *
 *   import { useCustomsOffices } from "@/plugins/customs-offices/useCustomsOffices";
 *   const showOffices = layers["customs-offices"]?.enabled ?? false;
 *   useCustomsOffices(viewerRef.current, showOffices);
 */

import { useEffect, useRef, useState } from "react";
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
    loadOffices,
    officeColor,
    type CustomsOffice,
    type OfficeType,
} from "./customsOfficesData";
import type { GeoEntity } from "@/core/plugins/PluginTypes";

// ─── Marker SVG helpers ───────────────────────────────────────
// Inline SVG data-URIs — no external image files needed.

function makeMarkerSvg(fill: string, shape: "circle" | "square" | "diamond"): string {
    let inner: string;
    if (shape === "square") {
        inner = `<rect x="11" y="11" width="10" height="10" fill="white" opacity="0.9"/>`;
    } else if (shape === "diamond") {
        inner = `<polygon points="16,10 22,16 16,22 10,16" fill="white" opacity="0.9"/>`;
    } else {
        inner = `<circle cx="16" cy="16" r="5" fill="white" opacity="0.9"/>`;
    }
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">`,
        `<circle cx="16" cy="16" r="14" fill="${fill}" stroke="white" stroke-width="1.5" opacity="0.92"/>`,
        inner,
        `</svg>`,
    ].join("");
    return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function markerForType(type: OfficeType): { image: string; scale: number } {
    const color = officeColor(type);
    switch (type) {
        case "headquarters":
            return { image: makeMarkerSvg(color, "diamond"), scale: 1.4 };
        case "area-command":
        case "port-command":
        case "airport-command":
            return { image: makeMarkerSvg(color, "square"), scale: 1.1 };
        case "fou":
            return { image: makeMarkerSvg(color, "circle"), scale: 1.2 };
        default:
            return { image: makeMarkerSvg(color, "circle"), scale: 0.85 };
    }
}

// ─── GeoEntity builder ────────────────────────────────────────
// Attaches to each Cesium primitive as `id._wwvEntity` so the existing
// InteractionHandler pick pipeline opens the Intel panel automatically.

function officeToGeoEntity(office: CustomsOffice): GeoEntity {
    return {
        id:        `customs-office-${office.id}`,
        pluginId:  "customs-offices",
        latitude:  office.lat,
        longitude: office.lon,
        altitude:  0,
        timestamp: new Date(),
        label:     office.name,
        properties: {
            name:    office.name,
            type:    office.type,
            zone:    office.zone,
            state:   office.state,
            address: office.address,
            phone:   office.phone  ?? null,
            email:   office.email  ?? null,
        },
    };
}

// ─── Primitive builder ────────────────────────────────────────

function buildCollections(
    viewer: CesiumViewer,
    offices: CustomsOffice[]
): { billboards: BillboardCollection; labels: LabelCollection } {
    const billboards = viewer.scene.primitives.add(new BillboardCollection());
    const labels     = viewer.scene.primitives.add(new LabelCollection());

    for (const office of offices) {
        const position         = Cartesian3.fromDegrees(office.lon, office.lat, 0);
        const { image, scale } = markerForType(office.type);
        const geoEntity        = officeToGeoEntity(office);

        billboards.add({
            position,
            image,
            scale,
            verticalOrigin:           VerticalOrigin.CENTER,
            horizontalOrigin:         HorizontalOrigin.CENTER,
            id:                       { _wwvEntity: geoEntity },
            scaleByDistance:          new NearFarScalar(1e3, 1.2, 3e6, 0.6),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 8_000_000),
        });

        labels.add({
            position,
            text:                     office.name,
            font:                     "500 11px Inter, sans-serif",
            fillColor:                Color.WHITE,
            outlineColor:             Color.BLACK.withAlpha(0.75),
            outlineWidth:             2,
            style:                    LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin:           VerticalOrigin.TOP,
            horizontalOrigin:         HorizontalOrigin.CENTER,
            pixelOffset:              { x: 0, y: 14 } as any,
            id:                       { _wwvEntity: geoEntity },
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 2_000_000),
            scaleByDistance:          new NearFarScalar(5e4, 1.1, 2e6, 0.5),
        });
    }

    return { billboards, labels };
}

// ─── Hook ─────────────────────────────────────────────────────

export function useCustomsOffices(
    viewer: CesiumViewer | null,
    enabled: boolean
) {
    const billboardsRef  = useRef<BillboardCollection | null>(null);
    const labelsRef      = useRef<LabelCollection     | null>(null);
    const loadingRef     = useRef(false);
    const builtRef       = useRef(false);

    // ── Destroy helper (called on cleanup and before rebuild) ──
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
        } catch {
            // Viewer partially destroyed — safe to ignore
        }
        builtRef.current = false;
    }

    // ── Load data + build primitives on first enable ───────────
    useEffect(() => {
        if (!viewer || viewer.isDestroyed()) return;
        if (!enabled) return;
        if (builtRef.current) return;  // already built this session
        if (loadingRef.current) return; // fetch already in flight

        loadingRef.current = true;

        loadOffices().then(({ offices, source, count }) => {
            loadingRef.current = false;

            // Viewer may have been destroyed while we were fetching
            if (!viewer || viewer.isDestroyed()) return;

            const { billboards, labels } = buildCollections(viewer, offices);
            billboardsRef.current = billboards;
            labelsRef.current     = labels;
            builtRef.current      = true;

            // Start visible since enabled is true
            billboards.show = true;
            labels.show     = true;

            console.log(
                `[useCustomsOffices] Rendered ${count} offices` +
                ` (source: ${source})`
            );
        });

    }, [viewer, enabled]);

    // ── Show / hide on toggle — no rebuild ────────────────────
    useEffect(() => {
        if (!builtRef.current) return;
        if (billboardsRef.current) billboardsRef.current.show = enabled;
        if (labelsRef.current)     labelsRef.current.show     = enabled;
    }, [enabled]);

    // ── Cleanup on unmount or viewer change ───────────────────
    useEffect(() => {
        return () => destroyCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewer]);
}