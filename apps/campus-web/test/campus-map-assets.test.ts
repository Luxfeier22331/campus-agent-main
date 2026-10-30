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
	it("separates Mingde and Chongli with independent names, geometry and place links", async () => {
		const curated = JSON.parse(
			await readFile(
				new URL("../data/campus-map/curated/fengtai.geojson", import.meta.url),
				"utf8",
			),
		) as {
			features: Array<{
				geometry: { coordinates: number[][][]; type: string };
				properties: { fid: number; layer: string; name?: string };
			}>;
		};
		const places = JSON.parse(
			await readFile(new URL("../data/campus-map/places.source.json", import.meta.url), "utf8"),
		) as PlacesDocument;
		const north = curated.features.find((feature) => feature.properties.name === "明德楼");
		const south = curated.features.find((feature) => feature.properties.name === "崇理楼");
		expect(north?.properties.fid).toBe(56);
		expect(south?.properties.fid).toBe(67);
		expect(north?.geometry.type).toBe("Polygon");
		expect(south?.geometry.type).toBe("Polygon");
		const northRing = north?.geometry.coordinates[0] ?? [];
		const southRing = south?.geometry.coordinates[0] ?? [];
		expect(northRing.length).toBeGreaterThan(3);
		expect(southRing.length).toBeGreaterThan(3);
		expect(northRing[0]).toEqual(northRing.at(-1));
		expect(southRing[0]).toEqual(southRing.at(-1));
		expect(Math.min(...northRing.map((point) => point[1] ?? 0))).toBeGreaterThan(
			Math.max(...southRing.map((point) => point[1] ?? 0)),
		);
		expect(JSON.stringify(curated)).not.toContain("崇礼");
		expect(JSON.stringify(places)).not.toContain("崇礼");
		for (const [name, fid] of [
			["明德楼", 56],
			["崇理楼", 67],
		] as const) {
			const matches = places.places.filter((place) => place.title === name);
			expect(matches).toHaveLength(1);
			expect(matches[0]?.mapFeatureRefs).toEqual([
				{ fid, layer: "building", sourceId: "fengtai-campus" },
			]);
			expect(matches[0]?.geojson.properties.title).toBe(name);
		}
	});

	it("validates the checked-in release with the owner generator", () => {
		expect(() =>
			validateCampusMapRelease({
				assetRoot: fileURLToPath(assetsRoot),
				dataRoot: fileURLToPath(new URL("../data/campus-map/", import.meta.url)),
			}),
		).not.toThrow();
	});

	it("represents each pair of gatehouses as a single point without losing place links", async () => {
		const curated = JSON.parse(
			await readFile(
				new URL("../data/campus-map/curated/fengtai.geojson", import.meta.url),
				"utf8",
			),
		) as {
			features: Array<{
				geometry: { coordinates: unknown; type: string };
				properties: { fid: number; layer: string; name?: string };
			}>;
		};
		const placesDoc = JSON.parse(
			await readFile(new URL("../data/campus-map/places.source.json", import.meta.url), "utf8"),
		) as PlacesDocument;
		const gatehouses = curated.features.filter(
			(feature) =>
				feature.properties.layer === "building" &&
				["北门门卫", "南门门卫"].includes(feature.properties.name ?? ""),
		);
		expect(gatehouses).toHaveLength(2);
		expect(gatehouses.map((feature) => feature.properties.fid).sort((a, b) => a - b)).toEqual([
			57, 60,
		]);
		expect(gatehouses.every((feature) => feature.geometry.type === "Point")).toBe(true);
		for (const id of ["fengtai-north-gate", "fengtai-main-gate"]) {
			const place = placesDoc.places.find((candidate) => candidate.id === id);
			expect(place?.mapFeatureRefs).toHaveLength(1);
		}
	});

	it("keeps the track infield unnamed so its label does not overlap the track", async () => {
		const curated = JSON.parse(
			await readFile(
				new URL("../data/campus-map/curated/fengtai.geojson", import.meta.url),
				"utf8",
			),
		) as {
			features: Array<{
				properties: { fid: number; layer: string; name?: string; surface?: string };
			}>;
		};
		const infieldFeatures = curated.features.filter(
			(feature) => feature.properties.surface === "track-infield",
		);
		expect(
			infieldFeatures
				.map((feature) => `${feature.properties.layer}:${feature.properties.fid}`)
				.sort(),
		).toEqual(["building:66", "sport:1"]);
		expect(infieldFeatures.every((feature) => feature.properties.name === undefined)).toBe(true);
		expect(
			curated.features.some((feature) => (feature.properties.name ?? "").includes("田径场内场")),
		).toBe(false);
		const track = curated.features.find(
			(feature) => feature.properties.layer === "building" && feature.properties.fid === 63,
		);
		expect(track?.properties.name).toBe("田径场");
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
