// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { buildCampusExperienceService } from "../src/modules/campus-experience";

interface CampusMapManifest {
	attribution: string[];
	campuses: Record<
		string,
		{
			bounds: [number, number, number, number];
			geojsonUrl: string;
			name: string;
		}
	>;
	licenseBoundary: string;
}

interface CampusMapFeatureCollection {
	features: Array<{
		geometry: { coordinates: unknown; type: string };
		properties: { fid: number; layer: string };
		type: "Feature";
	}>;
	type: "FeatureCollection";
}

const assetsDirectory = new URL("../assets/campus-map/", import.meta.url);

describe("campus map asset contract", () => {
	it("keeps manifest URLs content-addressed and every GeoJSON feature inside its campus bounds", async () => {
		const manifest = await readManifest();
		const featureKeys = new Set<string>();

		expect(Object.keys(manifest.campuses).sort()).toEqual(["fengtai", "haidian"]);
		expect(manifest.attribution).toEqual([
			'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
		]);
		expect(manifest.licenseBoundary).toContain("ODbL 1.0");
		expect(manifest.licenseBoundary).toContain("not covered by the repository Apache-2.0 license");

		for (const [campusId, campus] of Object.entries(manifest.campuses)) {
			const match = /^\/api\/campus-map\/assets\/([0-9a-f]{64})\.geojson$/.exec(campus.geojsonUrl);
			expect(match, campusId).not.toBeNull();
			const digest = match?.[1];
			if (!digest) {
				throw new Error(`Missing content digest for ${campusId}`);
			}
			const bytes = await readFile(new URL(`${digest}.geojson`, assetsDirectory));
			expect(createHash("sha256").update(bytes).digest("hex"), campusId).toBe(digest);
			const collection = JSON.parse(new TextDecoder().decode(bytes)) as CampusMapFeatureCollection;
			expect(collection.type, campusId).toBe("FeatureCollection");
			expect(collection.features.length, campusId).toBeGreaterThan(0);

			for (const feature of collection.features) {
				expect(feature.type).toBe("Feature");
				expect(Number.isSafeInteger(feature.properties.fid)).toBe(true);
				expect(["boundary", "building", "green", "roadp", "sport"]).toContain(
					feature.properties.layer,
				);
				const key = featureKey(
					`${campusId}-campus`,
					feature.properties.layer,
					feature.properties.fid,
				);
				expect(featureKeys.has(key), key).toBe(false);
				featureKeys.add(key);
				let coordinateCount = 0;
				visitCoordinates(feature.geometry.coordinates, (coordinate) => {
					coordinateCount += 1;
					expect(isInsideBounds(coordinate, campus.bounds), `${campusId}: ${coordinate}`).toBe(
						true,
					);
				});
				expect(coordinateCount, key).toBeGreaterThan(0);
			}
		}

		const response = await buildCampusExperienceService().getMapPlaces();
		const placeIds = new Set<string>();
		const referencedFeatureKeys = new Set<string>();
		const campusesByName = new Map(
			Object.entries(manifest.campuses).map(([campusId, campus]) => [
				campus.name,
				{ campusId, ...campus },
			]),
		);
		for (const place of response.places) {
			expect(placeIds.has(place.id), place.id).toBe(false);
			placeIds.add(place.id);
			expect(place.sourceRefs.length, place.id).toBeGreaterThan(0);
			for (const ref of place.mapFeatureRefs ?? []) {
				const key = featureKey(ref.sourceId, ref.layer, ref.fid);
				expect(featureKeys.has(key), `${place.id}: ${key}`).toBe(true);
				expect(referencedFeatureKeys.has(key), `${place.id}: ${key}`).toBe(false);
				referencedFeatureKeys.add(key);
				const campus = campusesByName.get(place.campus);
				expect(campus?.campusId, place.id).toBe(ref.sourceId.replace(/-campus$/, ""));
				expect(
					campus && isInsideBounds(place.geojson.geometry.coordinates, campus.bounds),
					place.id,
				).toBe(true);
			}
		}

		const subway = response.places.find((place) => place.id === "weigongcun-subway");
		expect(subway?.mapFeatureRefs).toBeUndefined();
		expect(
			isInsideBounds(
				subway?.geojson.geometry.coordinates ?? [0, 0],
				manifest.campuses.haidian?.bounds ?? [0, 0, 0, 0],
			),
		).toBe(false);
	});
});

async function readManifest(): Promise<CampusMapManifest> {
	return JSON.parse(
		await readFile(new URL("manifest.json", assetsDirectory), "utf8"),
	) as CampusMapManifest;
}

function featureKey(sourceId: string, layer: string, fid: number): string {
	return `${sourceId}:${layer}:${fid}`;
}

function isInsideBounds(
	coordinate: readonly [number, number],
	bounds: readonly [number, number, number, number],
): boolean {
	return (
		coordinate[0] >= bounds[0] &&
		coordinate[0] <= bounds[2] &&
		coordinate[1] >= bounds[1] &&
		coordinate[1] <= bounds[3]
	);
}

function visitCoordinates(value: unknown, visit: (coordinate: [number, number]) => void): void {
	if (!Array.isArray(value)) {
		throw new Error("GeoJSON coordinates must be arrays.");
	}
	if (
		value.length >= 2 &&
		typeof value[0] === "number" &&
		Number.isFinite(value[0]) &&
		typeof value[1] === "number" &&
		Number.isFinite(value[1])
	) {
		visit([value[0], value[1]]);
		return;
	}
	for (const child of value) {
		visitCoordinates(child, visit);
	}
}
