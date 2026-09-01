import { cn } from "@campus-agent/ui";
import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { CampusMotionProvider } from "@/components/ui/motion";
import type { MapPlaceView, MapTaskFilter } from "@/features/map/view-model";
import { MapPlacePopover } from "./map-place-popover";
import { MapSearchPanel } from "./map-search-panel";
import { MapAssetLoading, MapAssetNotice, MapViewportControls } from "./map-status-controls";

export interface MapExperienceProps {
	mapStatus: "error" | "loading" | "ready";
	campuses: string[];
	categories: Array<{ label: string; value: Exclude<MapTaskFilter, "all"> }>;
	category: MapTaskFilter;
	campus: string;
	campusNotice: string | null;
	filteredPlaces: MapPlaceView[];
	mapRef: RefObject<HTMLElement | null>;
	onCanvasClick: () => void;
	onCategoryChange: (category: MapTaskFilter) => void;
	onClearFilters: () => void;
	onCampusChange: (campus: string) => void;
	onPlaceSelect: (placeId: string) => void;
	onQueryChange: (query: string) => void;
	onResetViewport: () => void;
	onRetryMap: () => void;
	query: string;
	selectedPlace: MapPlaceView | null;
	viewportControlsAvailable: boolean;
}

const DESKTOP_MAP_QUERY = "(min-width: 960px)";

export function MapExperience({
	mapStatus,
	campuses,
	categories,
	category,
	campus,
	campusNotice,
	filteredPlaces,
	mapRef,
	onCanvasClick,
	onCategoryChange,
	onClearFilters,
	onCampusChange,
	onPlaceSelect,
	onQueryChange,
	onResetViewport,
	onRetryMap,
	query,
	selectedPlace,
	viewportControlsAvailable,
}: MapExperienceProps) {
	const isDesktop = useIsDesktopMap();
	const [placeListExpanded, setPlaceListExpanded] = useState(
		() => query.trim().length > 0 || category !== "all",
	);

	return (
		<CampusMotionProvider>
			<section
				aria-label="校园地图"
				className="relative min-h-dvh overflow-hidden bg-[var(--map-canvas-bg)]"
				data-surface="map-first"
			>
				<div className="absolute inset-0 bg-[var(--map-canvas-bg)]">
					<section
						aria-label="地图画布"
						className={cn(
							"h-full w-full transition-opacity duration-150 ease-out motion-reduce:transition-none",
							mapStatus === "ready" ? "opacity-100" : "opacity-0",
						)}
						ref={mapRef}
					/>
				</div>
				{mapStatus === "error" ? (
					<MapAssetNotice campus={campus} onRetry={onRetryMap} />
				) : mapStatus === "loading" ? (
					<MapAssetLoading />
				) : null}
				<MapSearchPanel
					campuses={campuses}
					categories={categories}
					category={category}
					campus={campus}
					campusNotice={campusNotice}
					compactResults={!isDesktop && Boolean(selectedPlace)}
					isDesktop={isDesktop}
					listExpanded={placeListExpanded}
					onCategoryChange={onCategoryChange}
					onCampusChange={onCampusChange}
					onClearFilters={onClearFilters}
					onClearSelection={onCanvasClick}
					onListExpandedChange={setPlaceListExpanded}
					onPlaceSelect={onPlaceSelect}
					onQueryChange={onQueryChange}
					places={filteredPlaces}
					query={query}
					selectedPlaceId={selectedPlace?.place.id ?? null}
				/>
				{isDesktop || !selectedPlace ? (
					<MapViewportControls
						onResetViewport={onResetViewport}
						showReset={viewportControlsAvailable}
					/>
				) : null}
				{selectedPlace ? (
					<MapPlacePopover isDesktop={isDesktop} onClose={onCanvasClick} place={selectedPlace} />
				) : null}
			</section>
		</CampusMotionProvider>
	);
}

function useIsDesktopMap() {
	const [matches, setMatches] = useState(() =>
		typeof window === "undefined" ? false : window.matchMedia(DESKTOP_MAP_QUERY).matches,
	);

	useEffect(() => {
		const media = window.matchMedia(DESKTOP_MAP_QUERY);
		const updateMatches = () => setMatches(media.matches);
		updateMatches();
		media.addEventListener("change", updateMatches);
		return () => media.removeEventListener("change", updateMatches);
	}, []);

	return matches;
}
