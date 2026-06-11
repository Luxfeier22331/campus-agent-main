// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildCampusExperienceService } from "../src/modules/campus-experience";

describe("campus experience projection seed", () => {
	it("provides enough campus map places to review the map experience", async () => {
		const service = buildCampusExperienceService();
		const response = await service.getMapPlaces();
		const placeIds = new Set(response.places.map((place) => place.id));
		const categories = new Set(response.places.map((place) => place.category));
		const placesById = new Map(response.places.map((place) => [place.id, place]));

		expect(response.campus).toMatchObject({
			id: "muc-campuses",
			name: "中央民族大学校区",
		});
		expect(response.places.length).toBeGreaterThanOrEqual(12);
		for (const diningPlaceId of [
			"haidian-canteen-1",
			"haidian-canteen-2",
			"haidian-canteen-3",
			"haidian-canteen-4",
			"haidian-canteen-5",
			"fengtai-huixian-canteen",
			"fengtai-juya-canteen",
		]) {
			expect(placeIds.has(diningPlaceId)).toBe(true);
		}
		expect(placeIds.size).toBe(response.places.length);
		for (const category of ["building", "gate", "landmark", "service", "transport"] as const) {
			expect(categories.has(category)).toBe(true);
		}
		for (const place of response.places) {
			expect(place.sourceRefs.length).toBeGreaterThan(0);
			expect(place.geojson.properties.placeId).toBe(place.id);
			expect(place.geojson.properties.title).toBe(place.title);
		}
		expect(placesById.get("fengtai-huixian-canteen")?.mapFeatureRefs).toEqual([
			{ fid: 41, layer: "building", sourceId: "fengtai-campus" },
		]);
		expect(placesById.get("fengtai-juya-canteen")?.mapFeatureRefs).toEqual([
			{ fid: 40, layer: "building", sourceId: "fengtai-campus" },
		]);
		expect(placesById.get("fengtai-main-gate")?.mapFeatureRefs).toBeUndefined();
		expect(placesById.get("fengtai-shuttle-stop")?.mapFeatureRefs).toBeUndefined();
	});

	it("does not own dining floorplan projections", () => {
		const service = buildCampusExperienceService();

		expect("getDiningHalls" in service).toBe(false);
		expect("getDiningFloor" in service).toBe(false);
	});
});
