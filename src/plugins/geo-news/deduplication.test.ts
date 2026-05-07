import { describe, it, expect } from "vitest";
import { normalizeTitle, calculateSimilarity } from "./newsPipeline";

describe("News Deduplication Similarity Logic", () => {
    it("should normalize titles correctly", () => {
        const title1 = "BREAKING: Armed bandits attack village in Kaduna!";
        const normalized = normalizeTitle(title1);
        expect(normalized).toBe("armed bandits attack village in kaduna");
    });

    it("should handle common prefixes in normalization", () => {
        const t1 = "Just In: Explosion in Lagos";
        const t2 = "Exclusive: Explosion in Lagos";
        const t3 = "Report: Explosion in Lagos";

        expect(normalizeTitle(t1)).toBe("explosion in lagos");
        expect(normalizeTitle(t2)).toBe("explosion in lagos");
        expect(normalizeTitle(t3)).toBe("explosion in lagos");
    });

    it("should calculate high similarity for nearly identical titles", () => {
        const t1 = "Gunmen abduct 10 people in Zamfara State";
        const t2 = "Gunmen abduct 10 in Zamfara state";

        const sim = calculateSimilarity(t1, t2);
        expect(sim).toBeGreaterThan(0.85);
    });

    it("should calculate high similarity for titles with different prefixes", () => {
        const t1 = "Breaking: 20 killed in fresh communal clash in Plateau";
        const t2 = "20 killed in fresh Plateau communal clash";

        const sim = calculateSimilarity(t1, t2);
        // "20 killed in fresh communal clash in plateau" vs "20 killed in fresh plateau communal clash"
        // These are very similar in content
        expect(sim).toBeGreaterThan(0.8);
    });

    it("should calculate low similarity for different news", () => {
        const t1 = "Flood displaces thousands in Kogi";
        const t2 = "Armed robbery at a bank in Lagos";

        const sim = calculateSimilarity(t1, t2);
        expect(sim).toBeLessThan(0.3);
    });

    it("should handle very short titles", () => {
        expect(calculateSimilarity("A", "A")).toBe(1.0);
        expect(calculateSimilarity("A", "B")).toBe(0);
    });
});
