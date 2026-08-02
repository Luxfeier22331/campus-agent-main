import type { CampusMapManifest } from "../../src/features/map/model";

export const mapPageManifest = {
	attribution: ["Synthetic map data"],
	campuses: {
		fengtai: {
			bounds: [120, 30, 120.1, 30.1],
			geojsonUrl:
				"/api/campus-map/assets/7a0cc069cc7c9044bb088e4b41afb742d8e8faf03c2906292ce846185128b993.geojson",
			name: "丰台校区",
		},
		haidian: {
			bounds: [121, 31, 121.1, 31.1],
			geojsonUrl:
				"/api/campus-map/assets/02f064bd8c11bc56133ef7f1456ec91da8d40107f4a8d55800d85a585f879cc5.geojson",
			name: "海淀校区",
		},
	},
	licenseBoundary: "Synthetic map fixture.",
} as const satisfies CampusMapManifest;
