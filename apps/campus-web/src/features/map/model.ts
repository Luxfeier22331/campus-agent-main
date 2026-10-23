export type CampusMapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";
export type CampusMapFeatureLayer = "boundary" | "building" | "sport";

export interface CampusMapFeatureRef {
	fid: number;
	layer: CampusMapFeatureLayer;
	sourceId: string;
}

export interface CampusMapPlace {
	accessNote: string | null;
	additionalProperties?: Array<{ label: string; value: string }>;
	campus: string;
	category: CampusMapPlaceCategory;
	description: string;
	geojson: {
		type: "Feature";
		geometry: {
			type: "Point";
			coordinates: [number, number];
		};
		properties: {
			category: CampusMapPlaceCategory;
			placeId: string;
			title: string;
		};
	};
	id: string;
	mapFeatureRefs?: CampusMapFeatureRef[];
	sourceRefs: string[];
	tags: string[];
	title: string;
}

export interface CampusMapPlacesResponse {
	campus: {
		defaultCenter: [number, number];
		id: string;
		name: string;
	};
	places: CampusMapPlace[];
}

export interface CampusMapManifestCampus {
	bounds: [number, number, number, number];
	geojsonUrl: string;
	name: string;
}

export interface CampusMapManifest {
	attribution: string[];
	campuses: Record<string, CampusMapManifestCampus>;
	licenseBoundary: string;
	placesUrl: string;
}
