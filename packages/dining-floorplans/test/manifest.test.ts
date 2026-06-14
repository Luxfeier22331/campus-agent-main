import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	assertDiningFloorplanManifest,
	DINING_FLOORPLAN_MANIFEST,
	getDiningFloorplanByFloor,
} from "../src/index";

describe("dining floorplan manifest", () => {
	it("exposes stable repo-versioned floorplans", () => {
		const floorplan = getDiningFloorplanByFloor({
			floorId: "fengtai-outdoor-dining-zone-ground",
			hallId: "fengtai-outdoor-dining-zone",
		});

		expect(floorplan).toMatchObject({
			floorId: "fengtai-outdoor-dining-zone-ground",
			floorplanId: "floorplan:fengtai-outdoor-dining-zone:fengtai-outdoor-dining-zone-ground",
			hallId: "fengtai-outdoor-dining-zone",
			sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
			svgAssetUrl: "/assets/dining/fengtai-outdoor-dining-zone.svg",
		});
		expect(floorplan.anchorInventory.map((anchor) => anchor.anchorId)).toEqual([
			"shop-01-maituanxiong",
			"shop-02-zuozuoxiang",
			"shop-03-tastien",
			"shop-04-huihan-zhachuan",
			"shop-05-luckin-jixiang-huntun",
			"shop-06-lage-lamei",
			"shop-07-ice-snacks",
			"shop-08-guizhou-snacks",
			"stall-water-bar",
			"stall-fruit",
			"stall-light-food",
		]);
	});

	it("fails closed when an SVG contains duplicate anchor ids", () => {
		expect(() =>
			assertDiningFloorplanManifest([
				{
					floorId: "1f",
					floorplanId: "floorplan:test:1f",
					hallId: "test",
					sha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
					svgAssetUrl: "/assets/dining/test.svg",
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
					sha256: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
					svgAssetUrl: "/assets/dining/test.svg",
					svgMarkup:
						'<svg viewBox="0 0 100 100"><g data-dining-role="window" data-dining-anchor-id="actual"></g></svg>',
				},
			]),
		).toThrow(/does not match extracted anchors/);
	});

	it("keeps the checked-in manifest valid", () => {
		expect(() => assertDiningFloorplanManifest(DINING_FLOORPLAN_MANIFEST)).not.toThrow();
	});

	it("keeps checked-in checksum aligned with sanitized SVG markup", () => {
		for (const floorplan of DINING_FLOORPLAN_MANIFEST) {
			const digest = createHash("sha256").update(floorplan.svgMarkup).digest("hex");

			expect(floorplan.sha256).toBe(`sha256:${digest}`);
		}
	});
});
