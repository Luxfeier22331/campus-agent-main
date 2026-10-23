import { Button, StateMessage, useTheme } from "@campus-agent/ui";
import { useEffect, useMemo, useState } from "react";
import { FeedbackSheet } from "@/components/feedback/feedback-sheet";
import { MapProductExperience } from "@/components/map/map-product-experience";
import { getCampusMapProfile } from "@/features/map/campus-map-style";
import {
	createMapPlaceViews,
	filterMapPlaces,
	getMapCampuses,
	getMapTaskFilters,
	type MapTaskFilter,
} from "@/features/map/view-model";
import { getCampusMapExperienceNotice } from "./map-page-map-support";
import { MapDataLoading, MapStateShell } from "./map-page-state-view";
import { writeMapUrlState } from "./map-page-url-state";
import { useCampusMapPageData } from "./use-campus-map-page-data";
import { useCampusMapRuntime } from "./use-campus-map-runtime";

export function MapPage() {
	const {
		data,
		error,
		loading,
		mapProfiles,
		query,
		retryData,
		selectedCampus,
		selectedCategory,
		selectedPlaceId,
		setQuery,
		setSelectedCampus,
		setSelectedCategory,
		setSelectedPlaceId,
	} = useCampusMapPageData();
	const { resolvedTheme } = useTheme();
	const [feedbackOpen, setFeedbackOpen] = useState(false);

	const places = useMemo(() => createMapPlaceViews(data?.places ?? []), [data]);
	const campuses = useMemo(() => getMapCampuses(places), [places]);
	const selectedCampusProfile = useMemo(
		() => (selectedCampus ? getCampusMapProfile(mapProfiles, selectedCampus) : null),
		[mapProfiles, selectedCampus],
	);
	const campusPlaces = useMemo(
		() => (selectedCampus ? places.filter((place) => place.place.campus === selectedCampus) : []),
		[places, selectedCampus],
	);
	const categories = useMemo(() => getMapTaskFilters(campusPlaces), [campusPlaces]);
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
	const mapController = useCampusMapRuntime({
		campusPlaces,
		data,
		filteredPlaces,
		onClearSelection: () => setSelectedPlaceId(null),
		onSelectPlace: setSelectedPlaceId,
		query,
		resolvedTheme,
		selected,
		selectedCampus,
		selectedCampusProfile,
		selectedCategory,
	});

	useEffect(() => {
		if (!data) {
			return;
		}
		if (selectedPlaceId && !campusPlaces.some((place) => place.place.id === selectedPlaceId)) {
			setSelectedPlaceId(null);
		}
	}, [campusPlaces, data, selectedPlaceId, setSelectedPlaceId]);

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

	return (
		<>
			{error ? (
				<MapStateShell>
					<StateMessage
						description={error}
						layout="page"
						primaryAction={
							<Button onClick={retryMap} type="button">
								重试
							</Button>
						}
						secondaryAction={
							<Button onClick={() => setFeedbackOpen(true)} variant="outline">
								反馈
							</Button>
						}
						role="alert"
						title="校园地图暂时无法打开"
						tone="danger"
					/>
				</MapStateShell>
			) : loading ? (
				<MapStateShell>
					<MapDataLoading />
				</MapStateShell>
			) : data && selectedCampusProfile ? (
				<MapProductExperience
					mapStatus={mapController.mapStatus}
					campuses={campuses}
					categories={categories}
					category={selectedCategory}
					campus={selectedCampus ?? ""}
					campusNotice={getCampusMapExperienceNotice(selectedCampus)}
					filteredPlaces={filteredPlaces}
					mapRef={mapController.mapRef}
					onCanvasClick={clearSelection}
					onCategoryChange={selectCategory}
					onClearFilters={clearFilters}
					onCampusChange={selectCampus}
					onPlaceSelect={selectPlace}
					onQueryChange={searchPlaces}
					onResetViewport={mapController.resetCampusViewport}
					onZoomIn={() => mapController.zoomBy(1)}
					onZoomOut={() => mapController.zoomBy(-1)}
					onRetryMap={retryMap}
					query={query}
					selectedPlace={selected}
					viewportControlsAvailable={mapController.mapLoaded}
					zoomControlsAvailable={mapController.mapLoaded}
				/>
			) : (
				<MapStateShell>
					<StateMessage
						description="当前没有可展示的地图地点。"
						layout="section"
						textAlign="center"
						title="暂无校园地点"
					/>
				</MapStateShell>
			)}
			{feedbackOpen ? (
				<FeedbackSheet
					defaultCategory="map_issue"
					onOpenChange={setFeedbackOpen}
					open={feedbackOpen}
					sourceLabel="校园地图"
				/>
			) : null}
		</>
	);

	function selectCampus(nextCampus: string) {
		mapController.markFilterIntent();
		mapController.clearHoveredFeatures();
		setSelectedCampus(nextCampus);
		setSelectedCategory("all");
		setSelectedPlaceId(null);
	}

	function selectCategory(nextCategory: MapTaskFilter) {
		mapController.markFilterIntent();
		setSelectedCategory(nextCategory);
	}

	function searchPlaces(nextQuery: string) {
		mapController.markFilterIntent();
		setQuery(nextQuery);
		setSelectedPlaceId(null);
	}

	function clearFilters() {
		mapController.markFilterIntent();
		setQuery("");
		setSelectedCategory("all");
		setSelectedPlaceId(null);
	}

	function selectPlace(placeId: string) {
		mapController.selectPlace(placeId);
	}

	function clearSelection() {
		mapController.clearSelection();
	}

	function retryMap() {
		if (error) {
			retryData();
			return;
		}
		mapController.retryMap();
	}
}
