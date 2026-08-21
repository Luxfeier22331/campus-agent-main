import { describe, expect, it } from "vitest";
import {
	createCampusMapFeatureFilter,
	createCampusMapProfilesFromManifest,
	createCampusMapStyle,
	getCampusMapProfile,
} from "../src/features/map/campus-map-style";

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
					"text-field": ["get", "name"],
				}),
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
				filter: ["all", ["has", "name"], ["==", ["get", "layer"], "building"]],
				layout: expect.objectContaining({
					"text-size": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, 10, 17, 12, 19, 13],
				}),
			}),
		);
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
		background: "#efeff2",
		boundary: "#262627",
		buildingFill: "#fafafb",
		buildingOutline: "#8e8e93",
		greenFill: "#dfeee4",
		label: "#1c1c1e",
		roadFill: "#d1d1d6",
		selectionFill: "#e8e8eb",
		selectionHalo: "#ffffff",
		selectionOutline: "#6f6f76",
		sportFill: "#e1e8f5",
	};
}
