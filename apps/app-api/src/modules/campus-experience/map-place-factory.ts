import type { CampusMapFeatureRef, CampusMapPlace, CampusMapPlaceCategory } from "./types";

const CAMPUS_MAP_SOURCE_REF = "campus-map:private-source:official-map";
const HAIDIAN_CAMPUS_MAP_IMAGE_SOURCE_REF = "campus-map:private-source:haidian-map-image";

function createPointFeature(
	placeId: string,
	title: string,
	category: CampusMapPlaceCategory,
	coordinates: [number, number],
): CampusMapPlace["geojson"] {
	return {
		type: "Feature",
		geometry: {
			type: "Point",
			coordinates,
		},
		properties: {
			category,
			placeId,
			title,
		},
	};
}

export function createMapPlace(input: {
	campus: string;
	category: CampusMapPlaceCategory;
	coordinates: [number, number];
	description: string;
	id: string;
	mapFeatureRefs?: CampusMapFeatureRef[];
	sourceRefs?: string[];
	tags: string[];
	title: string;
}): CampusMapPlace {
	return {
		accessNote: null,
		campus: input.campus,
		category: input.category,
		description: input.description,
		geojson: createPointFeature(input.id, input.title, input.category, input.coordinates),
		id: input.id,
		...(input.mapFeatureRefs ? { mapFeatureRefs: input.mapFeatureRefs } : {}),
		sourceRefs: input.sourceRefs ?? [`campus-map:projection:${input.id}`],
		tags: input.tags,
		title: input.title,
	};
}

export function createOfficialHaidianMapPlace(input: {
	category: CampusMapPlaceCategory;
	coordinates: [number, number];
	description: string;
	id: string;
	mapFeatureRefs?: CampusMapFeatureRef[];
	tags: string[];
	title: string;
}) {
	return createMapPlace({
		campus: "海淀校区",
		category: input.category,
		coordinates: input.coordinates,
		description: input.description,
		id: input.id,
		...(input.mapFeatureRefs ? { mapFeatureRefs: input.mapFeatureRefs } : {}),
		sourceRefs: [
			CAMPUS_MAP_SOURCE_REF,
			HAIDIAN_CAMPUS_MAP_IMAGE_SOURCE_REF,
			`campus-map:projection:${input.id}`,
		],
		tags: input.tags,
		title: input.title,
	});
}

export function createFengtaiFeatureMapPlace(input: {
	category: CampusMapPlaceCategory;
	coordinates: [number, number];
	description: string;
	id: string;
	mapFeatureRefs: CampusMapFeatureRef[];
	tags: string[];
	title: string;
}) {
	return createMapPlace({
		campus: "丰台校区",
		category: input.category,
		coordinates: input.coordinates,
		description: input.description,
		id: input.id,
		mapFeatureRefs: input.mapFeatureRefs,
		tags: input.tags,
		title: input.title,
	});
}
