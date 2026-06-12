import type maplibregl from "maplibre-gl";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MapExperience } from "@/components/map/map-experience";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { getCampusMapPlaces } from "@/features/map/api";
import {
	CAMPUS_HOVER_PLACE_FILL_LAYER_ID,
	CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID,
	CAMPUS_SELECTED_PLACE_FILL_LAYER_ID,
	CAMPUS_SELECTED_PLACE_HALO_LAYER_ID,
	CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID,
	type CampusMapProfile,
	type CampusMapStyleColors,
	createCampusMapFeatureFilter,
	createCampusMapStyle,
	getCampusMapProfile,
	getDefaultCampusMapProfile,
} from "@/features/map/campus-map-style";
import {
	createFeatureRefKey,
	createHitTestBox,
	createPlaceFeatureIndex,
	findPlaceForRenderedFeature,
	INTERACTIVE_CAMPUS_MAP_LAYER_IDS,
	type MapFeatureRefKey,
} from "@/features/map/feature-selection";
import { loadMapLibre, type MapLibreRuntime } from "@/features/map/maplibre-runtime";
import type { CampusMapFeatureRef, CampusMapPlacesResponse } from "@/features/map/model";
import {
	createMapPlaceViews,
	filterMapPlaces,
	getMapCampuses,
	getMapCategories,
	type MapCategoryFilter,
	type MapPlaceView,
} from "@/features/map/view-model";

