import type { ExpressionSpecification, FilterSpecification, StyleSpecification } from "maplibre-gl";
import type { CampusMapFeatureRef, CampusMapManifest } from "./model";

export const CAMPUS_SELECTED_PLACE_FILL_LAYER_ID = "campus-place-selected-fill";
export const CAMPUS_SELECTED_PLACE_HALO_LAYER_ID = "campus-place-selected-halo";
export const CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID = "campus-place-selected-outline";
export const CAMPUS_HOVER_PLACE_FILL_LAYER_ID = "campus-place-hover-fill";
export const CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID = "campus-place-hover-outline";
export const EMPTY_CAMPUS_MAP_FEATURE_FILTER: ExpressionSpecification = ["==", ["get", "fid"], -1];
export const CAMPUS_GATEHOUSE_SELECTED_LAYER_ID = "campus-gatehouse-selected";
const GATEHOUSE_FIDS = [57, 60] as const;
const GATEHOUSE_MARKER_FILTER: FilterSpecification = [
	"all",
	["==", ["get", "layer"], "building"],
	["in", ["get", "fid"], ["literal", [...GATEHOUSE_FIDS]]],
];
const BUILDING_LABEL_FILTER: FilterSpecification = [
	"all",
	["has", "name"],
	["==", ["get", "layer"], "building"],
	["!", ["in", ["get", "name"], ["literal", ["北门门卫", "南门门卫"]]]],
];
const GATEHOUSE_LABEL_FILTERS: Record<string, FilterSpecification> = {
	"campus-north-gatehouse-label": [
		"all",
		["==", ["get", "layer"], "building"],
		["==", ["get", "fid"], 57],
	],
	"campus-south-gatehouse-label": [
		"all",
		["==", ["get", "layer"], "building"],
		["==", ["get", "fid"], 60],
	],
};
export const CAMPUS_MAP_SCALE_BAR_METERS = 200;
const CAMPUS_MAP_SCALE_BAR_WIDTH_PX = 100;
const CAMPUS_MAP_SCALE_BAR_ANCHOR_METERS = 250;
const EARTH_METERS_PER_PIXEL_AT_ZOOM_0 = 78271.51696402048;
const METERS_PER_DEGREE_LATITUDE = 110574;
const METERS_PER_DEGREE_LONGITUDE = 111320;

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
			initialZoom: getCampusMapScaleZoom((campus.bounds[1] + campus.bounds[3]) / 2),
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

export function getCampusMapScaleZoom(latitude: number): number {
	const metersPerPixel = CAMPUS_MAP_SCALE_BAR_ANCHOR_METERS / CAMPUS_MAP_SCALE_BAR_WIDTH_PX;
	const latitudeScale = Math.cos((latitude * Math.PI) / 180);
	return Math.log2((EARTH_METERS_PER_PIXEL_AT_ZOOM_0 * latitudeScale) / metersPerPixel);
}

export function getCampusMapMetersPerPixel(
	profile: CampusMapProfile,
	zoom = profile.initialZoom,
): number {
	return (
		(EARTH_METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((profile.center[1] * Math.PI) / 180)) / 2 ** zoom
	);
}

export function getCampusMapPanBounds(
	profile: CampusMapProfile,
	viewport: { height: number; width: number },
): [[number, number], [number, number]] {
	const [[minLng, minLat], [maxLng, maxLat]] = profile.maxBounds;
	const centerLng = (minLng + maxLng) / 2;
	const centerLat = (minLat + maxLat) / 2;
	const metersPerPixel = getCampusMapMetersPerPixel(profile, profile.minZoom);
	const latitudeScale = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
	const halfLng = Math.max(
		(maxLng - minLng) / 2,
		((viewport.width / 2) * metersPerPixel * 1.02) / (METERS_PER_DEGREE_LONGITUDE * latitudeScale),
	);
	const halfLat = Math.max(
		(maxLat - minLat) / 2,
		((viewport.height / 2) * metersPerPixel * 1.02) / METERS_PER_DEGREE_LATITUDE,
	);
	return [
		[centerLng - halfLng, centerLat - halfLat],
		[centerLng + halfLng, centerLat + halfLat],
	];
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
					"fill-color": createBuildingFillExpression(colors.buildingFill),
					"fill-opacity": 0.94,
					"fill-outline-color": createBuildingOutlineExpression(colors.buildingOutline),
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
				id: CAMPUS_GATEHOUSE_SELECTED_LAYER_ID,
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
					"fill-opacity": 0.84,
					"fill-outline-color": createSportSurfaceOutlineExpression(colors.buildingOutline),
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
					"text-allow-overlap": false,
					"text-field": ["get", "name"] as ExpressionSpecification,
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
			...Object.entries(GATEHOUSE_LABEL_FILTERS).map(
				([id, filter]) =>
					({
						filter: profile.campus === "丰台校区" ? filter : EMPTY_CAMPUS_MAP_FEATURE_FILTER,
						id,
						layout: {
							"text-anchor":
								id === "campus-north-gatehouse-label" ? ("bottom" as const) : ("top" as const),
							"text-allow-overlap": true,
							"text-field": ["get", "name"] as ExpressionSpecification,
							"text-font": ["Open Sans Regular"],
							"text-ignore-placement": true,
							"text-offset": (id === "campus-north-gatehouse-label" ? [0, -1.2] : [0, 1.2]) as [
								number,
								number,
							],
							"text-size": 12,
						},
						paint: {
							"text-color": colors.label,
							"text-halo-color": colors.background,
							"text-halo-width": 1.2,
						},
						source: profile.sourceId,
						type: "symbol" as const,
					}) as StyleSpecification["layers"][number],
			),
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

export function selectGatehouseFeatureRefs(
	featureRefs: CampusMapFeatureRef[],
): CampusMapFeatureRef[] {
	return featureRefs.filter(
		(featureRef) =>
			featureRef.layer === "building" &&
			(GATEHOUSE_FIDS as readonly number[]).includes(featureRef.fid),
	);
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

function createBuildingFillExpression(fallback: string): ExpressionSpecification {
	return [
		"case",
		["==", ["get", "category"], "体育场地"],
		createSportSurfaceColorExpression("#4eae5b"),
		createCategoryColorExpression(fallback),
	] as ExpressionSpecification;
}

function createBuildingOutlineExpression(fallback: string): ExpressionSpecification {
	return [
		"case",
		["==", ["get", "category"], "体育场地"],
		createSportSurfaceOutlineExpression("#27703d"),
		createCategoryColorExpression(fallback, true),
	] as ExpressionSpecification;
}

function createSportSurfaceColorExpression(fallback: string): ExpressionSpecification {
	return [
		"case",
		["==", ["get", "surface"], "track-infield"],
		"#4eae5b",
		[
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
		],
	] as ExpressionSpecification;
}

function createSportSurfaceOutlineExpression(fallback: string): ExpressionSpecification {
	return [
		"case",
		["==", ["get", "surface"], "track-infield"],
		"#27703d",
		[
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
		],
	] as ExpressionSpecification;
}
