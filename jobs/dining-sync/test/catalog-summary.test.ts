import { createDevDiningOperationsState } from "dining-domain";
import { describe, expect, it } from "vitest";

import { buildDiningCatalogPublishSummary } from "../src/catalog-summary";

describe("dining catalog publish summary", () => {
	it("reports the visible hall and floor set for dev seed imports", () => {
		const summary = buildDiningCatalogPublishSummary(
			createDevDiningOperationsState(),
			"dev_seed_imported",
		);

		expect(summary).toMatchObject({
			hallCount: 5,
			releaseId: "dining_release:dev_seed",
			status: "dev_seed_imported",
			visibleHalls: expect.arrayContaining([
				expect.objectContaining({
					floors: [{ floorId: "haidian-canteen-2", label: "地图", svgAssetUrl: expect.any(String) }],
					hallId: "haidian-canteen-2",
					name: "海淀二食堂",
				}),
				expect.objectContaining({
					floors: [{ floorId: "haidian-canteen-4", label: "地图", svgAssetUrl: expect.any(String) }],
					hallId: "haidian-canteen-4",
					name: "海淀四食堂",
				}),
			]),
		});
		expect(summary.stallCount).toBeGreaterThanOrEqual(5);
		expect(summary.menuItemCount).toBeGreaterThanOrEqual(5);
		expect(summary.menuOfferingCount).toBeGreaterThanOrEqual(5);
	});
});
