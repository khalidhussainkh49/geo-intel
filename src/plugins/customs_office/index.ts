/**
 * CustomsOfficesPlugin
 *
 * A toggleable layer that displays Nigeria Customs Service offices
 * on the globe — Area Commands, Sector Commands, Federal Operations
 * Units, and the NCS Headquarters in Abuja.
 *
 * Architecture mirrors BordersPlugin exactly:
 *   - The plugin class returns [] from fetch() — it carries no live data.
 *   - Actual rendering is delegated to the useCustomsOffices() hook in
 *     GlobeView, which watches layers["customs-offices"]?.enabled and
 *     adds/removes entities from the Cesium viewer directly.
 *   - The plugin exists solely so it appears in LayerPanel and can be
 *     toggled on/off like any other layer.
 *
 * To wire it up:
 *   1. Register: pluginManager.registerPlugin(new CustomsOfficesPlugin())
 *      in your AppShell bootstrap alongside the BordersPlugin.
 *   2. Import useCustomsOffices in GlobeView.tsx and call it exactly
 *      like useBorders — see integration comment below.
 */

import { Building2 } from "lucide-react";
import type {
    WorldPlugin,
    GeoEntity,
    TimeRange,
    PluginContext,
    LayerConfig,
    CesiumEntityOptions,
    FilterDefinition,
} from "@/core/plugins/PluginTypes";
import { CustomsOfficeDetail } from "./CustomsOfficeDetail";

export class CustomsOfficesPlugin implements WorldPlugin {
    id          = "customs-offices";
    name        = "Customs Offices";
    description = "NCS Area Commands, Sector Commands & HQ";
    icon        = Building2;
    category    = "infrastructure" as const;
    version     = "1.0.0";

    async initialize(_ctx: PluginContext): Promise<void> {}
    destroy(): void {}

    /**
     * Returns empty array — rendering is handled by useCustomsOffices()
     * hook directly on the Cesium viewer, same as BordersPlugin.
     */
    async fetch(_timeRange: TimeRange): Promise<GeoEntity[]> {
        return [];
    }

    /** Never poll — the office dataset is static. */
    getPollingInterval(): number {
        return 999_999_999;
    }

    getLayerConfig(): LayerConfig {
        return {
            color: "#22d3ee",
            clusterEnabled: false,
            clusterDistance: 0,
            maxEntities: 0,
        };
    }

    /** Unused — entities are rendered by the hook, not EntityRenderer. */
    renderEntity(_entity: GeoEntity): CesiumEntityOptions {
        return { type: "point" };
    }

    getDetailComponent() {
        return CustomsOfficeDetail;
    }

    getFilterDefinitions(): FilterDefinition[] {
        return [
            {
                id: "officeType",
                label: "Office Type",
                type: "select",
                propertyKey: "type",
                options: [
                    { value: "headquarters",    label: "Headquarters" },
                    { value: "area-command",    label: "Area Command" },
                    { value: "sector-command",  label: "Sector Command" },
                    { value: "fou",             label: "Federal Operations Unit" },
                ],
            },
            {
                id: "zone",
                label: "NCS Zone",
                type: "select",
                propertyKey: "zone",
                options: [
                    { value: "A", label: "Zone A (South-West)" },
                    { value: "B", label: "Zone B (North-West)" },
                    { value: "C", label: "Zone C (North Central)" },
                    { value: "D", label: "Zone D (South-East)" },
                    { value: "E", label: "Zone E (North-East)" },
                    { value: "HQ", label: "National HQ" },
                ],
            },
            {
                id: "name",
                label: "Office Name",
                type: "text",
                propertyKey: "name",
            },
        ];
    }
}