import { describe, expect, it } from "vitest";
import {
	createCampusMapFeatureFilter,
	createCampusMapProfilesFromManifest,
	createCampusMapStyle,
	getCampusMapProfile,
	selectGatehouseFeatureRefs,
} from "../src/features/map/campus-map-style";
import { INTERACTIVE_CAMPUS_MAP_LAYER_IDS } from "../src/features/map/feature-selection";

describe("campus map style", () => {
	it("creates empty, single, and combined feature filters", () => {
		expect(createCampusMapFeatureFilter([])).toEqual(["==", ["get", "fid"], -1]);
		expect(
			createCampusMapFeatureFilter([{ fid: 101, layer: "building", sourceId: "haidian-campus" }]),
		).toEqual(["all", ["==", ["get", "layer"], "building"], ["==", ["get", "fid"], 101]]);
		expect(
			createCampusMapFeatureFilter([
				{ fid: 101, layer: "building", sourceId: "haidian-campus" },
				{ fid: 202, layer: "sport", sourceId: "haidian-campus" },
			]),
		).toEqual([
			"any",
			["all", ["==", ["get", "layer"], "building"], ["==", ["get", "fid"], 101]],
			["all", ["==", ["get", "layer"], "sport"], ["==", ["get", "fid"], 202]],
		]);
	});

	it("keeps the gatehouse highlight off ordinary selected features", () => {
		// The highlight is a circle layer, and a circle layer paints one circle
		// per vertex, so a tapped polygon comes out ringed with dots unless only
		// the gatehouse point refs reach it.
		expect(
			selectGatehouseFeatureRefs([
				{ fid: 57, layer: "building", sourceId: "fengtai-campus" },
				{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
			]),
		).toEqual([
			{ fid: 57, layer: "building", sourceId: "fengtai-campus" },
			{ fid: 60, layer: "building", sourceId: "fengtai-campus" },
		]);
		expect(
			selectGatehouseFeatureRefs([
				{ fid: 66, layer: "building", sourceId: "fengtai-campus" },
				{ fid: 57, layer: "sport", sourceId: "fengtai-campus" },
				{ fid: 60, layer: "boundary", sourceId: "fengtai-campus" },
			]),
		).toEqual([]);
		expect(selectGatehouseFeatureRefs([])).toEqual([]);
	});

	it("keeps campus building labels local to the MapLibre style", () => {
		const profiles = createCampusMapProfilesFromManifest({
			attribution: ["Synthetic map contributors"],
			campuses: {
				fengtai: {
					bounds: [120, 30, 120.1, 30.1],
					geojsonUrl: `/campus-map/assets/${"a".repeat(64)}.geojson`,
					name: "丰台校区",
				},
				haidian: {
					bounds: [121, 31, 121.1, 31.1],
					geojsonUrl: `/campus-map/assets/${"b".repeat(64)}.geojson`,
					name: "海淀校区",
				},
			},
			licenseBoundary: "External map data",
			placesUrl: `/campus-map/places/${"c".repeat(64)}.json`,
		});
		const style = createCampusMapStyle(
			readTestMapStyleColors(),
			getCampusMapProfile(profiles, "丰台校区"),
		);
		const haidianStyle = createCampusMapStyle(
			readTestMapStyleColors(),
			getCampusMapProfile(profiles, "海淀校区"),
		);

		expect(style.glyphs).toBeUndefined();
		expect(haidianStyle.sources?.["haidian-campus"]).toEqual({
			attribution: "Synthetic map contributors",
			data: `/campus-map/assets/${"b".repeat(64)}.geojson`,
			type: "geojson",
		});
		expect(style.layers?.find((layer) => layer.id === "campus-building-labels")).toEqual(
			expect.objectContaining({
				layout: expect.objectContaining({
					"text-allow-overlap": true,
					"text-field": ["get", "name"],
					"text-ignore-placement": true,
					"text-size": 12,
				}),
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-green")).toEqual(
			expect.objectContaining({ paint: expect.objectContaining({ "fill-color": "#e1f2d6" }) }),
		);
		expect(
			JSON.stringify(style.layers?.find((layer) => layer.id === "campus-building")?.paint),
		).toContain("#6688a8");
		expect(
			JSON.stringify(style.layers?.find((layer) => layer.id === "campus-building")?.paint),
		).toContain("#c77963");
		expect(
			JSON.stringify(style.layers?.find((layer) => layer.id === "campus-building")?.paint),
		).toContain("#8d4c3b");
		expect(style.layers?.find((layer) => layer.id === "campus-sport-pattern")).toEqual(
			expect.objectContaining({
				paint: expect.objectContaining({ "fill-pattern": expect.any(Array) }),
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-place-selected-fill")).toEqual(
			expect.objectContaining({
				filter: ["==", ["get", "fid"], -1],
				paint: expect.objectContaining({
					"fill-color": "#e8e8eb",
					"fill-opacity": 1,
				}),
				type: "fill",
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-place-selected-halo")).toEqual(
			expect.objectContaining({
				filter: ["==", ["get", "fid"], -1],
				paint: expect.objectContaining({
					"line-color": "#ffffff",
					"line-opacity": 0.94,
				}),
				type: "line",
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-place-selected-outline")).toEqual(
			expect.objectContaining({
				filter: ["==", ["get", "fid"], -1],
				paint: expect.objectContaining({
					"line-color": "#6f6f76",
					"line-opacity": 0.98,
				}),
				type: "line",
			}),
		);
		expect(
			style.layers?.findIndex((layer) => layer.id === "campus-place-hover-fill"),
		).toBeGreaterThan(style.layers?.findIndex((layer) => layer.id === "campus-sport") ?? -1);
		expect(
			style.layers?.findIndex((layer) => layer.id === "campus-place-selected-fill"),
		).toBeGreaterThan(style.layers?.findIndex((layer) => layer.id === "campus-sport") ?? -1);
		expect(
			style.layers?.findIndex((layer) => layer.id === "campus-place-selected-outline"),
		).toBeLessThan(style.layers?.findIndex((layer) => layer.id === "campus-building-labels") ?? -1);
		expect(style.layers?.find((layer) => layer.id === "campus-building-labels")).toEqual(
			expect.objectContaining({
				filter: [
					"all",
					["has", "name"],
					["==", ["get", "layer"], "building"],
					["!", ["in", ["get", "name"], ["literal", ["北门门卫", "南门门卫"]]]],
				],
				layout: expect.objectContaining({
					"text-allow-overlap": true,
					"text-ignore-placement": true,
					"text-size": 12,
				}),
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-gatehouse-markers")).toEqual(
			expect.objectContaining({
				filter: [
					"all",
					["==", ["get", "layer"], "building"],
					["in", ["get", "fid"], ["literal", [57, 60]]],
				],
				type: "circle",
			}),
		);
		expect(INTERACTIVE_CAMPUS_MAP_LAYER_IDS).toContain("campus-gatehouse-markers");
		expect(INTERACTIVE_CAMPUS_MAP_LAYER_IDS).toContain("campus-north-gatehouse-label");
		expect(INTERACTIVE_CAMPUS_MAP_LAYER_IDS).toContain("campus-south-gatehouse-label");
		expect(style.layers?.find((layer) => layer.id === "campus-north-gatehouse-label")).toEqual(
			expect.objectContaining({
				layout: expect.objectContaining({ "text-anchor": "bottom", "text-offset": [0, -1.2] }),
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-south-gatehouse-label")).toEqual(
			expect.objectContaining({
				layout: expect.objectContaining({ "text-anchor": "top", "text-offset": [0, 1.2] }),
			}),
		);
		for (const layerId of ["campus-sport-pattern", "campus-building-sport-pattern"]) {
			const serialized = JSON.stringify(style.layers?.find((layer) => layer.id === layerId));
			expect(serialized).toContain('"match"');
			expect(serialized).toContain("篮球场");
			expect(serialized).not.toContain("田径场");
		}
		for (const layerId of ["campus-sport", "campus-building"]) {
			const serialized = JSON.stringify(style.layers?.find((layer) => layer.id === layerId)?.paint);
			expect(serialized).toContain("track-infield");
			expect(serialized).toContain("#c77963");
		}
		expect(
			JSON.stringify(haidianStyle.layers?.find((layer) => layer.id === "campus-gatehouse-markers")),
		).toContain('"filter":["==",["get","fid"],-1]');
	});

	it("creates campus profiles from the runtime map manifest", () => {
		const profiles = createCampusMapProfilesFromManifest({
			attribution: ["Synthetic map contributors"],
			campuses: {
				fengtai: {
					bounds: [120, 30, 120.1, 30.1],
					geojsonUrl: `/campus-map/assets/${"a".repeat(64)}.geojson`,
					name: "丰台校区",
				},
			},
			licenseBoundary: "External map data",
			placesUrl: `/campus-map/places/${"c".repeat(64)}.json`,
		});

		expect(profiles).toHaveLength(1);
		expect(profiles[0]).toMatchObject({
			assetUrl: `/campus-map/assets/${"a".repeat(64)}.geojson`,
			attribution: "Synthetic map contributors",
			campus: "丰台校区",
			sourceId: "fengtai-campus",
		});
		expect(profiles[0]?.center).toEqual([120.05, 30.05]);
	});
});

function readTestMapStyleColors() {
	return {
		background: "#edf1ed",
		boundary: "#262627",
		buildingFill: "#fafafb",
		buildingOutline: "#8e8e93",
		greenFill: "#e1f2d6",
		label: "#1c1c1e",
		roadFill: "#d3d8d4",
		selectionFill: "#e8e8eb",
		selectionHalo: "#ffffff",
		selectionOutline: "#6f6f76",
		sportFill: "#e1e8f5",
	};
}
