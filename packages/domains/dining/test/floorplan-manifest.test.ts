import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	assertDiningFloorplanManifest,
	assertDiningWayfindingLayout,
	buildDiningFloorplanAssetUrl,
	DINING_FLOORPLAN_MANIFEST,
	DINING_WAYFINDING_LAYOUTS,
	getDiningFloorplanByFloor,
	renderDiningWayfindingSvg,
} from "../src/floorplans";

const EXPECTED_WINDOW_COUNTS: Record<string, number> = {
	"fengtai-huixian-canteen-1f": 10,
	"fengtai-huixian-canteen-2f": 9,
	"fengtai-juya-canteen-1f": 8,
	"fengtai-juya-canteen-2f": 9,
	"fengtai-outdoor-dining-zone-ground": 11,
	"haidian-canteen-1-1f": 5,
	"haidian-canteen-2": 25,
	"haidian-canteen-3-1f": 5,
	"haidian-canteen-4": 19,
	"haidian-canteen-5-1f": 5,
};

describe("dining floorplan manifest", () => {
	it("publishes all ten layouts through one stable wayfinding contract", () => {
		expect(DINING_FLOORPLAN_MANIFEST).toHaveLength(10);
		expect(DINING_WAYFINDING_LAYOUTS).toHaveLength(10);
		for (const floorplan of DINING_FLOORPLAN_MANIFEST) {
			expect(floorplan.canvas).toEqual({ height: 760, width: 1280 });
			expect(floorplan.anchorInventory).toHaveLength(EXPECTED_WINDOW_COUNTS[floorplan.floorId]);
			expect(floorplan.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(floorplan.svgAssetUrl).toBe(buildDiningFloorplanAssetUrl(floorplan.sha256));
			expect(createHash("sha256").update(floorplan.svgMarkup).digest("hex")).toBe(
				floorplan.sha256.slice("sha256:".length),
			);
		}
	});

	it("renders every floor with the same restrained visual grammar", () => {
		for (const floorplan of DINING_FLOORPLAN_MANIFEST) {
			expect(floorplan.svgMarkup).toContain('class="wayfinding-canvas"');
			expect(floorplan.svgMarkup).toContain('class="wayfinding-outline"');
			expect(floorplan.svgMarkup).toContain('class="wayfinding-window"');
			expect(floorplan.svgMarkup).toContain("#f7f9f8");
			expect(floorplan.svgMarkup).toContain("#ffffff");
			expect(floorplan.svgMarkup).toContain("#b8c3ca");
			expect(floorplan.svgMarkup).toContain("#64748b");
			expect(floorplan.svgMarkup).toContain("#16805a");
			expect(floorplan.svgMarkup).not.toContain("circulation");
			expect(floorplan.svgMarkup).not.toContain('class="wall"');
			expect(floorplan.svgMarkup).not.toContain('class="service"');
			expect(floorplan.svgMarkup).not.toContain('class="core"');
			expect(floorplan.svgMarkup).not.toContain("flow-arrow");
		}
	});

	it("retains source-calibrated Fengtai footprints and structural basemaps", () => {
		const expected = {
			"fengtai-huixian-canteen-1f": {
				outline: [
					[210, 50],
					[533, 50],
					[533, 95],
					[631, 95],
					[631, 50],
					[965, 50],
					[965, 228],
					[1071, 228],
					[1071, 695],
					[210, 695],
				],
				partitionCount: 15,
				structureCount: 5,
			},
			"fengtai-huixian-canteen-2f": {
				outline: [
					[198, 50],
					[972, 50],
					[972, 248],
					[1083, 248],
					[1083, 710],
					[198, 710],
				],
				partitionCount: 17,
				structureCount: 5,
			},
			"fengtai-juya-canteen-1f": {
				outline: [
					[452, 50],
					[975, 50],
					[975, 278],
					[828, 278],
					[828, 710],
					[305, 710],
					[305, 128],
					[452, 128],
				],
				partitionCount: 18,
				structureCount: 6,
			},
			"fengtai-juya-canteen-2f": {
				outline: [
					[458, 50],
					[977, 50],
					[977, 278],
					[833, 278],
					[833, 421],
					[752, 421],
					[752, 485],
					[833, 485],
					[833, 560],
					[752, 560],
					[752, 623],
					[833, 623],
					[833, 709],
					[317, 709],
					[317, 398],
					[389, 398],
					[389, 122],
					[458, 122],
				],
				partitionCount: 20,
				structureCount: 5,
			},
		} as const;

		for (const [floorId, contract] of Object.entries(expected)) {
			const layout = DINING_WAYFINDING_LAYOUTS.find((item) => item.floorId === floorId);
			expect(layout?.outline.points.map((point) => [point.x, point.y])).toEqual(contract.outline);
			expect(layout?.structures).toHaveLength(contract.structureCount);
			expect(layout?.partitions).toHaveLength(contract.partitionCount);
			const floorplan = layout ? getDiningFloorplanByFloor(layout) : null;
			expect(floorplan?.svgMarkup).toContain('data-map-role="structure"');
			expect(floorplan?.svgMarkup).toContain('data-map-role="partition"');
		}
	});

	it("keeps stable numbered windows as the only dining interaction anchors", () => {
		for (const layout of DINING_WAYFINDING_LAYOUTS) {
			expect(() => assertDiningWayfindingLayout(layout)).not.toThrow();
			for (const [index, window] of layout.windows.entries()) {
				expect(window.anchorId).toBe(`window-${String(index + 1).padStart(2, "0")}`);
				expect(window.width).toBeGreaterThanOrEqual(88);
				expect(window.height).toBeGreaterThanOrEqual(72);
			}
			const floorplan = getDiningFloorplanByFloor(layout);
			expect(floorplan.anchorInventory.every((anchor) => anchor.role === "window")).toBe(true);
		}
	});

	it("keeps every window clear of other windows, regions, and landmarks", () => {
		for (const layout of DINING_WAYFINDING_LAYOUTS) {
			const blockers = [...layout.windows, ...layout.regions, ...layout.landmarks];
			for (const window of layout.windows) {
				for (const blocker of blockers) {
					if (blocker === window) {
						continue;
					}
					expect(rectanglesOverlap(window, blocker), `${layout.floorId}/${window.anchorId}`).toBe(
						false,
					);
				}
			}
		}
	});

	it("keeps business names and evacuation semantics outside floorplan assets", () => {
		const forbidden = [
			"麦团熊",
			"瑞幸咖啡",
			"广式风味",
			"基本伙",
			"小份菜",
			"fire",
			"evacuation",
			"消防",
			"疏散",
			"当前位置",
			"原图",
		];
		for (const floorplan of DINING_FLOORPLAN_MANIFEST) {
			for (const term of forbidden) {
				expect(floorplan.svgMarkup).not.toContain(term);
			}
			expect(floorplan.svgMarkup).not.toContain("<image");
		}
	});

	it("keeps accessible names without drawing visible map titles or legends", () => {
		for (const layout of DINING_WAYFINDING_LAYOUTS) {
			const svg = renderDiningWayfindingSvg(layout);
			expect(svg).toContain("<title");
			expect(svg).toContain("<desc");
			expect(svg).not.toContain("legend");
			expect(svg).not.toContain("北</text>");
		}
	});

	it("resolves a floor only through its hall and floor identity", () => {
		expect(
			getDiningFloorplanByFloor({
				floorId: "fengtai-juya-canteen-2f",
				hallId: "fengtai-juya-canteen",
			}),
		).toMatchObject({
			canvas: { height: 760, width: 1280 },
			floorId: "fengtai-juya-canteen-2f",
			hallId: "fengtai-juya-canteen",
		});
		expect(() =>
			getDiningFloorplanByFloor({
				floorId: "fengtai-juya-canteen-2f",
				hallId: "fengtai-huixian-canteen",
			}),
		).toThrow(/not found/);
	});

	it("keeps the checked-in manifest valid", () => {
		expect(() => assertDiningFloorplanManifest(DINING_FLOORPLAN_MANIFEST)).not.toThrow();
	});

	it("fails closed when an SVG viewBox cannot define its canvas", () => {
		expect(() =>
			assertDiningFloorplanManifest([
				{
					floorId: "1f",
					floorplanId: "floorplan:test:invalid-viewbox",
					hallId: "test",
					sha256: zeroDigest(),
					svgMarkup:
						'<svg viewBox="0 0 0 100"><g data-dining-role="window" data-dining-anchor-id="a"><rect data-dining-anchor-hit="true"/><text data-dining-anchor-number="true">01</text></g></svg>',
				},
			]),
		).toThrow(/invalid viewBox/);
	});

	it("fails closed when an SVG contains duplicate anchor ids", () => {
		expect(() =>
			assertDiningFloorplanManifest([
				{
					floorId: "1f",
					floorplanId: "floorplan:test:1f",
					hallId: "test",
					sha256: zeroDigest(),
					svgMarkup:
						'<svg viewBox="0 0 100 100"><g data-dining-role="window" data-dining-anchor-id="a"></g><g data-dining-role="window" data-dining-anchor-id="a"></g></svg>',
				},
			]),
		).toThrow(/Duplicate dining SVG anchor/);
	});

	it("fails closed when manifest fields disagree with SVG anchors", () => {
		expect(() =>
			assertDiningFloorplanManifest([
				{
					anchorInventory: [{ anchorId: "missing", role: "window" }],
					floorId: "1f",
					floorplanId: "floorplan:test:1f",
					hallId: "test",
					sha256: zeroDigest(),
					svgMarkup:
						'<svg viewBox="0 0 100 100"><g data-dining-role="window" data-dining-anchor-id="actual"><rect data-dining-anchor-hit="true"/><text data-dining-anchor-number="true">01</text></g></svg>',
				},
			]),
		).toThrow(/does not match extracted anchors/);
	});

	it("fails closed when an anchor lacks its interaction structure", () => {
		expect(() =>
			assertDiningFloorplanManifest([
				{
					floorId: "1f",
					floorplanId: "floorplan:test:1f",
					hallId: "test",
					sha256: zeroDigest(),
					svgMarkup:
						'<svg viewBox="0 0 100 100"><g data-dining-role="window" data-dining-anchor-id="actual"><rect/><text>01</text></g></svg>',
				},
			]),
		).toThrow(/interaction contract is invalid/);
	});

	it("rejects unsafe SVG content and malformed digest references", () => {
		expect(() => buildDiningFloorplanAssetUrl("sha256:bad")).toThrow(/sha256 is invalid/);
		expect(() =>
			assertDiningFloorplanManifest([
				{
					floorId: "1f",
					floorplanId: "floorplan:test:1f",
					hallId: "test",
					sha256: zeroDigest(),
					svgMarkup:
						'<svg viewBox="0 0 100 100"><script>alert(1)</script><g data-dining-role="window" data-dining-anchor-id="a"><rect data-dining-anchor-hit="true"/><text data-dining-anchor-number="true">01</text></g></svg>',
				},
			]),
		).toThrow(/Forbidden dining SVG element/);
	});
});

function zeroDigest(): `sha256:${string}` {
	return `sha256:${"0".repeat(64)}`;
}

function rectanglesOverlap(
	left: { height: number; width: number; x: number; y: number },
	right: { height: number; width: number; x: number; y: number },
): boolean {
	return (
		left.x < right.x + right.width &&
		left.x + left.width > right.x &&
		left.y < right.y + right.height &&
		left.y + left.height > right.y
	);
}