export function MapPage() {
	const mapRef = useRef<HTMLElement | null>(null);
	const mapInstanceRef = useRef<maplibregl.Map | null>(null);
	const markerRefs = useRef<maplibregl.Marker[]>([]);
	const mapMoveIntentRef = useRef<"filter" | "place">("filter");
	const mapReadyProfileRef = useRef<string | null>(null);
	const selectPlaceRef = useRef<(placeId: string) => void>(() => {
		throw new Error("Campus map place selector was not initialized.");
	});
	const clearSelectionRef = useRef<() => void>(() => {
		throw new Error("Campus map selection clearer was not initialized.");
	});
	const placeFeatureIndexRef = useRef<Map<MapFeatureRefKey, string>>(new Map());
	const placeViewsByIdRef = useRef<Map<string, MapPlaceView>>(new Map());
	const selectedFeatureRefKeySetRef = useRef<Set<MapFeatureRefKey>>(new Set());
	const [data, setData] = useState<CampusMapPlacesResponse | null>(null);
	const [mapLoaded, setMapLoaded] = useState(false);
	const [mapRuntime, setMapRuntime] = useState<MapLibreRuntime | null>(null);
	const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
	const [hoveredFeatureRefs, setHoveredFeatureRefs] = useState<CampusMapFeatureRef[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
	const [selectedCategory, setSelectedCategory] = useState<MapCategoryFilter>("all");

	const places = useMemo(() => createMapPlaceViews(data?.places ?? []), [data]);
	const campuses = useMemo(() => getMapCampuses(places), [places]);
	const selectedCampusProfile = useMemo(
		() => (selectedCampus ? getCampusMapProfile(selectedCampus) : null),
		[selectedCampus],
	);
	const campusPlaces = useMemo(
		() => (selectedCampus ? places.filter((place) => place.place.campus === selectedCampus) : []),
		[places, selectedCampus],
	);
	const categories = useMemo(() => getMapCategories(campusPlaces), [campusPlaces]);
	const placeFeatureIndex = useMemo(() => createPlaceFeatureIndex(campusPlaces), [campusPlaces]);
	const placeViewsById = useMemo(
		() => new Map(campusPlaces.map((place) => [place.place.id, place])),
		[campusPlaces],
	);
	const filteredPlaces = useMemo(
		() =>
			selectedCampus
				? filterMapPlaces(places, {
						campus: selectedCampus,
						category: selectedCategory,
						query,
					})
				: [],
		[places, query, selectedCampus, selectedCategory],
	);
	const selected = campusPlaces.find((place) => place.place.id === selectedPlaceId) ?? null;
	const selectedFeatureRefKeySet = useMemo(
		() => new Set((selected?.featureRefs ?? []).map(createFeatureRefKey)),
		[selected],
	);
	const visibleHoveredFeatureRefs = useMemo(
		() =>
			hoveredFeatureRefs.filter(
				(featureRef) => !selectedFeatureRefKeySet.has(createFeatureRefKey(featureRef)),
			),
		[hoveredFeatureRefs, selectedFeatureRefKeySet],
	);
	selectPlaceRef.current = selectPlace;
	clearSelectionRef.current = clearSelection;
	placeFeatureIndexRef.current = placeFeatureIndex;
	placeViewsByIdRef.current = placeViewsById;
	selectedFeatureRefKeySetRef.current = selectedFeatureRefKeySet;

	useEffect(() => {
		setLoading(true);
		setError(null);
		getCampusMapPlaces()
			.then((nextData) => {
				const nextCampuses = getMapCampuses(createMapPlaceViews(nextData.places));
				const initialState = readMapUrlState(nextCampuses);
				const defaultProfile =
					(initialState.campus ? getCampusMapProfile(initialState.campus) : null) ??
					getDefaultCampusMapProfile(nextCampuses);
				setData(nextData);
				setSelectedCampus(defaultProfile?.campus ?? null);
				setQuery(initialState.query);
				setSelectedCategory(initialState.category);
				setSelectedPlaceId(initialState.placeId);
			})
			.catch(() => {
				setData(null);
				setSelectedPlaceId(null);
				setError("校园地图暂时无法打开。");
			})
			.finally(() => {
				setLoading(false);
			});
	}, []);

	useEffect(() => {
		if (!(data && selectedCampusProfile?.assetUrl && mapRef.current && !mapInstanceRef.current)) {
			return;
		}

		let cancelled = false;
		loadMapLibre()
			.then((runtime) => {
				if (cancelled || !mapRef.current) {
					return;
				}
				const map = new runtime.Map({
					center: selectedCampusProfile.center,
					container: mapRef.current,
					localIdeographFontFamily: "sans-serif",
					maxBounds: selectedCampusProfile.maxBounds,
					maxZoom: selectedCampusProfile.maxZoom,
					minZoom: selectedCampusProfile.minZoom,
					style: createCampusMapStyle(readCampusMapStyleColors(), selectedCampusProfile),
					zoom: selectedCampusProfile.initialZoom,
				});
				map.addControl(new runtime.NavigationControl({ visualizePitch: true }), "top-right");
				map.addControl(new runtime.ScaleControl({ unit: "metric" }), "bottom-left");
				map.on("click", (event) => {
					const placeId = findPlaceIdAtPoint(map, event.point, placeFeatureIndexRef.current);
					if (placeId) {
						selectPlaceRef.current(placeId);
						return;
					}
					clearSelectionRef.current();
				});
				map.on("mousemove", (event) => {
					const placeId = findPlaceIdAtPoint(map, event.point, placeFeatureIndexRef.current);
					const place = placeId ? placeViewsByIdRef.current.get(placeId) : null;
					setHoveredFeatureRefs(
						place
							? place.featureRefs.filter(
									(featureRef) =>
										!selectedFeatureRefKeySetRef.current.has(createFeatureRefKey(featureRef)),
								)
							: [],
					);
					setMapCanvasCursor(map, place ? "pointer" : "");
				});
				map.on("mouseout", () => {
					setHoveredFeatureRefs([]);
					setMapCanvasCursor(map, "");
				});
				mapInstanceRef.current = map;
				mapReadyProfileRef.current = selectedCampusProfile.campus;
				map.once("load", () => {
					map.resize();
					setMapLoaded(true);
				});
				window.requestAnimationFrame(() => map.resize());
				setMapRuntime(runtime);
			})
			.catch(() => {
				setError("地图暂时无法显示。");
			});

		return () => {
			cancelled = true;
		};
	}, [data, selectedCampusProfile]);

	useEffect(
		() => () => {
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
			mapInstanceRef.current?.remove();
			mapInstanceRef.current = null;
			mapReadyProfileRef.current = null;
			setMapLoaded(false);
		},
		[],
	);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && selectedCampusProfile?.assetUrl && mapLoaded)) {
			return;
		}
		if (mapReadyProfileRef.current === selectedCampusProfile.campus) {
			return;
		}
		map.setMaxBounds(selectedCampusProfile.maxBounds);
		map.setMinZoom(selectedCampusProfile.minZoom);
		map.setMaxZoom(selectedCampusProfile.maxZoom);
		map.setStyle(createCampusMapStyle(readCampusMapStyleColors(), selectedCampusProfile));
		mapReadyProfileRef.current = selectedCampusProfile.campus;
		map.resize();
	}, [mapLoaded, selectedCampusProfile]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && mapRuntime && mapLoaded)) {
			return;
		}

		clearMapMarkers(markerRefs.current);
		markerRefs.current = filteredPlaces.filter(shouldRenderPointMarker).map((place) => {
			const marker = document.createElement("button");
			marker.className = "campus-map-marker";
			marker.type = "button";
			marker.dataset.selected = String(selected?.place.id === place.place.id);
			marker.dataset.variant = place.markerVariant;
			marker.innerHTML = `<span aria-hidden="true"></span>`;
			marker.setAttribute("aria-label", place.place.title);
			marker.addEventListener("click", (event) => {
				event.stopPropagation();
				selectPlaceRef.current(place.place.id);
			});
			return new mapRuntime.Marker({ element: marker }).setLngLat(place.coordinates).addTo(map);
		});

		return () => {
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
		};
	}, [filteredPlaces, mapLoaded, mapRuntime, selected?.place.id]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && selectedCampusProfile?.assetUrl && mapLoaded)) {
			return;
		}

		const filter = createCampusMapFeatureFilter(selected?.featureRefs ?? []);
		map.setFilter(CAMPUS_SELECTED_PLACE_FILL_LAYER_ID, filter);
		map.setFilter(CAMPUS_SELECTED_PLACE_HALO_LAYER_ID, filter);
		map.setFilter(CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID, filter);
	}, [mapLoaded, selected, selectedCampusProfile]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && selectedCampusProfile?.assetUrl && mapLoaded)) {
			return;
		}

		const filter = createCampusMapFeatureFilter(visibleHoveredFeatureRefs);
		map.setFilter(CAMPUS_HOVER_PLACE_FILL_LAYER_ID, filter);
		map.setFilter(CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID, filter);
	}, [mapLoaded, selectedCampusProfile, visibleHoveredFeatureRefs]);

	useEffect(() => {
		if (!data) {
			return;
		}
		if (selectedPlaceId && !campusPlaces.some((place) => place.place.id === selectedPlaceId)) {
			setSelectedPlaceId(null);
		}
	}, [campusPlaces, data, selectedPlaceId]);

	useEffect(() => {
		if (!(data && selectedCampus)) {
			return;
		}
		writeMapUrlState({
			category: selectedCategory,
			campus: selectedCampus,
			placeId: selectedPlaceId,
			query,
		});
	}, [data, query, selectedCampus, selectedCategory, selectedPlaceId]);

	useEffect(() => {
		if (
			!(
				mapLoaded &&
				mapInstanceRef.current &&
				selectedCampusProfile?.assetUrl &&
				filteredPlaces.length > 0 &&
				shouldFitMapForFilter({
					category: selectedCategory,
					campus: selectedCampus,
					intent: mapMoveIntentRef.current,
					query,
				})
			)
		) {
			return;
		}
		const map = mapInstanceRef.current;
		map.resize();
		const bounds = getViewportBoundsForFilteredPlaces({
			category: selectedCategory,
			profile: selectedCampusProfile,
			query,
			places: filteredPlaces,
		});
		map.fitBounds(bounds, {
			duration: 420,
			maxZoom: 16.8,
			padding: getMapViewportPadding(),
		});
	}, [filteredPlaces, mapLoaded, query, selectedCampus, selectedCampusProfile, selectedCategory]);

	useEffect(() => {
		if (!(selected && mapInstanceRef.current && mapMoveIntentRef.current === "place")) {
			return;
		}
		mapInstanceRef.current.flyTo({
			center: selected.coordinates,
			zoom: 17,
		});
	}, [selected]);

	return (
		<>
			{error ? (
				<MapStateShell>
					<ErrorPanel message={error} />
				</MapStateShell>
			) : loading ? (
				<MapStateShell>
					<LoadingPanel label="正在读取地图" />
				</MapStateShell>
			) : data && selectedCampusProfile ? (
				<MapExperience
					assetAvailable={Boolean(selectedCampusProfile.assetUrl)}
					campuses={campuses}
					categories={categories}
					category={selectedCategory}
					campus={selectedCampus ?? ""}
					campusNotice={getCampusMapExperienceNotice(selectedCampus)}
					filteredPlaces={filteredPlaces}
					mapRef={mapRef}
					onCanvasClick={clearSelection}
					onCategoryChange={selectCategory}
					onCampusChange={selectCampus}
					onPlaceSelect={selectPlace}
					onQueryChange={searchPlaces}
					onResetViewport={resetCampusViewport}
					query={query}
					selectedPlace={selected}
				/>
			) : (
				<MapStateShell>
					<EmptyPanel message="当前没有可展示的地图地点。" />
				</MapStateShell>
			)}
		</>
	);

	function selectCampus(nextCampus: string) {
		mapMoveIntentRef.current = "filter";
		setHoveredFeatureRefs([]);
		if (mapInstanceRef.current) {
			setMapCanvasCursor(mapInstanceRef.current, "");
		}
		setSelectedCampus(nextCampus);
		setSelectedCategory("all");
		setSelectedPlaceId(null);
		const nextProfile = getCampusMapProfile(nextCampus);
		if (!nextProfile.assetUrl) {
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
			mapInstanceRef.current?.remove();
			mapInstanceRef.current = null;
			mapReadyProfileRef.current = null;
			setMapLoaded(false);
		}
	}

	function selectCategory(nextCategory: MapCategoryFilter) {
		mapMoveIntentRef.current = "filter";
		setSelectedCategory(nextCategory);
	}

	function searchPlaces(nextQuery: string) {
		mapMoveIntentRef.current = "filter";
		setQuery(nextQuery);
		setSelectedPlaceId(null);
	}

	function selectPlace(placeId: string) {
		mapMoveIntentRef.current = "place";
		setSelectedPlaceId(placeId);
	}

	function clearSelection() {
		setSelectedPlaceId(null);
	}

	function resetCampusViewport() {
		const map = mapInstanceRef.current;
		if (!(map && selectedCampusProfile?.assetUrl)) {
			return;
		}
		mapMoveIntentRef.current = "filter";
		map.fitBounds(selectedCampusProfile.maxBounds, {
			duration: 420,
			maxZoom: 16.8,
			padding: getMapViewportPadding(),
		});
	}
}

