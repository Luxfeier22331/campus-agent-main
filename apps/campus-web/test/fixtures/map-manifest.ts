import type { CampusMapManifest } from "../../src/features/map/model";

export const mapPageManifest = {
	attribution: ["Synthetic map data"],
	campuses: {
		fengtai: {
			bounds: [120, 30, 120.1, 30.1],
			geojsonUrl:
				"/campus-map/assets/a995be35f38bbb21e1df85b09333449981beffb63ce20edb238781dfd6872e94.geojson",
			name: "丰台校区",
		},
		haidian: {
			bounds: [121, 31, 121.1, 31.1],
			geojsonUrl:
				"/campus-map/assets/02f064bd8c11bc56133ef7f1456ec91da8d40107f4a8d55800d85a585f879cc5.geojson",
			name: "海淀校区",
		},
	},
	licenseBoundary: "Synthetic map fixture.",
	placesUrl:
		"/campus-map/places/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json",
} as const satisfies CampusMapManifest;
