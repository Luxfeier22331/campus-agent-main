import type * as maplibregl from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	CAMPUS_GATEHOUSE_SELECTED_LAYER_ID,
	CAMPUS_HOVER_PLACE_FILL_LAYER_ID,
	CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID,
	CAMPUS_SELECTED_PLACE_FILL_LAYER_ID,
	CAMPUS_SELECTED_PLACE_HALO_LAYER_ID,
	CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID,
	type CampusMapProfile,
	createCampusMapFeatureFilter,
	createCampusMapPatternImage,
	createCampusMapStyle,
	selectGatehouseFeatureRefs,
} from "@/features/map/campus-map-style";
import {
	createFeatureRefKey,
	createPlaceFeatureIndex,
	type MapFeatureRefKey,
} from "@/features/map/feature-selection";
import { loadMapLibre, type MapLibreRuntime } from "@/features/map/maplibre-runtime";
import type { CampusMapFeatureRef, CampusMapPlacesResponse } from "@/features/map/model";
import type { MapPlaceView, MapTaskFilter } from "@/features/map/view-model";
import {
	clearMapMarkers,
	findPlaceIdAtPoint,
	getMapViewportPadding,
	getViewportBoundsForFilteredPlaces,
	readCampusMapStyleColors,
	setMapCanvasCursor,
	shouldFitMapForFilter,
	shouldRenderPointMarker,
} from "./map-page-map-support";

interface CampusMapRuntimeInput {
	campusPlaces: MapPlaceView[];
	data: CampusMapPlacesResponse | null;
	filteredPlaces: MapPlaceView[];
	onClearSelection(): void;
	onSelectPlace(placeId: string): void;
	query: string;
	resolvedTheme: "dark" | "light";
	selected: MapPlaceView | null;
	selectedCampus: string | null;
	selectedCampusProfile: CampusMapProfile | null;
	selectedCategory: MapTaskFilter;
}

