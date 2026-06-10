import type maplibregl from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { MapExperience } from "@/components/map/map-experience";
import { EmptyPanel, ErrorPanel, LoadingPanel } from "@/components/shell/state-panels";
import { SupportSurfaceShell } from "@/components/shell/support-surface-shell";
import { getCampusMapPlaces } from "@/features/map/api";
import { loadMapLibre, type MapLibreRuntime } from "@/features/map/maplibre-runtime";
import type { CampusMapPlacesResponse } from "@/features/map/model";
import {
	createMapPlaceViews,
	filterMapPlaces,
	getMapCampuses,
	getMapCategories,
	type MapCategoryFilter,
} from "@/features/map/view-model";

export function MapPage() {
	const mapRef = useRef<HTMLDivElement | null>(null);
	const mapInstanceRef = useRef<maplibregl.Map | null>(null);
	const markerRefs = useRef<maplibregl.Marker[]>([]);
	const [data, setData] = useState<CampusMapPlacesResponse | null>(null);
	const [mapRuntime, setMapRuntime] = useState<MapLibreRuntime | null>(null);
	const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [selectedCampus, setSelectedCampus] = useState("all");
	const [selectedCategory, setSelectedCategory] = useState<MapCategoryFilter>("all");

	const places = useMemo(() => createMapPlaceViews(data?.places ?? []), [data]);
	const campuses = useMemo(() => getMapCampuses(places), [places]);
	const categories = useMemo(() => getMapCategories(places), [places]);
	const filteredPlaces = useMemo(
		() =>
			filterMapPlaces(places, {
				campus: selectedCampus,
				category: selectedCategory,
				query,
			}),
		[places, query, selectedCampus, selectedCategory],
	);
	const selected =
		filteredPlaces.find((place) => place.place.id === selectedPlaceId) ?? filteredPlaces[0] ?? null;

	useEffect(() => {
		setLoading(true);
		setError(null);
		getCampusMapPlaces()
			.then((nextData) => {
				setData(nextData);
				setSelectedPlaceId(nextData.places[0]?.id ?? null);
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
		if (!(data && mapRef.current && !mapInstanceRef.current)) {
			return;
		}

		let cancelled = false;
		loadMapLibre()
			.then((runtime) => {
				if (cancelled || !mapRef.current) {
					return;
				}
				const canvasBackground = readRequiredCssToken("--neutral-150");
				const map = new runtime.Map({
					center: data.campus.defaultCenter,
					container: mapRef.current,
					style: {
						layers: [
							{
								id: "background",
								paint: {
									"background-color": canvasBackground,
								},
								type: "background",
							},
						],
						sources: {},
						version: 8,
					},
					zoom: 16,
				});
				mapInstanceRef.current = map;
				setMapRuntime(runtime);
			})
			.catch(() => {
				setError("地图暂时无法显示。");
			});

		return () => {
			cancelled = true;
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
			mapInstanceRef.current?.remove();
			mapInstanceRef.current = null;
		};
	}, [data]);

	useEffect(() => {
		const map = mapInstanceRef.current;
		if (!(map && mapRuntime)) {
			return;
		}

		clearMapMarkers(markerRefs.current);
		markerRefs.current = filteredPlaces.map((place) => {
			const marker = document.createElement("button");
			marker.className = "campus-map-marker";
			marker.type = "button";
			marker.dataset.selected = String(selected?.place.id === place.place.id);
			marker.innerHTML = `<span aria-hidden="true"></span>`;
			marker.setAttribute("aria-label", place.place.title);
			marker.addEventListener("click", () => setSelectedPlaceId(place.place.id));
			return new mapRuntime.Marker({ element: marker }).setLngLat(place.coordinates).addTo(map);
		});

		return () => {
			clearMapMarkers(markerRefs.current);
			markerRefs.current = [];
		};
	}, [filteredPlaces, mapRuntime, selected?.place.id]);

	useEffect(() => {
		if (!data) {
			return;
		}
		if (filteredPlaces.length === 0) {
			setSelectedPlaceId(null);
			return;
		}
		if (!(selectedPlaceId && filteredPlaces.some((place) => place.place.id === selectedPlaceId))) {
			setSelectedPlaceId(filteredPlaces[0]?.place.id ?? null);
		}
	}, [data, filteredPlaces, selectedPlaceId]);

	useEffect(() => {
		if (!(selected && mapInstanceRef.current)) {
			return;
		}
		mapInstanceRef.current.flyTo({
			center: selected.coordinates,
			zoom: 17,
		});
	}, [selected]);

	return (
		<SupportSurfaceShell eyebrow={data?.campus.name ?? "校园地图"} title="校园地图">
			{error ? (
				<ErrorPanel message={error} />
			) : loading ? (
				<LoadingPanel label="正在读取地图" />
			) : data ? (
				<MapExperience
					campuses={campuses}
					categories={categories}
					category={selectedCategory}
					campus={selectedCampus}
					filteredPlaces={filteredPlaces}
					mapRef={mapRef}
					onCategoryChange={setSelectedCategory}
					onCampusChange={setSelectedCampus}
					onPlaceSelect={setSelectedPlaceId}
					onQueryChange={setQuery}
					query={query}
					selectedPlace={selected}
				/>
			) : (
				<EmptyPanel message="当前没有可展示的地图地点。" />
			)}
		</SupportSurfaceShell>
	);
}

function clearMapMarkers(markers: maplibregl.Marker[]) {
	for (const marker of markers) {
		marker.remove();
	}
}

function readRequiredCssToken(tokenName: string) {
	const value = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
	if (!value) {
		throw new Error(`Missing CSS token: ${tokenName}`);
	}
	return value;
}
