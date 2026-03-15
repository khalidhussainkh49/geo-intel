"use client";

import React, { ChangeEvent } from "react";
import { inputGroupStyle, labelStyle, inputStyle, loadButtonStyle } from "./cameraSettingsStyles";

interface InsecamSectionProps {
    settings: any;
    pluginId: string;
    isLoading: boolean;
    onCategoryChange: (e: ChangeEvent<HTMLSelectElement>) => void;
    onLimitChange: (limit: number) => void;
    onLoad: () => void;
}

export const InsecamSection: React.FC<InsecamSectionProps> = ({
    settings, isLoading, onCategoryChange, onLimitChange, onLoad,
}) => (
    <>
        <div style={inputGroupStyle}>
            <label style={labelStyle}>Category</label>
            <select value={settings.insecamCategory || ""} onChange={onCategoryChange} style={{ ...inputStyle, width: "100%", marginTop: "4px" }}>
                <option value="">Select Category</option>
                <option value="rating">Highest Rated</option>
                <option value="new">Newest</option>
            </select>
        </div>
        <div style={inputGroupStyle}>
            <label style={labelStyle}>Max Cameras</label>
            <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "4px" }}>
                <select value={settings.insecamLimit?.toString() || "90"} onChange={(e) => onLimitChange(parseInt(e.target.value, 10))} style={{ ...inputStyle, flex: 1 }}>
                    <option value="90">90</option>
                    <option value="150">150</option>
                    <option value="300">300</option>
                    <option value="600">600</option>
                </select>
                <button onClick={onLoad} disabled={!settings.insecamCategory || isLoading} style={loadButtonStyle(!settings.insecamCategory || isLoading)}>
                    {isLoading ? "Loading..." : "Load"}
                </button>
            </div>
        </div>
    </>
);