function getCampusMapExperienceNotice(campus: string | null) {
	if (campus === "海淀校区") {
		return "海淀校区地图为基础参考版。";
	}
	return null;
}

function shouldFitMapForFilter(input: {
	category: MapCategoryFilter;
	campus: string | null;
	intent: "filter" | "place";
	query: string;
}) {
	return (
		input.intent === "filter" &&
		(input.campus !== null || input.category !== "all" || input.query.trim().length > 0)
	);
}

function clearMapMarkers(markers: maplibregl.Marker[]) {
	for (const marker of markers) {
		marker.remove();
	}
}

function shouldRenderPointMarker(place: { usesFeatureHighlight: boolean }) {
	return !place.usesFeatureHighlight;
}

function findPlaceIdAtPoint(
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

function setMapCanvasCursor(map: maplibregl.Map, cursor: "" | "pointer") {
	const canvas = map.getCanvas();
	canvas.style.cursor = cursor;
}

function getViewportBoundsForFilteredPlaces(input: {
	category: MapCategoryFilter;
	profile: CampusMapProfile;
	query: string;
	places: Array<{ coordinates: [number, number] }>;
}) {
	if (input.profile.assetUrl && input.category === "all" && input.query.trim().length === 0) {
		return input.profile.maxBounds;
	}

	return getMapPlaceBounds(input.places);
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

function readCampusMapStyleColors(): CampusMapStyleColors {
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

function getMapViewportPadding() {
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

function MapStateShell({ children }: { children: ReactNode }) {
	return (
		<section className="grid min-h-dvh place-items-center bg-[var(--map-canvas-bg)] p-6">
			<div className="w-full max-w-md">{children}</div>
		</section>
	);
}

function readMapUrlState(campuses: string[]) {
	if (typeof window === "undefined") {
		return {
			campus: null,
			category: "all" as MapCategoryFilter,
			placeId: null,
			query: "",
		};
	}
	const params = new URLSearchParams(window.location.search);
	const campusSlug = params.get("campus");
	const campus = campusSlug ? findCampusBySlug(campuses, campusSlug) : null;
	return {
		campus,
		category: readMapCategoryParam(params.get("category")),
		placeId: params.get("place"),
		query: params.get("q") ?? "",
	};
}

function writeMapUrlState(input: {
	category: MapCategoryFilter;
	campus: string;
	placeId: string | null;
	query: string;
}) {
	if (typeof window === "undefined") {
		return;
	}
	const params = new URLSearchParams();
	params.set("campus", slugCampus(input.campus));
	if (input.category !== "all") {
		params.set("category", input.category);
	}
	const trimmedQuery = input.query.trim();
	if (trimmedQuery) {
		params.set("q", trimmedQuery);
	}
	if (input.placeId) {
		params.set("place", input.placeId);
	}
	const nextSearch = params.toString();
	const nextUrl = nextSearch ? `/map?${nextSearch}` : "/map";
	if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
		window.history.replaceState({}, "", nextUrl);
	}
}

function readMapCategoryParam(value: string | null): MapCategoryFilter {
	switch (value) {
		case "building":
		case "gate":
		case "landmark":
		case "service":
		case "transport":
			return value;
		default:
			return "all";
	}
}

function findCampusBySlug(campuses: string[], slug: string) {
	return campuses.find((campus) => slugCampus(campus) === slug) ?? null;
}

function slugCampus(campus: string) {
	switch (campus) {
		case "海淀校区":
			return "haidian";
		case "丰台校区":
			return "fengtai";
		default:
			throw new Error(`Unsupported campus map campus: ${campus}`);
	}
}
