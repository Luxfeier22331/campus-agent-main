import type { CampusMapManifest } from "../../src/features/map/model";

export const mapPageManifest = {
	attribution: ["Synthetic map data"],
	campuses: {
		fengtai: {
			bounds: [120, 30, 120.1, 30.1],
			geojsonUrl: "/map-data/v2026-06-30/geojson/fengtai-campus.geojson",
			name: "丰台校区",
			tileUrlTemplate: "/map-data/v2026-06-30/tiles/fengtai/{z}/{x}/{y}.png",
		},
		haidian: {
			bounds: [121, 31, 121.1, 31.1],
			geojsonUrl: "/map-data/v2026-06-30/geojson/haidian-campus.geojson",
			name: "海淀校区",
		},
	},
	licenseBoundary: "Synthetic map fixture.",
	version: "v2026-06-30",
} as const satisfies CampusMapManifest;
