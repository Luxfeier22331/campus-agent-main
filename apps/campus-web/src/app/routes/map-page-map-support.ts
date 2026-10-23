import type * as maplibregl from "maplibre-gl";
import {
	type CampusMapProfile,
	type CampusMapStyleColors,
	getCampusMapProfile,
} from "@/features/map/campus-map-style";
import {
	createHitTestBox,
	findPlaceForRenderedFeature,
	INTERACTIVE_CAMPUS_MAP_LAYER_IDS,
	type MapFeatureRefKey,
} from "@/features/map/feature-selection";
import type { MapTaskFilter } from "@/features/map/view-model";

export function getCampusMapExperienceNotice(campus: string | null) {
	if (campus === "海淀校区") {
		return "海淀校区当前提供基础地点参考。";
	}
	return null;
}

export function shouldFitMapForFilter(input: {
	category: MapTaskFilter;
	campus: string | null;
	intent: "filter" | "place";
	query: string;
}) {
	return (
		input.intent === "filter" &&
		(input.campus !== null || input.category !== "all" || input.query.trim().length > 0)
	);
}

export function clearMapMarkers(markers: maplibregl.Marker[]) {
	for (const marker of markers) {
		marker.remove();
	}
}

export function shouldRenderPointMarker(place: { usesFeatureHighlight: boolean }) {
	return !place.usesFeatureHighlight;
}

export function findPlaceIdAtPoint(
	map: maplibregl.Map,
	point: { x: number; y: number },
	index: Map<MapFeatureRefKey, string>,
) {
	const features = map.queryRenderedFeatures(createHitTestBox(point), {
		layers: [...INTERACTIVE_CAMPUS_MAP_LAYER_IDS],
	});
	for (const feature of features) {
		const placeId = findPlaceForRenderedFeature(index, feature);
		if (placeId) {
			return placeId;
		}
	}
	return null;
}

export function setMapCanvasCursor(map: maplibregl.Map, cursor: "" | "pointer") {
	const canvas = map.getCanvas();
	canvas.style.cursor = cursor;
}

export function getViewportBoundsForFilteredPlaces(input: {
	category: MapTaskFilter;
	profile: CampusMapProfile;
	query: string;
	places: Array<{ coordinates: [number, number] }>;
}) {
	if (input.category === "all" && input.query.trim().length === 0) {
		return input.profile.maxBounds;
	}

	return getMapPlaceBounds(input.places);
}

export function assertMapProfilesCoverCampuses(profiles: CampusMapProfile[], campuses: string[]) {
	for (const campus of campuses) {
		getCampusMapProfile(profiles, campus);
	}
}

function getMapPlaceBounds(places: Array<{ coordinates: [number, number] }>) {
	let minLng = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLng = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;
	for (const place of places) {
		const [lng, lat] = place.coordinates;
		minLng = Math.min(minLng, lng);
		minLat = Math.min(minLat, lat);
		maxLng = Math.max(maxLng, lng);
		maxLat = Math.max(maxLat, lat);
	}

	if (minLng === maxLng && minLat === maxLat) {
		const pointPadding = 0.001;
		return [
			[minLng - pointPadding, minLat - pointPadding],
			[maxLng + pointPadding, maxLat + pointPadding],
		] satisfies [[number, number], [number, number]];
	}

	return padMapBounds([minLng, minLat, maxLng, maxLat], 0.5, 0.00055);
}

function padMapBounds(bounds: [number, number, number, number], ratio: number, minPadding: number) {
	const [minLng, minLat, maxLng, maxLat] = bounds;
	const lngPadding = Math.max((maxLng - minLng) * ratio, minPadding);
	const latPadding = Math.max((maxLat - minLat) * ratio, minPadding);
	return [
		[minLng - lngPadding, minLat - latPadding],
		[maxLng + lngPadding, maxLat + latPadding],
	] satisfies [[number, number], [number, number]];
}

export function readCampusMapStyleColors(): CampusMapStyleColors {
	return {
		background: readRequiredCssToken("--map-style-background"),
		boundary: readRequiredCssToken("--map-style-boundary"),
		buildingFill: readRequiredCssToken("--map-style-building-fill"),
		buildingOutline: readRequiredCssToken("--map-style-building-outline"),
		greenFill: readRequiredCssToken("--map-style-green-fill"),
		label: readRequiredCssToken("--map-style-label"),
		roadFill: readRequiredCssToken("--map-style-road-fill"),
		selectionFill: readRequiredCssToken("--map-style-selection-fill"),
		selectionHalo: readRequiredCssToken("--map-style-selection-halo"),
		selectionOutline: readRequiredCssToken("--map-style-selection-outline"),
		sportFill: readRequiredCssToken("--map-style-sport-fill"),
	};
}

function readRequiredCssToken(tokenName: string) {
	const value = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
	if (!value) {
		throw new Error(`Missing CSS token: ${tokenName}`);
	}
	return value;
}

export function getMapViewportPadding() {
	if (window.matchMedia("(min-width: 960px)").matches) {
		return {
			bottom: 80,
			left: 360,
			right: 96,
			top: 96,
		};
	}
	return 56;
}
