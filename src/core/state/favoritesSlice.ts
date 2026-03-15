import type { StateCreator } from "zustand";
import type { AppStore } from "./store";
import type { GeoEntity } from "@/core/plugins/PluginTypes";

export interface FavoriteItem {
    id: string;
    pluginId: string;
    label: string;
    pluginName: string;
    icon?: any;
    lastSeen: number;
}

export interface FavoritesSlice {
    favorites: FavoriteItem[];
    addFavorite: (entity: GeoEntity, pluginName: string, icon?: any) => void;
    removeFavorite: (id: string) => void;
}

export const createFavoritesSlice: StateCreator<AppStore, [], [], FavoritesSlice> = (set) => ({
    favorites: [],
    addFavorite: (entity, pluginName, icon) =>
        set((state) => {
            if (state.favorites.some((f) => f.id === entity.id)) return state;
            return {
                favorites: [
                    ...state.favorites,
                    {
                        id: entity.id,
                        pluginId: entity.pluginId,
                        label: entity.label || entity.id,
                        pluginName,
                        icon,
                        lastSeen: Date.now(),
                    },
                ],
            };
        }),
    removeFavorite: (id) =>
        set((state) => ({
            favorites: state.favorites.filter((f) => f.id !== id),
        })),
});
