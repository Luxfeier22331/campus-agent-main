import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
import type { CampusMapFeatureRef, CampusMapManifest } from "./model";

export const CAMPUS_SELECTED_PLACE_FILL_LAYER_ID = "campus-place-selected-fill";
export const CAMPUS_SELECTED_PLACE_HALO_LAYER_ID = "campus-place-selected-halo";
export const CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID = "campus-place-selected-outline";
export const CAMPUS_HOVER_PLACE_FILL_LAYER_ID = "campus-place-hover-fill";
export const CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID = "campus-place-hover-outline";
export const EMPTY_CAMPUS_MAP_FEATURE_FILTER: ExpressionSpecification = ["==", ["get", "fid"], -1];
export interface CampusMapProfile {
	assetUrl: string;
	bounds: [number, number, number, number];
	campus: string;
	center: [number, number];
	initialZoom: number;
	maxBounds: [[number, number], [number, number]];
	maxZoom: number;
	minZoom: number;
	sourceId: string;
}

export interface CampusMapStyleColors {
	background: string;
	boundary: string;
	buildingFill: string;
	buildingOutline: string;
	greenFill: string;
	label: string;
	roadFill: string;
	selectionFill: string;
	selectionHalo: string;
	selectionOutline: string;
	sportFill: string;
}

export function createCampusMapProfilesFromManifest(
	manifest: CampusMapManifest,
): CampusMapProfile[] {
	return Object.entries(manifest.campuses).map(([campusId, campus]) =>
		createCampusMapProfile({
			assetUrl: campus.geojsonUrl,
			bounds: campus.bounds,
			campus: campus.name,
			initialZoom: 15.8,
			maxZoom: 20.2,
			minZoom: 12.8,
			sourceId: `${campusId}-campus`,
		}),
	);
}

export function getCampusMapProfile(profiles: CampusMapProfile[], campus: string) {
	const profile = profiles.find((item) => item.campus === campus);
	if (!profile) {
		throw new Error(`Missing campus map profile: ${campus}`);
	}
	return profile;
}

export function getDefaultCampusMapProfile(profiles: CampusMapProfile[], campuses: string[]) {
	return campuses.map((campus) => getCampusMapProfile(profiles, campus))[0] ?? null;
}

export function createCampusMapStyle(
	colors: CampusMapStyleColors,
	profile: CampusMapProfile,
): StyleSpecification {
	const layers: StyleSpecification["layers"] = [
		{
			id: "background",
			paint: {
				"background-color": colors.background,
			},
			type: "background",
		},
	];

	return {
		layers: [
			...layers,
			{
				filter: ["==", ["get", "layer"], "green"],
				id: "campus-green",
				paint: {
					"fill-color": colors.greenFill,
					"fill-opacity": 0.86,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: ["==", ["get", "layer"], "roadp"],
				id: "campus-road",
				paint: {
					"fill-color": colors.roadFill,
					"fill-opacity": 0.92,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: ["==", ["get", "layer"], "building"],
				id: "campus-building",
				paint: {
					"fill-color": colors.buildingFill,
					"fill-opacity": 0.94,
					"fill-outline-color": colors.buildingOutline,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: ["==", ["get", "layer"], "sport"],
				id: "campus-sport",
				paint: {
					"fill-color": colors.sportFill,
					"fill-opacity": 0.84,
					"fill-outline-color": colors.buildingOutline,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: CAMPUS_HOVER_PLACE_FILL_LAYER_ID,
				paint: {
					"fill-color": colors.selectionFill,
					"fill-opacity": 0.62,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID,
				paint: {
					"line-color": colors.selectionOutline,
					"line-opacity": 0.72,
					"line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.4, 17, 2.1, 20, 3],
				},
				source: profile.sourceId,
				type: "line",
			},
			{
				filter: EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: CAMPUS_SELECTED_PLACE_FILL_LAYER_ID,
				paint: {
					"fill-color": colors.selectionFill,
					"fill-opacity": 1,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: CAMPUS_SELECTED_PLACE_HALO_LAYER_ID,
				paint: {
					"line-blur": 0.6,
					"line-color": colors.selectionHalo,
					"line-opacity": 0.94,
					"line-width": ["interpolate", ["linear"], ["zoom"], 14, 5.2, 17, 7.2, 20, 10],
				},
				source: profile.sourceId,
				type: "line",
			},
			{
				filter: EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID,
				paint: {
					"line-color": colors.selectionOutline,
					"line-opacity": 0.98,
					"line-width": ["interpolate", ["linear"], ["zoom"], 14, 2.4, 17, 3.4, 20, 4.8],
				},
				source: profile.sourceId,
				type: "line",
			},
			{
				filter: ["==", ["get", "layer"], "boundary"],
				id: "campus-boundary",
				paint: {
					"line-color": colors.boundary,
					"line-opacity": 0.92,
					"line-width": 2,
				},
				source: profile.sourceId,
				type: "line",
			},
			{
				filter: ["all", ["has", "name"], ["==", ["get", "layer"], "building"]],
				id: "campus-building-labels",
				layout: {
					"text-allow-overlap": false,
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Regular"],
					"text-size": ["interpolate", ["linear"], ["zoom"], 14, 0, 15.5, 10, 17, 12, 19, 13],
				},
				paint: {
					"text-color": colors.label,
					"text-halo-color": colors.background,
					"text-halo-width": 1.2,
				},
				source: profile.sourceId,
				type: "symbol",
			},
		],
		sources: {
			[profile.sourceId]: {
				data: profile.assetUrl,
				type: "geojson",
			},
		},
		version: 8,
	};
}

export function createCampusMapFeatureFilter(
	featureRefs: CampusMapFeatureRef[],
): FilterSpecification {
	if (featureRefs.length === 0) {
		return EMPTY_CAMPUS_MAP_FEATURE_FILTER;
	}

	if (featureRefs.length === 1) {
		const [featureRef] = featureRefs;
		return createSingleFeatureFilter(featureRef);
	}

	return ["any", ...featureRefs.map(createSingleFeatureFilter)];
}

function createSingleFeatureFilter(featureRef: CampusMapFeatureRef): ExpressionSpecification {
	return [
		"all",
		["==", ["get", "layer"], featureRef.layer],
		["==", ["get", "fid"], featureRef.fid],
	];
}

function createCampusMapProfile(input: {
	assetUrl: string;
	bounds: [number, number, number, number];
	campus: string;
	initialZoom: number;
	maxZoom: number;
	minZoom: number;
	sourceId: string;
}): CampusMapProfile {
	const maxBounds = padBounds(input.bounds, 0.36, 0.0014);
	return {
		...input,
		center: [(input.bounds[0] + input.bounds[2]) / 2, (input.bounds[1] + input.bounds[3]) / 2],
		maxBounds,
	};
}

function padBounds(
	bounds: [number, number, number, number],
	ratio: number,
	minPadding: number,
): [[number, number], [number, number]] {
	const [minLng, minLat, maxLng, maxLat] = bounds;
	const lngPadding = Math.max((maxLng - minLng) * ratio, minPadding);
	const latPadding = Math.max((maxLat - minLat) * ratio, minPadding);
	return [
		[minLng - lngPadding, minLat - latPadding],
		[maxLng + lngPadding, maxLat + latPadding],
	];
}
