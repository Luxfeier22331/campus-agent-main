import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const designTokens = readFileSync("src/design/tokens.css", "utf8");
const mapStyles = readFileSync("src/campus-styles.css", "utf8");

const mapThemeTokens = [
	"map-overlay-surface",
	"map-overlay-surface-strong",
	"map-overlay-surface-soft",
	"map-overlay-surface-hover",
	"map-overlay-border",
	"map-overlay-divider",
	"map-style-background",
	"map-style-building-fill",
	"map-style-building-outline",
	"map-style-green-fill",
	"map-style-label",
	"map-style-road-fill",
	"map-style-selection-fill",
	"map-style-selection-halo",
	"map-style-selection-outline",
	"map-style-sport-fill",
	"map-marker-border",
	"map-marker-building",
	"map-marker-dining",
	"map-marker-gate",
	"map-marker-landmark",
	"map-marker-service",
	"map-marker-transport",
] as const;

describe("campus map theme token contract", () => {
	it("keeps the light map palette and semantic marker styles", () => {
		for (const token of mapThemeTokens) {
			expect(designTokens).toContain(`--${token}:`);
		}
		expect(designTokens).toContain(":root {");
		expect(designTokens).toContain("--map-style-background: #edf1ed;");
		expect(designTokens).toContain("--map-style-boundary: var(--campus-brand-identity);");
		expect(designTokens).toContain("--map-style-selection-fill: var(--campus-selected-bg);");
		expect(designTokens).toContain("--map-style-selection-outline: var(--campus-selected-border);");
		expect(designTokens).toContain("--map-marker-building: var(--campus-brand-identity);");
		expect(designTokens).toContain("--map-marker-service: var(--campus-brand-identity);");
		expect(designTokens).toContain("--map-marker-border: var(--neutral-0);");
		expect(designTokens).toContain("--map-marker-landmark-foreground: var(--neutral-900);");
		expect(mapStyles).toContain("border: 2px solid var(--map-marker-border);");
		expect(mapStyles).toContain("color: var(--map-marker-foreground);");
		expect(mapStyles).toContain("color: var(--map-marker-landmark-foreground);");
		expect(mapStyles).toContain("transform: scale(1.16);");
		expect(mapStyles).not.toContain("background: var(--map-marker-selected);");
		expect(designTokens).not.toContain("--map-style-boundary: var(--sys-brand-identity);");
		expect(designTokens).not.toContain("--map-marker-building: var(--muc-caisson-blue);");
		expect(designTokens).not.toContain("--map-marker-service: var(--muc-caisson-blue);");
	});

	it("defines dark overrides for explicit and system themes", () => {
		const explicitDark = designTokens.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/u)?.[1];
		const systemDark = designTokens.match(
			/@media \(prefers-color-scheme: dark\)[\s\S]*?:root:not\(\[data-theme\]\)\s*\{([\s\S]*?)\n\s*\}/u,
		)?.[1];

		expect(explicitDark).toBeTruthy();
		expect(systemDark).toBeTruthy();
		for (const token of mapThemeTokens) {
			expect(explicitDark).toContain(`--${token}:`);
			expect(systemDark).toContain(`--${token}:`);
		}
		expect(explicitDark).toContain("--map-style-background: var(--sys-bg-muted);");
		expect(explicitDark).toContain("--map-style-green-fill: #274532;");
		expect(explicitDark).toContain("--map-style-road-fill: #343438;");
		expect(explicitDark).toContain("--map-style-selection-fill: var(--campus-selected-pressed);");
		expect(explicitDark).toContain("--map-style-selection-outline: var(--campus-selected-border);");
		expect(explicitDark).toContain("--map-style-sport-fill: #2d3341;");
		expect(systemDark).toContain("--map-style-green-fill: #274532;");
		expect(systemDark).toContain("--map-style-road-fill: #343438;");
		expect(systemDark).toContain("--map-style-selection-fill: var(--campus-selected-pressed);");
		expect(systemDark).toContain("--map-style-sport-fill: #2d3341;");
		expect(systemDark).toContain("--map-marker-border: var(--sys-surface-raised);");
	});
});
