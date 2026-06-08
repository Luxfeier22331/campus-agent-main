export type CampusMapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";

export interface CampusMapPlace {
	accessNote: string | null;
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
