// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateCampusMapRelease } from "../scripts/campus-map/generate.ts";

const assetsRoot = new URL("../assets/campus-map/", import.meta.url);

interface Manifest {
	attribution: string[];
	campuses: Record<
		string,
		{ bounds: [number, number, number, number]; geojsonUrl: string; name: string }
	>;
	licenseBoundary: string;
	placesUrl: string;
}

interface Feature {
	geometry: { coordinates: unknown; type: string };
	properties: { fid: number; layer: string };
	type: "Feature";
}

interface PlacesDocument {
	campus: { defaultCenter: [number, number]; id: string; name: string };
	places: Array<{
		category: string;
		campus: string;
		geojson: {
			geometry: { coordinates: [number, number]; type: "Point" };
			properties: { category: string; placeId: string; title: string };
			type: "Feature";
		};
		id: string;
		mapFeatureRefs?: Array<{ fid: number; layer: string; sourceId: string }>;
		title: string;
	}>;
}

describe("campus map static contract", () => {
	it("validates the checked-in release with the owner generator", () => {
		expect(() =>
			validateCampusMapRelease({
				assetRoot: fileURLToPath(assetsRoot),
				dataRoot: fileURLToPath(new URL("../data/campus-map/", import.meta.url)),
			}),
		).not.toThrow();
	});

	it("keeps manifest assets content-addressed and places tied to campus features", async () => {
		const manifest = await readJson<Manifest>("manifest.json");
		expect(manifest.attribution).toContain(
			'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
		);
		expect(manifest.licenseBoundary).toContain("ODbL 1.0");
		expect(Object.keys(manifest.campuses).sort()).toEqual(["fengtai", "haidian"]);

		const featureKeys = new Set<string>();
		for (const [campusId, campus] of Object.entries(manifest.campuses)) {
			const match = /^\/campus-map\/assets\/([0-9a-f]{64})\.geojson$/u.exec(campus.geojsonUrl);
			expect(match).not.toBeNull();
			const digest = match?.[1];
			if (!digest) {
				throw new Error(`Missing GeoJSON digest for ${campusId}`);
			}
			const bytes = await readFile(new URL(`assets/${digest}.geojson`, assetsRoot));
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(digest);
			const collection = JSON.parse(new TextDecoder().decode(bytes)) as {
				features: Feature[];
				type: string;
			};
			expect(collection.type).toBe("FeatureCollection");
			expect(collection.features.length).toBeGreaterThan(0);
			for (const feature of collection.features) {
				expect(feature.type).toBe("Feature");
				const key = `${campusId}:${feature.properties.layer}:${feature.properties.fid}`;
				expect(featureKeys.has(key)).toBe(false);
				featureKeys.add(key);
				visitCoordinates(feature.geometry.coordinates, (coordinate) => {
					expect(isInsideBounds(coordinate, campus.bounds)).toBe(true);
				});
			}
		}

		const placesMatch = /^\/campus-map\/places\/([0-9a-f]{64})\.json$/u.exec(manifest.placesUrl);
		expect(placesMatch).not.toBeNull();
		const placesDigest = placesMatch?.[1];
		if (!placesDigest) {
			throw new Error("Missing places digest");
		}
		const placesBytes = await readFile(new URL(`places/${placesDigest}.json`, assetsRoot));
		expect(createHash("sha256").update(placesBytes).digest("hex")).toBe(placesDigest);
		const places = JSON.parse(new TextDecoder().decode(placesBytes)) as PlacesDocument;
		const campusesByName = new Map(
			Object.entries(manifest.campuses).map(([id, campus]) => [campus.name, id]),
		);
		const placeIds = new Set<string>();
		const referenced = new Set<string>();
		for (const place of places.places) {
			expect(placeIds.has(place.id)).toBe(false);
			placeIds.add(place.id);
			expect(place.geojson.properties).toMatchObject({
				category: place.category,
				placeId: place.id,
				title: place.title,
			});
			const campusId = campusesByName.get(place.campus);
			expect(campusId).toBeDefined();
			const bounds = campusId ? manifest.campuses[campusId]?.bounds : undefined;
			if (bounds && !isInsideBounds(place.geojson.geometry.coordinates, bounds)) {
				expect(place.category).toBe("transport");
				expect(place.mapFeatureRefs).toBeUndefined();
			}
			for (const ref of place.mapFeatureRefs ?? []) {
				expect(ref.sourceId).toBe(`${campusId}-campus`);
				const key = `${campusId}:${ref.layer}:${ref.fid}`;
				expect(featureKeys.has(key)).toBe(true);
				expect(referenced.has(key)).toBe(false);
				referenced.add(key);
			}
		}
		expect(placeIds.size).toBe(places.places.length);
	});
});

async function readJson<T>(name: string): Promise<T> {
	return JSON.parse(await readFile(new URL(name, assetsRoot), "utf8")) as T;
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
	if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
		visit([value[0], value[1]]);
		return;
	}
	for (const child of value) {
		visitCoordinates(child, visit);
	}
}
