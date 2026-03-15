"use client";

import React from "react";
import { useStore } from "@/core/state/store";
import { FloatingWindow } from "@/components/common/FloatingWindow";
import { CameraStream } from "./CameraStream";

export const FloatingVideoManager: React.FC = () => {
    const { floatingStreams, removeFloatingStream, updateFloatingStream } = useStore();

    if (floatingStreams.length === 0) return null;

    return (
        <>
            {floatingStreams.map((stream) => (
                <FloatingWindow
                    key={stream.id}
                    id={stream.id}
                    title={stream.label}
                    initialPosition={stream.position}
                    initialSize={stream.size}
                    onClose={() => removeFloatingStream(stream.id)}
                    onUpdate={(updates) => updateFloatingStream(stream.id, updates)}
                >
                    <div style={{ width: "100%", height: "100%", backgroundColor: "black" }}>
                        <CameraStream
                            streamUrl={stream.streamUrl}
                            isIframe={stream.isIframe}
                            label={stream.label}
                            className="h-full w-full"
                        />
                    </div>
                </FloatingWindow>
            ))}
        </>
    );
};
