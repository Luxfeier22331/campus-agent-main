import { useMemo, useRef, useState } from "react";
import { MapExperience } from "@/components/map/map-experience";
import type { CampusMapPlace } from "@/features/map/model";
import {
	createMapPlaceViews,
	filterMapPlaces,
	getMapCampuses,
	getMapTaskFilters,
	type MapTaskFilter,
} from "@/features/map/view-model";
import type { StyleDevStory } from "../contracts";

const MAP_PLACES: CampusMapPlace[] = [
	{
		accessNote: "从东门进入后沿主路步行约 5 分钟。",
		campus: "海淀校区",
		category: "building",
		description: "提供阅览、借阅和自习空间。",
		geojson: {
			geometry: { coordinates: [116.321, 39.953], type: "Point" },
			properties: { category: "building", placeId: "east-library", title: "东区图书馆" },
			type: "Feature",
		},
		id: "east-library",
		mapFeatureRefs: [],
		sourceRefs: [],
		tags: ["图书馆", "学习", "教学"],
		title: "东区图书馆",
	},
	{
		accessNote: null,
		campus: "海淀校区",
		category: "service",
		description: "办理校园卡补办和信息咨询。",
		geojson: {
			geometry: { coordinates: [116.319, 39.951], type: "Point" },
			properties: { category: "service", placeId: "student-service", title: "学生服务中心" },
			type: "Feature",
		},
		id: "student-service",
		mapFeatureRefs: [],
		sourceRefs: [],
		tags: ["校园卡", "服务"],
		title: "学生服务中心",
	},
	{
		accessNote: "位于教学区南侧。",
		campus: "丰台校区",
		category: "building",
		description: "提供多层餐饮窗口。",
		geojson: {
			geometry: { coordinates: [116.246, 39.82], type: "Point" },
			properties: { category: "building", placeId: "huixian-dining", title: "荟贤食堂" },
			type: "Feature",
		},
		id: "huixian-dining",
		mapFeatureRefs: [],
		sourceRefs: [],
		tags: ["食堂", "餐饮"],
		title: "荟贤食堂",
	},
];

function MapExample({ mode }: { mode: "error" | "loading" | "ready" | "selected" }) {
	const places = useMemo(() => createMapPlaceViews(MAP_PLACES), []);
	const campuses = useMemo(() => getMapCampuses(places), [places]);
	const categories = useMemo(() => getMapTaskFilters(places), [places]);
	const [campus, setCampus] = useState(campuses[0] ?? "海淀校区");
	const [category, setCategory] = useState<MapTaskFilter>("all");
	const [query, setQuery] = useState("");
	const initialSelected =
		mode === "selected" ? places.find((place) => place.place.id === "east-library") : null;
	const [selectedPlaceId, setSelectedPlaceId] = useState(initialSelected?.place.id ?? null);
	const filteredPlaces = filterMapPlaces(places, { campus, category, query });
	const selectedPlace = places.find((place) => place.place.id === selectedPlaceId) ?? null;
	const mapRef = useRef<HTMLElement>(null);
	return (
		<div className="style-dev-map-example">
			<MapExperience
				campus={campus}
				campuses={campuses}
				campusNotice={null}
				categories={categories}
				category={category}
				filteredPlaces={filteredPlaces}
				mapRef={mapRef}
				mapStatus={mode === "error" ? "error" : mode === "loading" ? "loading" : "ready"}
				onCanvasClick={() => setSelectedPlaceId(null)}
				onCategoryChange={setCategory}
				onClearFilters={() => {
					setCategory("all");
					setQuery("");
				}}
				onCampusChange={setCampus}
				onPlaceSelect={setSelectedPlaceId}
				onQueryChange={setQuery}
				onResetViewport={() => undefined}
				onRetryMap={() => undefined}
				query={query}
				selectedPlace={selectedPlace}
				viewportControlsAvailable
			/>
		</div>
	);
}

export const MAP_ENTRIES: readonly StyleDevStory[] = [
	{
		defaultVariant: "ready",
		variants: [
			{ id: "ready", label: "地点浏览", render: () => <MapExample mode="ready" /> },
			{ id: "selected", label: "地点详情", render: () => <MapExample mode="selected" /> },
			{ id: "loading", label: "地图加载", render: () => <MapExample mode="loading" /> },
			{ id: "error", label: "地图失败", render: () => <MapExample mode="error" /> },
		],
		group: "地图",
		id: "style-dev-map-experience",
		title: "地图体验",
	},
];
