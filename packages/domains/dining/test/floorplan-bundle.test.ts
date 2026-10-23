import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DINING_BOOTSTRAP_FLOORPLANS } from "../src/floorplans/bootstrap";
import {
	canonicalizeDiningFloorplanBundle,
	createDiningFloorplanBundle,
	serializeDiningFloorplanBundle,
} from "../src/floorplans/bundle";

describe("dining floorplan bundle", () => {
	it("keeps the repository bootstrap as the canonical empty-environment input", () => {
		expect(DINING_BOOTSTRAP_FLOORPLANS.halls).toHaveLength(7);
		expect(DINING_BOOTSTRAP_FLOORPLANS.layouts).toHaveLength(9);
		expect(new Set(DINING_BOOTSTRAP_FLOORPLANS.halls.map((hall) => hall.campus))).toEqual(
			new Set(["丰台校区", "海淀校区"]),
		);
		expect(
			readFileSync(
				new URL("../src/floorplans/bootstrap-floorplans.v1.json", import.meta.url),
				"utf8",
			),
		).toBe(serializeDiningFloorplanBundle(DINING_BOOTSTRAP_FLOORPLANS));
	});

	it("serializes layouts deterministically", () => {
		const reverse = createDiningFloorplanBundle(
			[...DINING_BOOTSTRAP_FLOORPLANS.layouts].reverse(),
			DINING_BOOTSTRAP_FLOORPLANS.halls,
		);
		expect(serializeDiningFloorplanBundle(reverse)).toBe(
			serializeDiningFloorplanBundle(DINING_BOOTSTRAP_FLOORPLANS),
		);
	});

	it("rejects duplicate identities and unsupported fields", () => {
		const layout = DINING_BOOTSTRAP_FLOORPLANS.layouts[0];
		if (!layout) {
			throw new Error("Expected a bootstrap floorplan.");
		}
		expect(() =>
			createDiningFloorplanBundle(
				[layout, layout],
				DINING_BOOTSTRAP_FLOORPLANS.halls.filter((hall) => hall.hallId === layout.hallId),
			),
		).toThrow(/Duplicate dining floorplan/u);
		expect(() =>
			canonicalizeDiningFloorplanBundle({
				...DINING_BOOTSTRAP_FLOORPLANS,
				generatedAt: new Date().toISOString(),
			}),
		).toThrow(/unsupported fields/u);
		expect(() =>
			canonicalizeDiningFloorplanBundle({
				...DINING_BOOTSTRAP_FLOORPLANS,
				layouts: [{ ...layout, environmentRevision: 12 }],
			}),
		).toThrow(/layout.environmentRevision/u);
	});

	it("requires every layout and hall to reference each other", () => {
		const layout = DINING_BOOTSTRAP_FLOORPLANS.layouts[0];
		if (!layout) {
			throw new Error("Expected a bootstrap floorplan.");
		}
		expect(() =>
			canonicalizeDiningFloorplanBundle({
				...DINING_BOOTSTRAP_FLOORPLANS,
				layouts: [{ ...layout, hallId: "unknown-hall" }],
			}),
		).toThrow(/unknown hall/u);
		expect(() =>
			canonicalizeDiningFloorplanBundle({
				...DINING_BOOTSTRAP_FLOORPLANS,
				layouts: DINING_BOOTSTRAP_FLOORPLANS.layouts.filter(
					(candidate) => candidate.hallId !== layout.hallId,
				),
			}),
		).toThrow(/has no floorplan/u);
	});
});
