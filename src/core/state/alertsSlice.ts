import type { StateCreator } from "zustand";
import type { AppStore } from "./store";

// ─── Alert Types ─────────────────────────────────────────────

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export type AlertCategory =
    | "banditry"
    | "terrorism"       // Boko Haram / ISWAP
    | "kidnapping"
    | "flooding"
    | "communal-clash"
    | "armed-robbery"
    | "military-op"
    | "protest"
    | "accident"
    | "other";

export interface GeoAlert {
    id:          string;
    title:       string;
    summary:     string;
    source:      string;       // publisher name
    url:         string;
    category:    AlertCategory;
    severity:    AlertSeverity;
    latitude:    number;
    longitude:   number;
    state:       string;       // Nigerian state name
    lga?:        string;       // Local Government Area if known
    publishedAt: Date;
    fetchedAt:   Date;
    imageUrl?:   string;
    dismissed:   boolean;
    /** true once it has been shown in the toast overlay */
    toasted:     boolean;
}

// ─── Slice Interface ──────────────────────────────────────────

export interface AlertsSlice {
    alerts:            GeoAlert[];
    unreadCount:       number;
    alertsPanelOpen:   boolean;

    addAlert:          (alert: GeoAlert) => void;
    addAlerts:         (alerts: GeoAlert[]) => void;
    dismissAlert:      (id: string) => void;
    dismissAll:        () => void;
    markToasted:       (id: string) => void;
    clearOldAlerts:    (olderThanMs: number) => void;
    toggleAlertsPanel: () => void;
    setAlertsPanelOpen:(open: boolean) => void;
}

// ─── Slice Creator ────────────────────────────────────────────

export const createAlertsSlice: StateCreator<AppStore, [], [], AlertsSlice> = (set, get) => ({
    alerts:          [],
    unreadCount:     0,
    alertsPanelOpen: false,

    addAlert: (alert) => set((state) => {
        // Deduplicate by id
        if (state.alerts.find(a => a.id === alert.id)) return state;
        const alerts = [alert, ...state.alerts].slice(0, 500); // cap at 500
        return {
            alerts,
            unreadCount: state.unreadCount + (alert.dismissed ? 0 : 1),
        };
    }),

    addAlerts: (incoming) => set((state) => {
        const existingIds = new Set(state.alerts.map(a => a.id));
        const fresh = incoming.filter(a => !existingIds.has(a.id));
        if (fresh.length === 0) return state;
        const alerts = [...fresh, ...state.alerts].slice(0, 500);
        const newUnread = fresh.filter(a => !a.dismissed).length;
        return { alerts, unreadCount: state.unreadCount + newUnread };
    }),

    dismissAlert: (id) => set((state) => ({
        alerts:      state.alerts.map(a => a.id === id ? { ...a, dismissed: true } : a),
        unreadCount: Math.max(0, state.unreadCount - 1),
    })),

    dismissAll: () => set((state) => ({
        alerts:      state.alerts.map(a => ({ ...a, dismissed: true })),
        unreadCount: 0,
    })),

    markToasted: (id) => set((state) => ({
        alerts: state.alerts.map(a => a.id === id ? { ...a, toasted: true } : a),
    })),

    clearOldAlerts: (olderThanMs) => set((state) => {
        const cutoff = Date.now() - olderThanMs;
        const alerts = state.alerts.filter(a => a.fetchedAt.getTime() > cutoff);
        const unreadCount = alerts.filter(a => !a.dismissed).length;
        return { alerts, unreadCount };
    }),

    toggleAlertsPanel: () => set((state) => ({
        alertsPanelOpen: !state.alertsPanelOpen,
    })),

    setAlertsPanelOpen: (open) => set({ alertsPanelOpen: open }),
});