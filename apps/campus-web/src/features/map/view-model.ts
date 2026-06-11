import type { CampusMapFeatureRef, CampusMapPlace, CampusMapPlaceCategory } from "./model";

export interface MapPlaceView {
	category: CampusMapPlaceCategory;
	categoryLabel: string;
	coordinates: [number, number];
	detailRows: Array<{ label: string; value: string }>;
	displayTags: string[];
	featureRefs: CampusMapFeatureRef[];
	markerVariant: MapMarkerVariant;
	place: CampusMapPlace;
	searchText: string;
	usesFeatureHighlight: boolean;
}

export interface MapSelectionState {
	category: CampusMapPlaceCategory | "all";
	campus: string;
	query: string;
	selectedPlaceId: string | null;
}

export type MapCategoryFilter = CampusMapPlaceCategory | "all";
export type MapMarkerVariant =
	| "building"
	| "dining"
	| "gate"
	| "landmark"
	| "service"
	| "transport";

export function createMapPlaceViews(places: CampusMapPlace[]): MapPlaceView[] {
	return places.map((place) => {
		const categoryLabel = formatCategoryLabel(place.category);
		const displayTags = Array.from(new Set([categoryLabel, ...place.tags]));
		const detailRows = [
			{ label: "校区", value: place.campus },
			{ label: "类型", value: categoryLabel },
			...(place.accessNote ? [{ label: "到达提示", value: place.accessNote }] : []),
		];
		return {
			category: place.category,
			categoryLabel,
			coordinates: place.geojson.geometry.coordinates,
			detailRows,
			displayTags,
			featureRefs: place.mapFeatureRefs ?? [],
			markerVariant: getMarkerVariant(place),
			place,
			searchText: [place.title, place.description, place.campus, ...place.tags]
				.join(" ")
				.toLowerCase(),
			usesFeatureHighlight: shouldUseFeatureHighlight(place),
		};
	});
}

export function filterMapPlaces(
	places: MapPlaceView[],
	input: {
		category: MapCategoryFilter;
		campus: string;
		query: string;
	},
) {
	const normalizedQuery = input.query.trim().toLowerCase();
	return places.filter((place) => {
		if (place.place.campus !== input.campus) {
			return false;
		}
		if (input.category !== "all" && place.category !== input.category) {
			return false;
		}
		return !normalizedQuery || place.searchText.includes(normalizedQuery);
	});
}

export function getMapCampuses(places: MapPlaceView[]) {
	return Array.from(new Set(places.map((place) => place.place.campus)));
}

export function getMapCategories(places: MapPlaceView[]) {
	const categories = Array.from(new Set(places.map((place) => place.category)));
	return categories.map((category) => ({
		label: formatCategoryLabel(category),
		value: category,
	}));
}

function formatCategoryLabel(category: CampusMapPlaceCategory) {
	switch (category) {
		case "building":
			return "建筑";
		case "gate":
			return "校门";
		case "landmark":
			return "地标";
		case "service":
			return "服务";
		case "transport":
			return "交通";
		default: {
			const unreachable: never = category;
			throw new Error(`Unsupported campus map category: ${unreachable}`);
		}
	}
}

function getMarkerVariant(place: CampusMapPlace): MapMarkerVariant {
	if (place.tags.includes("食堂")) {
		return "dining";
	}
	return place.category;
}

function shouldUseFeatureHighlight(place: CampusMapPlace) {
	return place.category === "building" && (place.mapFeatureRefs?.length ?? 0) > 0;
}
