import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_ROOT = resolve(APP_ROOT, "data/campus-map");
export const ASSET_ROOT = resolve(APP_ROOT, "assets/campus-map");

export const CAMPUS_CONFIG = {
	fengtai: {
		bounds: [116.1051993, 39.8063459, 116.1159622, 39.8136322],
		name: "丰台校区",
		sourceId: "fengtai-campus",
	},
	haidian: {
		bounds: [116.3084827, 39.9444838, 116.3194888, 39.9556239],
		name: "海淀校区",
		sourceId: "haidian-campus",
	},
} as const;

export type CampusId = keyof typeof CAMPUS_CONFIG;
export type Bounds = readonly [number, number, number, number];
export type JsonObject = Record<string, unknown>;

export interface GeoJsonFeature {
	geometry: { coordinates: unknown; type: string };
	properties: JsonObject;
	type: "Feature";
}

export interface GeoJsonCollection {
	features: GeoJsonFeature[];
	type: "FeatureCollection";
}

export interface PlaceFeatureRef {
	fid: number;
	layer: "boundary" | "building" | "sport";
	sourceId: string;
}

export interface Place {
	accessNote: string | null;
	campus: string;
	category: "building" | "gate" | "landmark" | "service" | "transport";
	description: string;
	geojson: {
		geometry: { coordinates: [number, number]; type: "Point" };
		properties: { category: string; placeId: string; title: string };
		type: "Feature";
	};
	id: string;
	mapFeatureRefs?: PlaceFeatureRef[];
	sourceRefs: string[];
	tags: string[];
	title: string;
}

export interface PlacesDocument {
	campus: { defaultCenter: [number, number]; id: string; name: string };
	places: Place[];
}

export interface Manifest {
	attribution: string[];
	campuses: Record<CampusId, { bounds: Bounds; geojsonUrl: string; name: string }>;
	licenseBoundary: string;
	placesUrl: string;
}

export interface OsmSnapshot {
	elements: unknown[];
}
