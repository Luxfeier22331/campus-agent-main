import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	assertDiningFloorplanManifest,
	DINING_FLOORPLAN_MANIFEST,
	getDiningFloorplanByFloor,
} from "../src/floorplans";

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

	it("uses unified structural SVG floorplans for Juya floors", () => {
		const firstFloor = getDiningFloorplanByFloor({
			floorId: "fengtai-juya-canteen-1f",
			hallId: "fengtai-juya-canteen",
		});
		const secondFloor = getDiningFloorplanByFloor({
			floorId: "fengtai-juya-canteen-2f",
			hallId: "fengtai-juya-canteen",
		});

		expect(firstFloor.svgMarkup).toContain('data-structure="floorplan-walls"');
		expect(firstFloor.svgMarkup).toContain('class="circulation"');
		expect(firstFloor.svgMarkup).toContain('data-map-role="entrance"');
		expect(firstFloor.svgMarkup).not.toContain("data-source-kind");
		expect(firstFloor.svgMarkup).not.toContain("<image");
		expect(firstFloor.anchorInventory.map((anchor) => anchor.anchorId)).toEqual([
			"window-01",
			"window-02",
			"window-03",
			"window-04",
			"window-05",
			"window-06",
			"window-07",
			"window-08",
		]);

		expect(secondFloor.svgMarkup).toContain('data-structure="floorplan-walls"');
		expect(secondFloor.svgMarkup).toContain('class="circulation"');
		expect(secondFloor.svgMarkup).toContain('data-map-role="entrance"');
		expect(secondFloor.svgMarkup).not.toContain("data-source-kind");
		expect(secondFloor.svgMarkup).not.toContain("<image");
		expect(secondFloor.anchorInventory.map((anchor) => anchor.anchorId)).toEqual([
			"window-01",
			"window-02",
			"window-03",
			"window-04",
			"window-05",
			"window-06",
			"window-07",
			"window-08",
			"window-09",
		]);
	});

	it("uses extracted structural SVG floorplans for Huixian floors", () => {
		const firstFloor = getDiningFloorplanByFloor({
			floorId: "fengtai-huixian-canteen-1f",
			hallId: "fengtai-huixian-canteen",
		});
		const secondFloor = getDiningFloorplanByFloor({
			floorId: "fengtai-huixian-canteen-2f",
			hallId: "fengtai-huixian-canteen",
		});

		expect(firstFloor.svgMarkup).toContain('data-structure="floorplan-walls"');
		expect(firstFloor.svgMarkup).toContain('class="circulation"');
		expect(firstFloor.svgMarkup).toContain('data-map-role="entrance"');
		expect(firstFloor.svgMarkup).not.toContain("<image");
		expect(firstFloor.anchorInventory.map((anchor) => anchor.anchorId)).toEqual([
			"window-01",
			"window-02",
			"window-03",
			"window-04",
			"window-05",
			"window-06",
			"window-07",
			"window-08",
			"window-09",
			"window-10",
		]);

		expect(secondFloor.svgMarkup).toContain('data-structure="floorplan-walls"');
		expect(secondFloor.svgMarkup).toContain('class="circulation"');
		expect(secondFloor.svgMarkup).toContain('data-map-role="entrance"');
		expect(secondFloor.svgMarkup).not.toContain("<image");
		expect(secondFloor.anchorInventory.map((anchor) => anchor.anchorId)).toEqual([
			"window-01",
			"window-02",
			"window-03",
			"window-04",
			"window-05",
			"window-06",
			"window-07",
			"window-08",
			"window-09",
		]);
	});

	it("uses rebuilt structural SVG floorplans for Haidian second and fourth canteens", () => {
		const fourthCanteen = getDiningFloorplanByFloor({
			floorId: "haidian-canteen-4",
			hallId: "haidian-canteen-4",
		});
		const secondCanteen = getDiningFloorplanByFloor({
			floorId: "haidian-canteen-2",
			hallId: "haidian-canteen-2",
		});

		expect(fourthCanteen).toMatchObject({
			floorId: "haidian-canteen-4",
			floorplanId: "floorplan:haidian-canteen-4:haidian-canteen-4",
			hallId: "haidian-canteen-4",
			svgAssetUrl: "/assets/dining/haidian-canteen-4.svg",
		});
		expect(fourthCanteen.svgMarkup).toContain('data-structure="floorplan-walls"');
		expect(fourthCanteen.svgMarkup).not.toContain("<image");
		expect(fourthCanteen.anchorInventory.map((anchor) => anchor.anchorId)).toEqual(
			Array.from({ length: 19 }, (_, index) => `window-${String(index + 1).padStart(2, "0")}`),
		);

		expect(secondCanteen).toMatchObject({
			floorId: "haidian-canteen-2",
			floorplanId: "floorplan:haidian-canteen-2:haidian-canteen-2",
			hallId: "haidian-canteen-2",
			svgAssetUrl: "/assets/dining/haidian-canteen-2.svg",
		});
		expect(secondCanteen.svgMarkup).toContain('data-structure="floorplan-walls"');
		expect(secondCanteen.svgMarkup).not.toContain("<image");
		expect(secondCanteen.anchorInventory.map((anchor) => anchor.anchorId)).toEqual(
			Array.from({ length: 25 }, (_, index) => `window-${String(index + 1).padStart(2, "0")}`),
		);
	});

	it("does not expose fire evacuation semantics in Juya student floorplans", () => {
		for (const floorId of ["fengtai-juya-canteen-1f", "fengtai-juya-canteen-2f"]) {
			const floorplan = getDiningFloorplanByFloor({
				floorId,
				hallId: "fengtai-juya-canteen",
			});

			expect(floorplan.svgMarkup).not.toContain("fire");
			expect(floorplan.svgMarkup).not.toContain("evacuation");
			expect(floorplan.svgMarkup).not.toContain("消防");
			expect(floorplan.svgMarkup).not.toContain("疏散");
			expect(floorplan.svgMarkup).not.toContain("当前位置");
			expect(floorplan.svgMarkup).not.toContain("原图");
		}
	});

	it("does not expose fire evacuation semantics in Huixian student floorplans", () => {
		for (const floorId of ["fengtai-huixian-canteen-1f", "fengtai-huixian-canteen-2f"]) {
			const floorplan = getDiningFloorplanByFloor({
				floorId,
				hallId: "fengtai-huixian-canteen",
			});

			expect(floorplan.svgMarkup).not.toContain("fire");
			expect(floorplan.svgMarkup).not.toContain("evacuation");
			expect(floorplan.svgMarkup).not.toContain("消防");
			expect(floorplan.svgMarkup).not.toContain("疏散");
			expect(floorplan.svgMarkup).not.toContain("当前位置");
			expect(floorplan.svgMarkup).not.toContain("原图");
		}
	});

	it("keeps Haidian second and fourth canteen maps as student-facing rebuilt maps", () => {
		for (const { floorId, hallId } of [
			{ floorId: "haidian-canteen-2", hallId: "haidian-canteen-2" },
			{ floorId: "haidian-canteen-4", hallId: "haidian-canteen-4" },
		]) {
			const floorplan = getDiningFloorplanByFloor({ floorId, hallId });

			expect(floorplan.svgMarkup).not.toContain("fire");
			expect(floorplan.svgMarkup).not.toContain("evacuation");
			expect(floorplan.svgMarkup).not.toContain("消防");
			expect(floorplan.svgMarkup).not.toContain("疏散");
			expect(floorplan.svgMarkup).not.toContain("原图");
			expect(floorplan.svgMarkup).not.toContain("食堂窗口内容还原示意");
			expect(floorplan.svgMarkup).not.toContain("楼层结构示意");
			expect(floorplan.svgMarkup).not.toContain("基本伙");
			expect(floorplan.svgMarkup).not.toContain("小份菜");
			expect(floorplan.svgMarkup).not.toContain("米粉");
		}
	});

	it("keeps Juya student floorplans focused on the clickable map surface", () => {
		for (const floorId of ["fengtai-juya-canteen-1f", "fengtai-juya-canteen-2f"]) {
			const floorplan = getDiningFloorplanByFloor({
				floorId,
				hallId: "fengtai-juya-canteen",
			});

			expect(floorplan.svgMarkup).not.toContain("档口名称待人工补充");
			expect(floorplan.svgMarkup).not.toContain("楼层结构示意");
			expect(floorplan.svgMarkup).not.toContain("待补充档口锚点");
			expect(floorplan.svgMarkup).not.toContain("楼梯 / 服务设施");
			expect(floorplan.svgMarkup).not.toContain('class="title"');
			expect(floorplan.svgMarkup).not.toContain('class="meta"');
			expect(floorplan.svgMarkup).not.toContain('width="1172" height="664"');
		}
	});

	it("keeps Huixian student floorplans focused on the clickable map surface", () => {
		for (const floorId of ["fengtai-huixian-canteen-1f", "fengtai-huixian-canteen-2f"]) {
			const floorplan = getDiningFloorplanByFloor({
				floorId,
				hallId: "fengtai-huixian-canteen",
			});

			expect(floorplan.svgMarkup).not.toContain("档口名称待人工补充");
			expect(floorplan.svgMarkup).not.toContain("楼层结构示意");
			expect(floorplan.svgMarkup).not.toContain("待补充档口锚点");
			expect(floorplan.svgMarkup).not.toContain("楼梯 / 服务设施");
			expect(floorplan.svgMarkup).not.toContain('class="title"');
			expect(floorplan.svgMarkup).not.toContain('class="meta"');
			expect(floorplan.svgMarkup).not.toContain('width="1172" height="664"');
		}
	});

	it("keeps checked-in checksum aligned with sanitized SVG markup", () => {
		for (const floorplan of DINING_FLOORPLAN_MANIFEST) {
			const digest = createHash("sha256").update(floorplan.svgMarkup).digest("hex");

			expect(floorplan.sha256).toBe(`sha256:${digest}`);
		}
	});
});
