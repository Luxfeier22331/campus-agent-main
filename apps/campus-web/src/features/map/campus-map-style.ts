import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
import type { CampusMapFeatureRef, CampusMapManifest } from "./model";

export const CAMPUS_SELECTED_PLACE_FILL_LAYER_ID = "campus-place-selected-fill";
export const CAMPUS_SELECTED_PLACE_HALO_LAYER_ID = "campus-place-selected-halo";
export const CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID = "campus-place-selected-outline";
export const CAMPUS_HOVER_PLACE_FILL_LAYER_ID = "campus-place-hover-fill";
export const CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID = "campus-place-hover-outline";
export const EMPTY_CAMPUS_MAP_FEATURE_FILTER: ExpressionSpecification = ["==", ["get", "fid"], -1];
const GATEHOUSE_MARKER_FILTER = [
	"all",
	["==", ["get", "layer"], "building"],
	["in", ["get", "fid"], ["literal", [57, 60]]],
] as unknown as FilterSpecification;
const BUILDING_LABEL_FILTER = [
	"all",
	["has", "name"],
	["==", ["get", "layer"], "building"],
	["!in", ["get", "name"], ["literal", ["北门门卫", "南门门卫"]]],
] as unknown as FilterSpecification;
const NORTH_GATEHOUSE_FILTER = [
	"all",
	["has", "name"],
	["==", ["get", "layer"], "building"],
	["==", ["get", "fid"], 57],
] as unknown as FilterSpecification;
const SOUTH_GATEHOUSE_FILTER = [
	"all",
	["has", "name"],
	["==", ["get", "layer"], "building"],
	["==", ["get", "fid"], 60],
] as unknown as FilterSpecification;
export interface CampusMapProfile {
	assetUrl: string;
	attribution: string;
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
			attribution: manifest.attribution.join(" · "),
			bounds: campus.bounds,
			campus: campus.name,
			initialZoom: campusId === "fengtai" ? 16 : 15.8,
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
					"fill-opacity": 0.96,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: ["==", ["get", "layer"], "roadp"],
				id: "campus-road-outline",
				paint: {
					"line-color": "rgba(117,130,122,0.88)",
					"line-width": 0.9,
				},
				source: profile.sourceId,
				type: "line",
			},
			{
				filter: ["==", ["get", "layer"], "building"],
				id: "campus-building",
				paint: {
					"fill-color": createCategoryColorExpression(colors.buildingFill),
					"fill-opacity": 0.94,
					"fill-outline-color": createCategoryColorExpression(colors.buildingOutline, true),
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter:
					profile.campus === "丰台校区" ? GATEHOUSE_MARKER_FILTER : EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: "campus-gatehouse-markers",
				paint: {
					"circle-color": [
						"match",
						["get", "name"],
						"北门门卫",
						"#4c9dc7",
						"南门门卫",
						"#e8784c",
						colors.buildingFill,
					],
					"circle-radius": 5,
					"circle-stroke-color": colors.buildingOutline,
					"circle-stroke-width": 1.5,
				},
				source: profile.sourceId,
				type: "circle",
			},
			{
				filter: EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: "campus-gatehouse-selected",
				paint: {
					"circle-color": colors.selectionFill,
					"circle-radius": 9,
					"circle-stroke-color": colors.selectionOutline,
					"circle-stroke-width": 2.5,
				},
				source: profile.sourceId,
				type: "circle",
			},
			{
				filter: ["==", ["get", "layer"], "sport"],
				id: "campus-sport",
				paint: {
					"fill-color": createSportSurfaceColorExpression(colors.sportFill),
					"fill-opacity": 0.98,
					"fill-outline-color": createSportSurfaceOutlineExpression(colors.buildingOutline),
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: [
					"all",
					["==", ["get", "layer"], "sport"],
					["!=", ["get", "name"], "气膜馆"],
					["!=", ["get", "name"], "田径场"],
				],
				id: "campus-sport-pattern",
				paint: {
					"fill-pattern": createSportPatternExpression(),
					"fill-pattern-transition": { duration: 0, delay: 0 },
					"fill-opacity": 0.98,
				},
				source: profile.sourceId,
				type: "fill",
			},
			{
				filter: [
					"all",
					["==", ["get", "layer"], "building"],
					["==", ["get", "category"], "体育场地"],
					["!=", ["get", "name"], "气膜馆"],
					["!=", ["get", "name"], "田径场"],
				],
				id: "campus-building-sport-pattern",
				paint: {
					"fill-pattern": createSportPatternExpression(),
					"fill-pattern-transition": { duration: 0, delay: 0 },
					"fill-opacity": 0.98,
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
				filter: BUILDING_LABEL_FILTER,
				id: "campus-building-labels",
				layout: {
					"text-allow-overlap": true,
					"text-field": ["get", "name"],
					"text-ignore-placement": true,
					"text-font": ["Open Sans Regular"],
					"text-size": 12,
				},
				paint: {
					"text-color": colors.label,
					"text-halo-color": colors.background,
					"text-halo-width": 1.2,
				},
				source: profile.sourceId,
				type: "symbol",
			},
			{
				filter:
					profile.campus === "丰台校区" ? NORTH_GATEHOUSE_FILTER : EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: "campus-north-gatehouse-label",
				layout: {
					"text-anchor": "bottom",
					"text-allow-overlap": true,
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Regular"],
					"text-ignore-placement": true,
					"text-offset": [0, -1.2],
					"text-size": 12,
				},
				paint: {
					"text-color": colors.label,
					"text-halo-color": colors.background,
					"text-halo-width": 1.2,
				},
				source: profile.sourceId,
				type: "symbol",
			},
			{
				filter:
					profile.campus === "丰台校区" ? SOUTH_GATEHOUSE_FILTER : EMPTY_CAMPUS_MAP_FEATURE_FILTER,
				id: "campus-south-gatehouse-label",
				layout: {
					"text-anchor": "top",
					"text-allow-overlap": true,
					"text-field": ["get", "name"],
					"text-font": ["Open Sans Regular"],
					"text-ignore-placement": true,
					"text-offset": [0, 1.2],
					"text-size": 12,
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
				attribution: profile.attribution,
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
	const featureRef = featureRefs[0];
	if (!featureRef) {
		return EMPTY_CAMPUS_MAP_FEATURE_FILTER;
	}

	if (featureRefs.length === 1) {
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
	attribution: string;
	bounds: [number, number, number, number];
	campus: string;
	initialZoom: number;
	maxZoom: number;
	minZoom: number;
	sourceId: string;
}): CampusMapProfile {
	const maxBounds =
		input.campus === "丰台校区"
			? ([
					[input.bounds[0], input.bounds[1]],
					[input.bounds[2], input.bounds[3]],
				] satisfies [[number, number], [number, number]])
			: padBounds(input.bounds, 0.36, 0.0014);
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

const BUILDING_CATEGORY_COLORS = [
	["教学科研", "#6688a8"],
	["住宿生活", "#df8b77"],
	["餐饮", "#75a879"],
	["公共文化", "#d0ae58"],
	["医疗服务", "#59a8a1"],
	["商业服务", "#ad82aa"],
	["校园设施", "#93a1a8"],
	["出入口安保", "#c9844f"],
	["体育场地", "#4eae5b"],
	["综合/待核", "#a6a09a"],
	["附属/待核", "#b8ad89"],
] as const;

function createCategoryColorExpression(fallback: string, outline = false): ExpressionSpecification {
	const categoryColors = outline
		? [
				["教学科研", "#45647f"],
				["住宿生活", "#a85d4b"],
				["餐饮", "#4c7951"],
				["公共文化", "#967b36"],
				["医疗服务", "#397d77"],
				["商业服务", "#7a5878"],
				["校园设施", "#65747c"],
				["出入口安保", "#925c32"],
				["体育场地", "#27703d"],
				["综合/待核", "#736d68"],
				["附属/待核", "#847a5c"],
			]
		: BUILDING_CATEGORY_COLORS;
	return [
		"match",
		["get", "category"],
		...categoryColors.flat(),
		fallback,
	] as unknown as ExpressionSpecification;
}

function createSportSurfaceColorExpression(fallback: string): ExpressionSpecification {
	return [
		"match",
		["get", "name"],
		"田径场",
		"#c77963",
		"篮球场",
		"#76bfc9",
		"排球场",
		"#76bfc9",
		"网球场",
		"#76bfc9",
		"气膜馆",
		"#b8cddc",
		fallback,
	] as ExpressionSpecification;
}

function createSportSurfaceOutlineExpression(fallback: string): ExpressionSpecification {
	return [
		"match",
		["get", "name"],
		"田径场",
		"#8d4c3b",
		"篮球场",
		"#337784",
		"排球场",
		"#337784",
		"网球场",
		"#337784",
		"气膜馆",
		"#5c7c94",
		fallback,
	] as ExpressionSpecification;
}

function createSportPatternExpression(): ExpressionSpecification {
	return [
		"match",
		["get", "name"],
		"篮球场",
		"sports-court",
		"排球场",
		"sports-court",
		"网球场",
		"sports-court",
		"sports-turf",
	] as ExpressionSpecification;
}

export function createCampusMapPatternImage(name: string): ImageData | null {
	if (!["sports-turf", "sports-court"].includes(name)) {
		return null;
	}
	const canvas = document.createElement("canvas");
	canvas.width = 16;
	canvas.height = 16;
	const context = canvas.getContext("2d");
	if (!context) {
		return null;
	}
	if (name === "sports-turf") {
		context.fillStyle = "#4eae5b";
		context.fillRect(0, 0, 16, 16);
		context.fillStyle = "#d9f2bf";
		context.fillRect(0, 0, 16, 2);
	} else {
		context.fillStyle = "#76bfc9";
		context.fillRect(0, 0, 16, 16);
		context.strokeStyle = "#d4edf0";
		context.globalAlpha = 0.65;
		context.lineWidth = 0.8;
		context.beginPath();
		context.moveTo(-8, 8);
		context.lineTo(8, 24);
		context.moveTo(0, 0);
		context.lineTo(16, 16);
		context.moveTo(8, -8);
		context.lineTo(24, 8);
		context.stroke();
	}
	return context.getImageData(0, 0, 16, 16);
}
