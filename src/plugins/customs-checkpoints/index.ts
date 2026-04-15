/**
 * CustomsCheckpointsPlugin
 *
 * Toggleable layer showing all NCS roadside checkpoints on the globe —
 * fixed posts, mobile patrols, scanner gates, weighbridges, border gates
 * and port access gates.
 *
 * Architecture is identical to CustomsOfficesPlugin:
 *   - fetch() always returns [] — rendering is done by useCustomsCheckpoints()
 *   - The plugin exists to appear in LayerPanel and be toggled
 *   - Actual markers are Cesium billboard + label primitives
 *
 * Wire up in GlobeView.tsx (3 lines, same as offices):
 *   import { useCustomsCheckpoints } from "@/plugins/customs-checkpoints/useCustomsCheckpoints";
 *   const showCheckpoints = layers["customs-checkpoints"]?.enabled ?? false;
 *   useCustomsCheckpoints(viewerRef.current, showCheckpoints);
 *
 * Register in AppShell / bootstrap:
 *   import { CustomsCheckpointsPlugin } from "@/plugins/customs-checkpoints";
 *   await pluginManager.registerPlugin(new CustomsCheckpointsPlugin());
 */

import { ShieldCheck } from "lucide-react";
import type {
    WorldPlugin,
    GeoEntity,
    TimeRange,
    PluginContext,
    LayerConfig,
    CesiumEntityOptions,
    FilterDefinition,
} from "@/core/plugins/PluginTypes";
import { CustomsCheckpointDetail } from "./CustomsCheckpointDetail";

export class CustomsCheckpointsPlugin implements WorldPlugin {
    id          = "customs-checkpoints";
    name        = "Customs Checkpoints";
    description = "Fixed posts, scanner gates, weighbridges & border gates";
    icon        = ShieldCheck;
    category    = "infrastructure" as const;
    version     = "1.0.0";

    async initialize(_ctx: PluginContext): Promise<void> {}
    destroy(): void {}

    async fetch(_timeRange: TimeRange): Promise<GeoEntity[]> {
        return [];
    }

    getPollingInterval(): number {
        return 999_999_999; // static dataset — never poll
    }

    getLayerConfig(): LayerConfig {
        return {
            color: "#22d3ee",
            clusterEnabled: true,
            clusterDistance: 40,
            maxEntities: 0,
        };
    }

    renderEntity(_entity: GeoEntity): CesiumEntityOptions {
        return { type: "point" }; // unused — hook handles rendering
    }

    getDetailComponent() {
        return CustomsCheckpointDetail;
    }

    getFilterDefinitions(): FilterDefinition[] {
        return [
            {
                id: "checkpointType",
                label: "Checkpoint Type",
                type: "select",
                propertyKey: "type",
                options: [
                    { value: "fixed",        label: "Fixed Post" },
                    { value: "mobile",       label: "Mobile / Patrol" },
                    { value: "scanner-gate", label: "Scanner Gate" },
                    { value: "weighbridge",  label: "Weighbridge" },
                    { value: "border-gate",  label: "Border Gate" },
                    { value: "port-gate",    label: "Port Gate" },
                ],
            },
            {
                id: "zone",
                label: "NCS Zone",
                type: "select",
                propertyKey: "zone",
                options: [
                    { value: "A", label: "Zone A — South-West" },
                    { value: "B", label: "Zone B — North-West" },
                    { value: "C", label: "Zone C — North Central" },
                    { value: "D", label: "Zone D — South-East" },
                    { value: "E", label: "Zone E — North-East" },
                ],
            },
            {
                id: "state",
                label: "State",
                type: "text",
                propertyKey: "state",
            },
            {
                id: "road",
                label: "Road",
                type: "text",
                propertyKey: "road",
            },
            {
                id: "scanner",
                label: "Has Scanner",
                type: "boolean",
                propertyKey: "scanner",
            },
            {
                id: "weighbridge",
                label: "Has Weighbridge",
                type: "boolean",
                propertyKey: "weighbridge",
            },
        ];
    }
}