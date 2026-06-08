// @vitest-environment node

import { describe, expect, it } from "vitest";

import { buildCampusExperienceService } from "../src/modules/campus-experience";

describe("campus experience projection seed", () => {
	it("provides enough campus map places to review the map experience", async () => {
		const service = buildCampusExperienceService();
		const response = await service.getMapPlaces();
		const placeIds = new Set(response.places.map((place) => place.id));
		const categories = new Set(response.places.map((place) => place.category));

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
	});

	it("provides multi-hall dining floorplan projections for visual review", async () => {
		const service = buildCampusExperienceService();
		const response = await service.getDiningHalls();
		const expectedFloorsByHall = {
			"fengtai-huixian-canteen": ["1f", "2f"],
			"fengtai-juya-canteen": ["1f", "2f"],
			"haidian-canteen-1": ["1f"],
			"haidian-canteen-2": ["1f"],
			"haidian-canteen-3": ["1f"],
			"haidian-canteen-4": ["1f"],
			"haidian-canteen-5": ["1f"],
		} as const;

		expect(response.halls.map((hall) => hall.hallId).sort()).toEqual(
			Object.keys(expectedFloorsByHall).sort(),
		);
		for (const hall of response.halls) {
			expect(hall.floors.map((floor) => floor.floorId)).toEqual(
				expectedFloorsByHall[hall.hallId as keyof typeof expectedFloorsByHall],
			);
			expect(hall.campus).toMatch(/^(海淀校区|丰台校区)$/);
			for (const floor of hall.floors) {
				const projection = await service.getDiningFloor({
					floorId: floor.floorId,
					hallId: hall.hallId,
				});
				expect(projection.floor).toMatchObject({
					floorId: floor.floorId,
					hallId: hall.hallId,
				});
				expect(projection.floor.svgAssetUrl).toMatch(
					new RegExp(`^/assets/dining/${hall.hallId}-${floor.floorId}\\.svg$`),
				);
				expect(projection.stalls.length).toBeGreaterThanOrEqual(5);
				expect(projection.source.label).toBe("校园食堂平面图整理");
			}
		}
	});
});
