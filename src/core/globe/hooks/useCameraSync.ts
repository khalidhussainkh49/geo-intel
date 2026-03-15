import { useEffect } from "react";
import type { Viewer as CesiumViewer } from "cesium";
import { Cartographic, Math as CesiumMath } from "cesium";

export function useCameraSync(
    viewer: CesiumViewer | null,
    isReady: boolean,
    setCameraPosition: (lat: number, lon: number, alt: number, heading: number, pitch: number, roll: number) => void,
    setFps: (fps: number) => void
) {
    useEffect(() => {
        if (!viewer || viewer.isDestroyed() || !viewer.scene || !viewer.camera || !isReady) return;

        const updateStore = () => {
            const camera = viewer.camera;
            if (!camera || !camera.position) return;

            const cartographic = Cartographic.fromCartesian(camera.position);
            if (!cartographic) return;

            const lat = CesiumMath.toDegrees(cartographic.latitude ?? 0);
            const lon = CesiumMath.toDegrees(cartographic.longitude ?? 0);
            const alt = cartographic.height ?? 0;
            const heading = CesiumMath.toDegrees(camera.heading ?? 0);
            const pitch = CesiumMath.toDegrees(camera.pitch ?? 0);
            const roll = CesiumMath.toDegrees(camera.roll ?? 0);

            // Use functional update to avoid unnecessary re-renders if values are close enough
            // But for HUD we want real-time, so we just call it.
            setCameraPosition(lat, lon, alt, heading, pitch, roll);
        };

        let frameCount = 0;
        let lastTime = performance.now();

        const updateFps = () => {
            frameCount++;
            const currentTime = performance.now();
            if (currentTime - lastTime >= 1000) {
                const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
                setFps(fps);
                frameCount = 0;
                lastTime = currentTime;
            }
        };

        viewer.scene.postRender.addEventListener(updateStore);
        viewer.scene.postRender.addEventListener(updateFps);

        return () => {
            if (!viewer.isDestroyed()) {
                viewer.scene.postRender.removeEventListener(updateStore);
                viewer.scene.postRender.removeEventListener(updateFps);
            }
        };
    }, [viewer, isReady, setCameraPosition, setFps]);
}
