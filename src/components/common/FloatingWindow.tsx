"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Minus, Maximize2, Square } from "lucide-react";

interface FloatingWindowProps {
    id: string;
    title: string;
    children: React.ReactNode;
    initialPosition?: { x: number; y: number };
    initialSize?: { width: number; height: number };
    onClose: () => void;
    onUpdate?: (updates: { position?: { x: number; y: number }; size?: { width: number; height: number } }) => void;
    minWidth?: number;
    minHeight?: number;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
    id,
    title,
    children,
    initialPosition = { x: 100, y: 100 },
    initialSize = { width: 400, height: 300 },
    onClose,
    onUpdate,
    minWidth = 300,
    minHeight = 200,
}) => {
    const [pos, setPos] = useState(initialPosition);
    const [size, setSize] = useState(initialSize);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const windowRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest(".window-controls")) return;
        setIsDragging(true);
        setDragStart({ x: e.clientX - pos.x, y: e.clientY - pos.y });
    };

    const handleResizeMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        setDragStart({ x: e.clientX, y: e.clientY });
    };

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (isDragging) {
            const newX = e.clientX - dragStart.x;
            const newY = e.clientY - dragStart.y;
            setPos({ x: newX, y: newY });
        } else if (isResizing) {
            const deltaX = e.clientX - dragStart.x;
            const deltaY = e.clientY - dragStart.y;
            const newWidth = Math.max(minWidth, size.width + deltaX);
            const newHeight = Math.max(minHeight, size.height + deltaY);
            setSize({ width: newWidth, height: newHeight });
            setDragStart({ x: e.clientX, y: e.clientY });
        }
    }, [isDragging, isResizing, dragStart, pos, size, minWidth, minHeight]);

    const handleMouseUp = useCallback(() => {
        if (isDragging || isResizing) {
            setIsDragging(false);
            setIsResizing(false);
            onUpdate?.({ position: pos, size: size });
        }
    }, [isDragging, isResizing, pos, size, onUpdate]);

    useEffect(() => {
        if (isDragging || isResizing) {
            window.addEventListener("mousemove", handleMouseMove);
            window.addEventListener("mouseup", handleMouseUp);
        } else {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        }
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

    return (
        <div
            ref={windowRef}
            style={{
                position: "fixed",
                left: pos.x,
                top: pos.y,
                width: size.width,
                height: size.height,
                zIndex: 1000,
                display: "flex",
                flexDirection: "column",
                backgroundColor: "rgba(10, 10, 10, 0.85)",
                backdropFilter: "blur(12px)",
                borderRadius: "12px",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
                overflow: "hidden",
                color: "white"
            }}
        >
            {/* Header / Title Bar */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                    cursor: isDragging ? "grabbing" : "grab",
                    userSelect: "none"
                }}
                onMouseDown={handleMouseDown}
            >
                <span style={{ fontSize: "12px", fontWeight: 600, color: "rgba(255, 255, 255, 0.8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {title}
                </span>

                <div className="window-controls" style={{ display: "flex", gap: "8px" }}>
                    <button
                        onClick={onClose}
                        style={{
                            background: "none",
                            border: "none",
                            color: "rgba(255, 255, 255, 0.4)",
                            cursor: "pointer",
                            padding: "4px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "4px",
                            transition: "all 0.2s"
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = "#ef4444";
                            e.currentTarget.style.backgroundColor = "rgba(239, 68, 68, 0.1)";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = "rgba(255, 255, 255, 0.4)";
                            e.currentTarget.style.backgroundColor = "transparent";
                        }}
                    >
                        <X size={14} />
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
                {children}
            </div>

            {/* Resize Handle */}
            <div
                style={{
                    position: "absolute",
                    bottom: 0,
                    right: 0,
                    width: "16px",
                    height: "16px",
                    cursor: "nwse-resize",
                    zIndex: 1001,
                    display: "flex",
                    alignItems: "flex-end",
                    justifyContent: "flex-end",
                    padding: "2px"
                }}
                onMouseDown={handleResizeMouseDown}
            >
                <div style={{ width: "4px", height: "4px", backgroundColor: "rgba(255, 255, 255, 0.3)", borderRadius: "1px" }} />
            </div>
        </div>
    );
};