export function useCampusMapRuntime(input: CampusMapRuntimeInput) {
	const mapRef = useRef<HTMLElement | null>(null);
	const mapInstanceRef = useRef<maplibregl.Map | null>(null);
	const markerRefs = useRef<maplibregl.Marker[]>([]);
	const mapMoveIntentRef = useRef<"filter" | "place">("filter");
	const mapReadyProfileRef = useRef<string | null>(null);
	const mapReadyThemeRef = useRef<"light" | "dark" | null>(null);
	const mapStyleUpdateTimerRef = useRef<number | null>(null);
	const mapAttemptRef = useRef(0);
	const onSelectPlaceRef = useRef(input.onSelectPlace);
	const onClearSelectionRef = useRef(input.onClearSelection);
	const placeFeatureIndexRef = useRef<Map<MapFeatureRefKey, string>>(new Map());
	const placeViewsByIdRef = useRef<Map<string, MapPlaceView>>(new Map());
	const selectedFeatureRefKeySetRef = useRef<Set<MapFeatureRefKey>>(new Set());
	const [mapLoaded, setMapLoaded] = useState(false);
	const [mapStatus, setMapStatus] = useState<"error" | "loading" | "ready">("loading");
	const [mapAttempt, setMapAttempt] = useState(0);
	const [mapRuntime, setMapRuntime] = useState<MapLibreRuntime | null>(null);
	const [hoveredFeatureRefs, setHoveredFeatureRefs] = useState<CampusMapFeatureRef[]>([]);
	const resolvedThemeRef = useRef(input.resolvedTheme);
	const placeFeatureIndex = useMemo(
		() => createPlaceFeatureIndex(input.campusPlaces),
		[input.campusPlaces],
	);
	const placeViewsById = useMemo(
		() => new Map(input.campusPlaces.map((place) => [place.place.id, place])),
		[input.campusPlaces],
	);
	const selectedFeatureRefKeySet = useMemo(
		() => new Set((input.selected?.featureRefs ?? []).map(createFeatureRefKey)),
		[input.selected],
	);
	const visibleHoveredFeatureRefs = useMemo(
		() =>
			hoveredFeatureRefs.filter(
				(featureRef) => !selectedFeatureRefKeySet.has(createFeatureRefKey(featureRef)),
			),
		[hoveredFeatureRefs, selectedFeatureRefKeySet],
	);
	onSelectPlaceRef.current = input.onSelectPlace;
	onClearSelectionRef.current = input.onClearSelection;
	resolvedThemeRef.current = input.resolvedTheme;
	placeFeatureIndexRef.current = placeFeatureIndex;
	placeViewsByIdRef.current = placeViewsById;
	selectedFeatureRefKeySetRef.current = selectedFeatureRefKeySet;

	const selectPlace = useCallback((placeId: string) => {
		mapMoveIntentRef.current = "place";
		onSelectPlaceRef.current(placeId);
	}, []);

	const clearSelection = useCallback(() => {
		onClearSelectionRef.current();
	}, []);

	useEffect(() => {
		const selectedCampusProfile = input.selectedCampusProfile;
		if (!(input.data && selectedCampusProfile && mapRef.current && !mapInstanceRef.current)) {
			return;
		}

		const attempt = mapAttempt;
		const styleTheme = input.resolvedTheme;
		const styleProfile = selectedCampusProfile.campus;
		mapAttemptRef.current = attempt;
		let creationPending = true;
		setMapStatus("loading");
		loadMapLibre()
			.then((runtime) => {
				if (!creationPending || mapAttemptRef.current !== attempt || !mapRef.current) {
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
				map.on("styleimagemissing", ({ id }) => {
					if (map.hasImage(id)) {
						return;
					}
					const image = createCampusMapPatternImage(id);
					if (image) {
						map.addImage(id, image);
					}
				});
				map.addControl(new runtime.NavigationControl({ visualizePitch: true }), "top-right");
				map.addControl(new runtime.ScaleControl({ unit: "metric" }), "bottom-left");
				map.on("click", (event) => {
					const placeId = findPlaceIdAtPoint(map, event.point, placeFeatureIndexRef.current);
					if (placeId) {
						selectPlace(placeId);
						return;
					}
					clearSelection();
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
				map.on("error", () => {
					if (mapInstanceRef.current === map && mapAttemptRef.current === attempt) {
						setMapLoaded(false);
						setMapStatus("error");
					}
				});
				mapInstanceRef.current = map;
				mapReadyProfileRef.current = styleProfile;
				mapReadyThemeRef.current = styleTheme;
				map.once("load", () => {
					if (
						mapInstanceRef.current !== map ||
						mapAttemptRef.current !== attempt ||
						mapReadyProfileRef.current !== styleProfile ||
						mapReadyThemeRef.current !== styleTheme
					) {
						return;
					}
					if (resolvedThemeRef.current !== styleTheme) {
						mapReadyThemeRef.current = null;
					}
					map.resize();
					setMapLoaded(true);
					setMapStatus("ready");
				});
				window.requestAnimationFrame(() => map.resize());
				setMapRuntime(runtime);
			})
			.catch(() => {
				if (creationPending && mapAttemptRef.current === attempt) {
					setMapLoaded(false);
					setMapStatus("error");
				}
			});

		return () => {
			creationPending = false;
		};
	}, [
		clearSelection,
		input.data,
		input.resolvedTheme,
		input.selectedCampusProfile,
		mapAttempt,
		selectPlace,
	]);

	useEffect(
		() => () => {
			if (mapStyleUpdateTimerRef.current !== null) {
				window.clearTimeout(mapStyleUpdateTimerRef.current);
				mapStyleUpdateTimerRef.current = null;
			}
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
			mapInstanceRef.current?.remove();
			mapInstanceRef.current = null;
			mapReadyProfileRef.current = null;
			mapReadyThemeRef.current = null;
			setMapLoaded(false);
		},
		[],
	);

	useEffect(() => {
		const map = mapInstanceRef.current;
		const selectedCampusProfile = input.selectedCampusProfile;
		if (!(map && selectedCampusProfile && mapLoaded)) {
			return;
		}
		if (
			mapReadyProfileRef.current === selectedCampusProfile.campus &&
			mapReadyThemeRef.current === input.resolvedTheme
		) {
			return;
		}
		const profileChanged = mapReadyProfileRef.current !== selectedCampusProfile.campus;
		map.setMaxBounds(selectedCampusProfile.maxBounds);
		map.setMinZoom(selectedCampusProfile.minZoom);
		map.setMaxZoom(selectedCampusProfile.maxZoom);
		setMapLoaded(false);
		setMapStatus("loading");
		const profileCampus = selectedCampusProfile.campus;
		const styleTheme = input.resolvedTheme;
		mapReadyProfileRef.current = profileCampus;
		mapReadyThemeRef.current = styleTheme;
		map.once("style.load", () => {
			if (
				mapInstanceRef.current !== map ||
				mapReadyProfileRef.current !== profileCampus ||
				mapReadyThemeRef.current !== styleTheme
			) {
				return;
			}
			const themeChangedAgain = resolvedThemeRef.current !== styleTheme;
			if (themeChangedAgain) {
				mapReadyThemeRef.current = null;
			}
			map.resize();
			setMapLoaded(true);
			if (!themeChangedAgain) {
				setMapStatus("ready");
			}
		});
		if (mapStyleUpdateTimerRef.current !== null) {
			window.clearTimeout(mapStyleUpdateTimerRef.current);
		}
		const applyMapStyle = () => {
			mapStyleUpdateTimerRef.current = null;
			if (
				mapInstanceRef.current !== map ||
				mapReadyProfileRef.current !== profileCampus ||
				mapReadyThemeRef.current !== styleTheme
			) {
				return;
			}
			map.setStyle(createCampusMapStyle(readCampusMapStyleColors(), selectedCampusProfile));
			map.resize();
		};
		if (profileChanged) {
			applyMapStyle();
		} else {
			mapStyleUpdateTimerRef.current = window.setTimeout(applyMapStyle, 140);
		}
	}, [mapLoaded, input.resolvedTheme, input.selectedCampusProfile]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && mapRuntime && mapLoaded)) {
			return;
		}

		clearMapMarkers(markerRefs.current);
		markerRefs.current = input.filteredPlaces.filter(shouldRenderPointMarker).map((place) => {
			const marker = document.createElement("button");
			marker.className = "campus-map-marker";
			marker.type = "button";
			marker.dataset.selected = String(input.selected?.place.id === place.place.id);
			marker.dataset.variant = place.markerVariant;
			marker.innerHTML = `<span aria-hidden="true"></span>`;
			marker.setAttribute("aria-label", place.place.title);
			marker.addEventListener("click", (event) => {
				event.stopPropagation();
				selectPlace(place.place.id);
			});
			return new mapRuntime.Marker({ element: marker }).setLngLat(place.coordinates).addTo(map);
		});

		return () => {
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
		};
	}, [input.filteredPlaces, input.selected?.place.id, mapLoaded, mapRuntime, selectPlace]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && input.selectedCampusProfile && mapLoaded)) {
			return;
		}

		const filter = createCampusMapFeatureFilter(input.selected?.featureRefs ?? []);
		map.setFilter(CAMPUS_SELECTED_PLACE_FILL_LAYER_ID, filter);
		map.setFilter(CAMPUS_SELECTED_PLACE_HALO_LAYER_ID, filter);
		map.setFilter(CAMPUS_SELECTED_PLACE_OUTLINE_LAYER_ID, filter);
		// The gatehouse highlight is a circle layer. Feeding it every selected
		// feature turns each vertex of a tapped building polygon into a dot, so
		// it only ever receives the gatehouse refs.
		map.setFilter(
			CAMPUS_GATEHOUSE_SELECTED_LAYER_ID,
			createCampusMapFeatureFilter(selectGatehouseFeatureRefs(input.selected?.featureRefs ?? [])),
		);
	}, [input.selected, input.selectedCampusProfile, mapLoaded]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && input.selectedCampusProfile && mapLoaded)) {
			return;
		}

		const filter = createCampusMapFeatureFilter(visibleHoveredFeatureRefs);
		map.setFilter(CAMPUS_HOVER_PLACE_FILL_LAYER_ID, filter);
		map.setFilter(CAMPUS_HOVER_PLACE_OUTLINE_LAYER_ID, filter);
	}, [input.selectedCampusProfile, mapLoaded, visibleHoveredFeatureRefs]);

	useEffect(() => {
		if (
			!(
				mapLoaded &&
				mapInstanceRef.current &&
				input.selectedCampusProfile &&
				input.filteredPlaces.length > 0 &&
				shouldFitMapForFilter({
					category: input.selectedCategory,
					campus: input.selectedCampus,
					intent: mapMoveIntentRef.current,
					query: input.query,
				})
			)
		) {
			return;
		}
		const map = mapInstanceRef.current;
		map.resize();
		const bounds = getViewportBoundsForFilteredPlaces({
			category: input.selectedCategory,
			profile: input.selectedCampusProfile,
			query: input.query,
			places: input.filteredPlaces,
		});
		map.fitBounds(bounds, {
			duration: 420,
			maxZoom: 16.8,
			padding: getMapViewportPadding(),
		});
	}, [
		input.filteredPlaces,
		input.query,
		input.selectedCampus,
		input.selectedCampusProfile,
		input.selectedCategory,
		mapLoaded,
	]);

	useEffect(() => {
		if (!(input.selected && mapInstanceRef.current && mapMoveIntentRef.current === "place")) {
			return;
		}
		mapInstanceRef.current.flyTo({
			center: input.selected.coordinates,
			zoom: 17,
		});
	}, [input.selected]);

	return {
		clearHoveredFeatures() {
			setHoveredFeatureRefs([]);
			if (mapInstanceRef.current) {
				setMapCanvasCursor(mapInstanceRef.current, "");
			}
		},
		clearSelection,
		mapLoaded,
		mapRef,
		mapStatus,
		markFilterIntent() {
			mapMoveIntentRef.current = "filter";
		},
		resetCampusViewport() {
			const map = mapInstanceRef.current;
			if (!(map && input.selectedCampusProfile)) {
				return;
			}
			mapMoveIntentRef.current = "filter";
			map.fitBounds(input.selectedCampusProfile.maxBounds, {
				duration: 420,
				maxZoom: 16.8,
				padding: getMapViewportPadding(),
			});
		},
		retryMap() {
			if (mapStyleUpdateTimerRef.current !== null) {
				window.clearTimeout(mapStyleUpdateTimerRef.current);
				mapStyleUpdateTimerRef.current = null;
			}
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
			mapInstanceRef.current?.remove();
			mapInstanceRef.current = null;
			mapReadyProfileRef.current = null;
			mapReadyThemeRef.current = null;
			setMapLoaded(false);
			setMapStatus("loading");
			setMapAttempt((attempt) => attempt + 1);
		},
		selectPlace,
	};
}
