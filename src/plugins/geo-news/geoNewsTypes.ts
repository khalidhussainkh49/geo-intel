/**
 * Shared types for the GeoNews pipeline.
 * Used by the API route, the plugin, and the UI components.
 */

import type { AlertCategory, AlertSeverity } from "@/core/state/alertsSlice";

// Raw article shape returned by /api/geo-news
export interface RawNewsArticle {
    id:          string;
    title:       string;
    summary:     string;
    source:      string;
    url:         string;
    imageUrl?:   string;
    publishedAt: string;   // ISO string
    latitude:    number;
    longitude:   number;
    state:       string;
    lga?:        string;
    category:    AlertCategory;
    severity:    AlertSeverity;
    keywords:    string[]; // matched keywords that triggered this article
}

// Geocode entry for Nigerian locations
export interface NigeriaLocation {
    name:      string;    // display name
    state:     string;
    lga?:      string;
    lat:       number;
    lon:       number;
    aliases?:  string[];  // alternate spellings / common names
}