"use client";

/**
 * TimelineSync.ts
 *
 * Added vs original:
 *   A useEffect that watches `timeWindow`. When it changes (user presses
 *   1H / 6H / 24H / 48H / 7D), it calls pluginManager.updateTimeRange()
 *   which calls fetch(newTimeRange) on every enabled plugin.
 *
 *   GeoNewsPlugin.fetch() re-filters its in-memory _allArticles array
 *   by the new timeRange and emits the filtered entities — no network
 *   request needed, update is instant.
 *
 *   All other behaviour is unchanged from the original.
 */

import { useEffect, useRef } from "react";
import { useStore }          from "@/core/state/store";
import { pluginManager }     from "@/core/plugins/PluginManager";
import { dataBus }           from "@/core/data/DataBus";

export function TimelineSync() {
    const currentTime    = useStore((s) => s.currentTime);
    const timeRange      = useStore((s) => s.timeRange);
    const timeWindow     = useStore((s) => s.timeWindow);
    const isPlaying      = useStore((s) => s.isPlaying);
    const setCurrentTime = useStore((s) => s.setCurrentTime);
    const setPlaying     = useStore((s) => s.setPlaying);
    const isPlaybackMode = useStore((s) => s.isPlaybackMode);
    const setTimelineAvailability = useStore((s) => s.setTimelineAvailability);

    const lastUpdateRef    = useRef(Date.now());
    const lastFetchTimeRef = useRef(currentTime.getTime());

    // ── Time window change → re-filter all enabled plugins ────────
    // Keyed on timeWindow string (not timeRange object) to avoid
    // spurious triggers from Date object re-creation on every render.
    const mountedRef = useRef(false);
    useEffect(() => {
        // Skip initial mount — PollingManager already fires an immediate
        // fetch when the plugin is enabled, so no double-fetch needed.
        if (!mountedRef.current) {
            mountedRef.current = true;
            return;
        }

        // Grab the latest timeRange from the store (not the stale closure
        // value) so we always pass the correct Date objects.
        const currentTimeRange = useStore.getState().timeRange;

        console.log(`[TimelineSync] timeWindow changed to "${timeWindow}" — re-filtering plugins`);

        dataBus.emit("timeRangeChanged", { timeRange: currentTimeRange });

        pluginManager.updateTimeRange(currentTimeRange).catch((err) => {
            console.error("[TimelineSync] updateTimeRange error:", err);
        });

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeWindow]); // only re-run when the window string changes

    // ── Playback engine ───────────────────────────────────────────
    useEffect(() => {
        if (!isPlaying) return;

        let rafId: number;
        lastUpdateRef.current = Date.now();

        const tick = () => {
            const now      = Date.now();
            const deltaMs  = now - lastUpdateRef.current;
            lastUpdateRef.current = now;

            const state       = useStore.getState();
            const addedTimeMs = deltaMs * state.playbackSpeed;
            const newTime     = new Date(state.currentTime.getTime() + addedTimeMs);

            if (newTime.getTime() >= state.timeRange.end.getTime()) {
                state.setCurrentTime(state.timeRange.end);
                state.setPlaying(false);
            } else {
                state.setCurrentTime(newTime);
            }

            rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [isPlaying]);

    // ── DataBus → pluginManager (existing) ───────────────────────
    useEffect(() => {
        const unsub = dataBus.on("timeRangeChanged", ({ timeRange }) => {
            pluginManager.updateTimeRange(timeRange);
        });
        return unsub;
    }, []);

    // ── Timeline availability (existing) ─────────────────────────
    useEffect(() => {
        if (!isPlaybackMode) return;

        const fetchAvailability = (pluginId: string) => {
            const plugin = pluginManager.getPlugin(pluginId)?.plugin;
            if (!plugin) return;
            const config = plugin.getServerConfig?.();
            if (config?.availabilityEnabled && config.apiBasePath) {
                fetch(`${config.apiBasePath}/availability`)
                    .then((r) => r.json())
                    .then((data) => {
                        if (data.availability) {
                            setTimelineAvailability(pluginId, data.availability);
                        }
                    })
                    .catch((err) =>
                        console.error(`[TimelineSync] Availability error for ${pluginId}`, err)
                    );
            }
        };

        const active = pluginManager.getEnabledPlugins();
        for (const { plugin } of active) fetchAvailability(plugin.id);

        const unsub = dataBus.on("layerToggled", ({ pluginId, enabled }) => {
            if (enabled) fetchAvailability(pluginId);
            else setTimelineAvailability(pluginId, []);
        });

        return unsub;
    }, [isPlaybackMode, setTimelineAvailability]);

    // ── Playback scrubber fetch (existing) ───────────────────────
    useEffect(() => {
        if (!isPlaybackMode) return;

        const now = currentTime.getTime();
        if (Math.abs(now - lastFetchTimeRef.current) > 15000) {
            lastFetchTimeRef.current = now;
            pluginManager.updateTimeRange(timeRange);
        }
    }, [currentTime, isPlaybackMode, timeRange]);

    return null;
}




// "use client";

// /**
//  * TimelineSync.ts
//  *
//  * Change from original:
//  *   Added a useEffect that watches `timeRange` in normal (non-playback)
//  *   mode and calls pluginManager.updateTimeRange() whenever the user
//  *   presses a time window button (1h, 6h, 24h, 48h, 7d).
//  *
//  *   This causes all enabled plugins — including GeoNewsPlugin — to
//  *   re-fetch with the new timeRange immediately. The GeoNewsPlugin
//  *   translates timeRange → ?hours=N on its /api/geo-news call, so
//  *   the DB query automatically filters to the selected window.
//  *
//  *   Everything else in this file is unchanged from the original.
//  */

// import { useEffect, useRef } from "react";
// import { useStore } from "@/core/state/store";
// import { pluginManager } from "@/core/plugins/PluginManager";
// import { dataBus } from "@/core/data/DataBus";

// export function TimelineSync() {
//     const currentTime   = useStore((s) => s.currentTime);
//     const timeRange     = useStore((s) => s.timeRange);
//     const timeWindow    = useStore((s) => s.timeWindow);      // ← watch window
//     const isPlaying     = useStore((s) => s.isPlaying);
//     const playbackSpeed = useStore((s) => s.playbackSpeed);
//     const setCurrentTime= useStore((s) => s.setCurrentTime);
//     const setPlaying    = useStore((s) => s.setPlaying);
//     const isPlaybackMode= useStore((s) => s.isPlaybackMode);
//     const setTimelineAvailability = useStore((s) => s.setTimelineAvailability);

//     // Playback state trackers
//     const lastUpdateRef    = useRef(Date.now());
//     const lastFetchTimeRef = useRef(currentTime.getTime());

//     // ── NEW: re-fetch all enabled plugins when time window changes ──
//     // This is what makes the 1h / 6h / 24h / 48h / 7d header buttons
//     // actually update the GeoNews (and any other time-aware) plugin.
//     const prevWindowRef = useRef(timeWindow);
//     useEffect(() => {
//         // Skip on initial mount — PollingManager already fires a fetch
//         // immediately when a plugin is first enabled.
//         if (prevWindowRef.current === timeWindow) return;
//         prevWindowRef.current = timeWindow;

//         // Emit dataBus event (existing architecture) so any listener
//         // that cares about time range changes is also notified.
//         dataBus.emit("timeRangeChanged", { timeRange });

//         // Directly update all enabled plugins with the new timeRange.
//         // pluginManager.updateTimeRange calls fetchForPlugin which
//         // updates context.timeRange AND calls plugin.fetch(timeRange).
//         pluginManager.updateTimeRange(timeRange).catch((err) => {
//             console.error("[TimelineSync] updateTimeRange failed:", err);
//         });
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [timeWindow]); // ← keyed on timeWindow, not timeRange object (avoids re-render churn)

//     // ── Playback engine (unchanged) ─────────────────────────────
//     useEffect(() => {
//         if (!isPlaying) return;

//         let rafId: number;
//         lastUpdateRef.current = Date.now();

//         const tick = () => {
//             const now      = Date.now();
//             const deltaMs  = now - lastUpdateRef.current;
//             lastUpdateRef.current = now;

//             const state = useStore.getState();
//             const addedTimeMs = deltaMs * state.playbackSpeed;
//             const newTime = new Date(state.currentTime.getTime() + addedTimeMs);

//             if (newTime.getTime() >= state.timeRange.end.getTime()) {
//                 state.setCurrentTime(state.timeRange.end);
//                 state.setPlaying(false);
//             } else {
//                 state.setCurrentTime(newTime);
//             }

//             rafId = requestAnimationFrame(tick);
//         };

//         rafId = requestAnimationFrame(tick);
//         return () => cancelAnimationFrame(rafId);
//     }, [isPlaying]);

//     // ── DataBus → pluginManager sync (unchanged) ────────────────
//     useEffect(() => {
//         const unsub = dataBus.on("timeRangeChanged", ({ timeRange }) => {
//             pluginManager.updateTimeRange(timeRange);
//         });
//         return unsub;
//     }, []);

//     // ── Timeline Availability (unchanged) ───────────────────────
//     useEffect(() => {
//         if (!isPlaybackMode) return;

//         const fetchAvailability = (pluginId: string) => {
//             const plugin = pluginManager.getPlugin(pluginId)?.plugin;
//             if (!plugin) return;
//             const config = plugin.getServerConfig?.();
//             if (config?.availabilityEnabled && config.apiBasePath) {
//                 fetch(`${config.apiBasePath}/availability`)
//                     .then((r) => r.json())
//                     .then((data) => {
//                         if (data.availability) {
//                             setTimelineAvailability(pluginId, data.availability);
//                         }
//                     })
//                     .catch((err) =>
//                         console.error(`[TimelineSync] Availability fetch failed for ${pluginId}`, err)
//                     );
//             }
//         };

//         const active = pluginManager.getEnabledPlugins();
//         for (const { plugin } of active) {
//             fetchAvailability(plugin.id);
//         }

//         const unsub = dataBus.on("layerToggled", ({ pluginId, enabled }) => {
//             if (enabled) {
//                 fetchAvailability(pluginId);
//             } else {
//                 setTimelineAvailability(pluginId, []);
//             }
//         });

//         return unsub;
//     }, [isPlaybackMode, setTimelineAvailability]);

//     // ── Playback scrubber fetch (unchanged) ─────────────────────
//     useEffect(() => {
//         if (!isPlaybackMode) return;

//         const now = currentTime.getTime();
//         if (Math.abs(now - lastFetchTimeRef.current) > 15000) {
//             lastFetchTimeRef.current = now;
//             pluginManager.updateTimeRange(timeRange);
//         }
//     }, [currentTime, isPlaybackMode, timeRange]);

//     return null;
// }



// "use client";

// import { useEffect, useRef } from "react";
// import { useStore } from "@/core/state/store";
// import { pluginManager } from "@/core/plugins/PluginManager";
// import { dataBus } from "@/core/data/DataBus";

// /**
//  * Syncs the Zustand timeline state with the plugin manager polling
//  * and emits time-based events.
//  */
// export function TimelineSync() {
//     const currentTime = useStore((s) => s.currentTime);
//     const timeRange = useStore((s) => s.timeRange);
//     const isPlaying = useStore((s) => s.isPlaying);
//     const playbackSpeed = useStore((s) => s.playbackSpeed);
//     const setCurrentTime = useStore((s) => s.setCurrentTime);
//     const setPlaying = useStore((s) => s.setPlaying);
//     const isPlaybackMode = useStore((s) => s.isPlaybackMode);
//     const setTimelineAvailability = useStore((s) => s.setTimelineAvailability);

//     // Playback state trackers
//     const lastUpdateRef = useRef(Date.now());
//     const lastFetchTimeRef = useRef(currentTime.getTime());

//     // Playback engine
//     useEffect(() => {
//         if (!isPlaying) return;

//         let rafId: number;
//         lastUpdateRef.current = Date.now();

//         const tick = () => {
//             const now = Date.now();
//             const deltaMs = now - lastUpdateRef.current;
//             lastUpdateRef.current = now;

//             const state = useStore.getState();
//             // Calculate new time based on speed multiplier
//             const addedTimeMs = deltaMs * state.playbackSpeed;
//             const newTime = new Date(state.currentTime.getTime() + addedTimeMs);

//             // Stop if reached end of window
//             if (newTime.getTime() >= state.timeRange.end.getTime()) {
//                 state.setCurrentTime(state.timeRange.end);
//                 state.setPlaying(false);
//             } else {
//                 state.setCurrentTime(newTime);
//             }

//             rafId = requestAnimationFrame(tick);
//         };

//         rafId = requestAnimationFrame(tick);

//         return () => cancelAnimationFrame(rafId);
//     }, [isPlaying]);

//     // Sync to plugins? Currently plugins fetch entire time ranges and store them.
//     // Real-time updates could notify plugins to re-fetch on timeRange changes.
//     useEffect(() => {
//         const unsub = dataBus.on("timeRangeChanged", ({ timeRange }) => {
//             pluginManager.updateTimeRange(timeRange);
//         });
//         return unsub;
//     }, []);

//     // Sync Timeline Availability
//     useEffect(() => {
//         if (!isPlaybackMode) return;

//         const fetchAvailability = (pluginId: string) => {
//             const plugin = pluginManager.getPlugin(pluginId)?.plugin;
//             if (!plugin) return;
//             const config = plugin.getServerConfig?.();
//             if (config?.availabilityEnabled && config.apiBasePath) {
//                 fetch(`${config.apiBasePath}/availability`)
//                     .then((r) => r.json())
//                     .then((data) => {
//                         if (data.availability) {
//                             setTimelineAvailability(pluginId, data.availability);
//                         }
//                     })
//                     .catch((err) =>
//                         console.error(`[TimelineSync] Availability fetch failed for ${pluginId}`, err)
//                     );
//             }
//         };

//         // Fetch for already enabled plugins
//         const active = pluginManager.getEnabledPlugins();
//         for (const { plugin } of active) {
//             fetchAvailability(plugin.id);
//         }

//         const unsub = dataBus.on("layerToggled", ({ pluginId, enabled }) => {
//             if (enabled) {
//                 fetchAvailability(pluginId);
//             } else {
//                 setTimelineAvailability(pluginId, []);
//             }
//         });

//         return unsub;
//     }, [isPlaybackMode, setTimelineAvailability]);

//     // Playback Mode: Trigger fetches when time changes significantly (e.g. by scrubber or playback)
//     useEffect(() => {
//         if (!isPlaybackMode) return;

//         const now = currentTime.getTime();
//         // Trigger a fetch if time has moved by more than 15 seconds (matches backend recording frequency)
//         if (Math.abs(now - lastFetchTimeRef.current) > 15000) {
//             lastFetchTimeRef.current = now;
//             pluginManager.updateTimeRange(timeRange);
//         }
//     }, [currentTime, isPlaybackMode, timeRange]);

//     return null; // Logic-only component
// }
