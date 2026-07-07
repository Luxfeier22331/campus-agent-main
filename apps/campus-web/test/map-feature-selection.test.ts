import { describe, expect, it } from "vitest";

import {
	createFeatureRefKey,
	createHitTestBox,
	createPlaceFeatureIndex,
	findPlaceForRenderedFeature,
} from "../src/features/map/feature-selection";
import type { MapPlaceView } from "../src/features/map/view-model";

const places = [
	createPlaceView({
		id: "sample-canteen-a",
		mapFeatureRefs: [{ fid: 40, layer: "building", sourceId: "fengtai-campus" }],
		title: "示例一食堂",
	}),
	createPlaceView({
		id: "sample-canteen-b",
		mapFeatureRefs: [{ fid: 41, layer: "building", sourceId: "fengtai-campus" }],
		title: "示例二食堂",
	}),
];

describe("campus map feature selection", () => {
	it("builds explicit feature ref keys from source, layer, and fid", () => {
		expect(createFeatureRefKey({ fid: 40, layer: "building", sourceId: "fengtai-campus" })).toBe(
			"fengtai-campus:building:40",
		);
	});

	it("resolves rendered features only through explicit mapFeatureRefs", () => {
		const index = createPlaceFeatureIndex(places);

		expect(
			findPlaceForRenderedFeature(index, {
				properties: { fid: 40, layer: "building", name: "示例一食堂" },
				source: "fengtai-campus",
			}),
		).toBe("sample-canteen-a");
		expect(
			findPlaceForRenderedFeature(index, {
				properties: { fid: 999, layer: "building", name: "示例一食堂" },
				source: "fengtai-campus",
			}),
		).toBeNull();
		expect(
			findPlaceForRenderedFeature(index, {
				properties: { fid: 40, layer: "green", name: "示例一食堂" },
				source: "fengtai-campus",
			}),
		).toBeNull();
	});

	it("creates a small hit-test box around the pointer", () => {
		expect(createHitTestBox({ x: 100, y: 80 }, 8)).toEqual([
			[92, 72],
			[108, 88],
		]);
	});
});

function createPlaceView(input: {
	id: string;
	mapFeatureRefs: MapPlaceView["featureRefs"];
	title: string;
}): MapPlaceView {
	return {
		category: "building",
		categoryLabel: "建筑",
		coordinates: [120.0001, 30.0001],
		detailRows: [],
		displayTags: ["建筑"],
		featureRefs: input.mapFeatureRefs,
		markerVariant: "dining",
		place: {
			accessNote: null,
			campus: "丰台校区",
			category: "building",
			description: input.title,
			geojson: {
				geometry: { coordinates: [120.0001, 30.0001], type: "Point" },
				properties: { category: "building", placeId: input.id, title: input.title },
				type: "Feature",
			},
			id: input.id,
			mapFeatureRefs: input.mapFeatureRefs,
			sourceRefs: [`campus-map:projection:${input.id}`],
			tags: ["食堂"],
			title: input.title,
		},
		searchText: input.title,
		usesFeatureHighlight: true,
	};
}
