import { describe, expect, it } from "vitest";
import {
	createCampusMapProfilesFromManifest,
	createCampusMapStyle,
	getCampusMapProfile,
} from "../src/features/map/campus-map-style";

describe("campus map style", () => {
	it("keeps campus building labels local to the MapLibre style", () => {
		const profiles = createCampusMapProfilesFromManifest({
			attribution: ["Synthetic map contributors"],
			campuses: {
				fengtai: {
					bounds: [120, 30, 120.1, 30.1],
					geojsonUrl: "/map-data/v2026-06-30/geojson/fengtai-campus.geojson",
					name: "丰台校区",
				},
				haidian: {
					bounds: [121, 31, 121.1, 31.1],
					geojsonUrl: "/map-data/v2026-06-30/geojson/haidian-campus.geojson",
					name: "海淀校区",
				},
			},
			licenseBoundary: "External map data",
			version: "v2026-06-30",
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
			data: "/map-data/v2026-06-30/geojson/haidian-campus.geojson",
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
					"fill-color": "rgba(26, 115, 232, 0.14)",
					"fill-opacity": 1,
				}),
				type: "fill",
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-place-selected-halo")).toEqual(
			expect.objectContaining({
				filter: ["==", ["get", "fid"], -1],
				paint: expect.objectContaining({
					"line-color": "rgba(255, 255, 255, 0.92)",
					"line-opacity": 0.94,
				}),
				type: "line",
			}),
		);
		expect(style.layers?.find((layer) => layer.id === "campus-place-selected-outline")).toEqual(
			expect.objectContaining({
				filter: ["==", ["get", "fid"], -1],
				paint: expect.objectContaining({
					"line-color": "#1a73e8",
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
					geojsonUrl: "/map-data/v2026-06-30/geojson/fengtai-campus.geojson",
					name: "丰台校区",
					tileUrlTemplate: "/map-data/v2026-06-30/tiles/fengtai/{z}/{x}/{y}.png",
				},
			},
			licenseBoundary: "External map data",
			version: "v2026-06-30",
		});

		expect(profiles).toHaveLength(1);
		expect(profiles[0]).toMatchObject({
			assetUrl: "/map-data/v2026-06-30/geojson/fengtai-campus.geojson",
			campus: "丰台校区",
			sourceId: "fengtai-campus",
		});
		expect(profiles[0]?.center).toEqual([120.05, 30.05]);
	});
});

function readTestMapStyleColors() {
	return {
		background: "#edf1f4",
		boundary: "#a20000",
		buildingFill: "#f9fafb",
		buildingOutline: "#98a2b3",
		greenFill: "#d9eadf",
		label: "#101828",
		roadFill: "#d6dce3",
		selectionFill: "rgba(26, 115, 232, 0.14)",
		selectionHalo: "rgba(255, 255, 255, 0.92)",
		selectionOutline: "#1a73e8",
		sportFill: "#dce8f8",
	};
}
