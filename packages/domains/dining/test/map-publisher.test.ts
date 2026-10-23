import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DiningMapResponseSchema } from "../src/domain/map";
import {
	buildDiningMapResponse,
	diningMapBundleFingerprint,
	renderDiningMapAssets,
} from "../src/domain/publisher";
import { DINING_BOOTSTRAP_FLOORPLANS } from "../src/floorplans/bootstrap";

describe("dining map publisher", () => {
	it("renders the maintained map into one public response", () => {
		const assets = renderDiningMapAssets(DINING_BOOTSTRAP_FLOORPLANS);
		const response = buildDiningMapResponse({
			assets,
			bundle: DINING_BOOTSTRAP_FLOORPLANS,
			releaseId: "release-test",
			updatedAt: "2026-07-24T08:00:00.000Z",
		});

		expect(assets).toHaveLength(9);
		expect(response.halls).toHaveLength(7);
		expect(new Set(response.halls.map((hall) => hall.campus))).toEqual(
			new Set(["丰台校区", "海淀校区"]),
		);
		expect(response.halls.flatMap((hall) => hall.floors)).toHaveLength(9);
		expect(
			response.halls.flatMap((hall) => hall.floors).flatMap((floor) => floor.windows),
		).toHaveLength(45);
		expect(DiningMapResponseSchema.parse(response)).toEqual(response);
		for (const asset of assets) {
			expect(createHash("sha256").update(asset.svgMarkup).digest("hex")).toBe(
				asset.sha256.slice("sha256:".length),
			);
			expect(asset.svgAssetUrl).toBe(
				`/api/dining/floorplans/${asset.sha256.slice("sha256:".length)}.svg`,
			);
		}
	});

	it("fingerprints canonical map content instead of input ordering", () => {
		const reordered = {
			...DINING_BOOTSTRAP_FLOORPLANS,
			layouts: [...DINING_BOOTSTRAP_FLOORPLANS.layouts].reverse(),
		};
		expect(diningMapBundleFingerprint(reordered)).toBe(
			diningMapBundleFingerprint(DINING_BOOTSTRAP_FLOORPLANS),
		);
	});

	it("rejects overlapping windows before creating public assets", () => {
		const bundle = structuredClone(DINING_BOOTSTRAP_FLOORPLANS);
		const layout = bundle.layouts.find((candidate) => candidate.windows.length > 1);
		const first = layout?.windows[0];
		const second = layout?.windows[1];
		if (!(first && second)) {
			throw new Error("Expected two bootstrap windows.");
		}
		second.x = first.x;
		second.y = first.y;
		expect(() => renderDiningMapAssets(bundle)).toThrow(/重叠/u);
	});
});
