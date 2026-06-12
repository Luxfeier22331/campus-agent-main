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
		for (const officialHaidianPlaceId of [
			"library",
			"science-engineering-building",
			"haidian-west-gate",
			"haidian-east-small-gate",
			"haidian-north-gate",
			"east-gate",
			"haidian-staff-apartment-23",
			"haidian-teaching-building-20",
			"haidian-teaching-building-18",
			"haidian-teaching-building-21",
			"haidian-staff-apartment-15",
			"haidian-staff-apartment-14",
			"haidian-teaching-building-16",
			"haidian-basketball-court",
			"haidian-art-museum",
			"wenhua-building",
			"haidian-teaching-building-10",
			"auditorium",
			"haidian-student-apartment-1",
			"haidian-student-apartment-2",
			"haidian-student-apartment-4",
			"haidian-apartment-building-4",
			"haidian-student-apartment-5",
			"haidian-student-apartment-6",
			"haidian-student-apartment-7",
			"haidian-student-apartment-8",
			"haidian-social-science-ethnic-institute",
			"haidian-roller-skating-ground",
			"haidian-tennis-court",
			"haidian-office-building-1",
			"haidian-office-building-2",
			"haidian-office-building-3",
			"zhonghui-building",
			"nanrui-building",
			"haidian-north-wisdom-building",
			"haidian-north-complex-building",
			"haidian-south-complex-building",
			"haidian-track-football-field",
			"haidian-volleyball-court",
			"shaw-gymnasium",
			"haidian-hospital",
			"ethnic-museum",
			"ethnic-theater",
			"haidian-south-gate",
		]) {
			expect(placeIds.has(officialHaidianPlaceId), officialHaidianPlaceId).toBe(true);
			expect(placesById.get(officialHaidianPlaceId)?.sourceRefs).toContain(
				"https://www.muc.edu.cn/xxgk1/xydt.htm",
			);
			expect(placesById.get(officialHaidianPlaceId)?.sourceRefs).toContain(
				"https://www.muc.edu.cn/__local/F/91/AB/7FD57D5626A89FCED2B52241DFC_FD318D0B_612F3.png",
			);
		}
		for (const unboundOfficialHaidianPlaceId of [
			"haidian-west-gate",
			"haidian-east-small-gate",
			"haidian-north-gate",
			"east-gate",
			"haidian-staff-apartment-23",
			"haidian-teaching-building-20",
			"haidian-teaching-building-18",
			"haidian-teaching-building-21",
			"haidian-staff-apartment-15",
			"haidian-staff-apartment-14",
			"haidian-teaching-building-16",
			"haidian-basketball-court",
			"haidian-art-museum",
			"wenhua-building",
			"haidian-teaching-building-10",
			"auditorium",
			"haidian-student-apartment-1",
			"haidian-student-apartment-2",
			"haidian-student-apartment-4",
			"haidian-apartment-building-4",
			"haidian-student-apartment-5",
			"haidian-student-apartment-6",
			"haidian-student-apartment-7",
			"haidian-student-apartment-8",
			"haidian-social-science-ethnic-institute",
			"haidian-roller-skating-ground",
			"haidian-tennis-court",
			"haidian-office-building-1",
			"haidian-office-building-2",
			"haidian-office-building-3",
			"zhonghui-building",
			"nanrui-building",
			"haidian-north-wisdom-building",
			"haidian-north-complex-building",
			"haidian-south-complex-building",
			"haidian-track-football-field",
			"haidian-volleyball-court",
			"shaw-gymnasium",
			"haidian-south-gate",
		]) {
			expect(
				placesById.get(unboundOfficialHaidianPlaceId)?.mapFeatureRefs,
				unboundOfficialHaidianPlaceId,
			).toBeUndefined();
		}
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
		for (const fengtaiPlaceId of [
			"fengtai-library",
			"fengtai-hospital",
			"fengtai-student-activity-center",
			"fengtai-comprehensive-building",
			"fengtai-zhiyuan-building",
			"fengtai-bowen-building",
			"fengtai-mingde-chongli-building",
			"fengtai-teacher-apartment-zone",
			"fengtai-track-field",
			"fengtai-basketball-court",
			"fengtai-volleyball-court",
			"fengtai-tennis-court",
			"fengtai-air-dome",
			"fengtai-football-field",
		]) {
			expect(placeIds.has(fengtaiPlaceId), fengtaiPlaceId).toBe(true);
			expect(placesById.get(fengtaiPlaceId)?.mapFeatureRefs?.length).toBeGreaterThan(0);
		}
		expect(placesById.get("fengtai-huixian-canteen")?.mapFeatureRefs).toEqual([
			{ fid: 41, layer: "building", sourceId: "fengtai-campus" },
		]);
		expect(placesById.get("fengtai-juya-canteen")?.mapFeatureRefs).toEqual([
			{ fid: 40, layer: "building", sourceId: "fengtai-campus" },
		]);
		expect(placesById.get("library")?.mapFeatureRefs).toEqual([
			{ fid: 849087992, layer: "building", sourceId: "haidian-campus" },
		]);
		expect(placesById.get("haidian-hospital")?.mapFeatureRefs).toEqual([
			{ fid: 548820883, layer: "building", sourceId: "haidian-campus" },
		]);
		expect(placesById.get("fengtai-library")?.mapFeatureRefs).toEqual([
			{ fid: 49, layer: "building", sourceId: "fengtai-campus" },
		]);
		expect(placesById.get("fengtai-basketball-court")?.mapFeatureRefs).toEqual([
			{ fid: 2, layer: "sport", sourceId: "fengtai-campus" },
		]);
		expect(placesById.get("haidian-canteen-1")?.mapFeatureRefs).toBeUndefined();
		expect(placesById.get("fengtai-main-gate")?.mapFeatureRefs).toBeUndefined();
		expect(placesById.get("fengtai-shuttle-stop")?.mapFeatureRefs).toBeUndefined();
	});

	it("does not own dining floorplan projections", () => {
		const service = buildCampusExperienceService();

		expect("getDiningHalls" in service).toBe(false);
		expect("getDiningFloor" in service).toBe(false);
	});
});
