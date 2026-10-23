import { describe, expect, it } from "vitest";
import type { CampusMapPlace } from "../src/features/map/model";
import { createMapPlaceViews, filterMapPlaces } from "../src/features/map/view-model";

describe("campus map place supplementary properties", () => {
	it("shows reviewed source attributes in details and searches them", () => {
		const place: CampusMapPlace = {
			accessNote: null,
			additionalProperties: [
				{ label: "楼层", value: "8层" },
				{ label: "名称状态", value: "沿用参考名称" },
				{ label: "核对说明", value: "具体楼名待核" },
			],
			campus: "丰台校区",
			category: "building",
			description: "教师公寓区位于丰台校区生活区。",
			geojson: {
				geometry: { coordinates: [116.11, 39.81], type: "Point" },
				properties: { category: "building", placeId: "fengtai-staff-housing", title: "教师公寓区" },
				type: "Feature",
			},
			id: "fengtai-staff-housing",
			mapFeatureRefs: [{ fid: 1, layer: "building", sourceId: "fengtai-campus" }],
			sourceRefs: ["campus-map:projection:fengtai-staff-housing"],
			tags: ["公寓", "生活", "丰台"],
			title: "教师公寓区",
		};
		const views = createMapPlaceViews([place]);

		expect(views[0]?.detailRows).toContainEqual({ label: "楼层", value: "8层" });
		expect(views[0]?.detailRows).not.toContainEqual({ label: "名称状态", value: "沿用参考名称" });
		expect(views[0]?.detailRows).not.toContainEqual({ label: "核对说明", value: "具体楼名待核" });
		expect(
			filterMapPlaces(views, { campus: "丰台校区", category: "all", query: "具体楼名待核" }),
		).toHaveLength(1);
		expect(
			filterMapPlaces(views, { campus: "丰台校区", category: "all", query: "8层" }),
		).toHaveLength(1);
	});
});
