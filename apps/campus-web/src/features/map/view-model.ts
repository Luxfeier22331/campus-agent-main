import type { CampusMapFeatureRef, CampusMapPlace, CampusMapPlaceCategory } from "./model";

export interface MapPlaceView {
	category: CampusMapPlaceCategory;
	categoryLabel: string;
	coordinates: [number, number];
	detailRows: Array<{ label: string; value: string }>;
	displayTags: string[];
	featureRefs: CampusMapFeatureRef[];
	markerVariant: MapMarkerVariant;
	place: CampusMapPlace;
	searchText: string;
	usesFeatureHighlight: boolean;
}

export type MapTaskFilter =
	| "all"
	| "dining"
	| "teaching"
	| "dorm"
	| "entrance"
	| "service"
	| "sport";
export interface MapPlaceGroup {
	label: MapPlaceTaskGroupLabel;
	places: MapPlaceView[];
}
export type MapMarkerVariant =
	| "building"
	| "dining"
	| "gate"
	| "landmark"
	| "service"
	| "transport";
type MapPlaceTaskGroupLabel = "食堂" | "教学楼" | "宿舍" | "出入口" | "服务" | "运动";

const CAMPUS_DISPLAY_ORDER = ["丰台校区", "海淀校区"] as const;
const TASK_GROUP_DISPLAY_ORDER: MapPlaceTaskGroupLabel[] = [
	"食堂",
	"教学楼",
	"宿舍",
	"出入口",
	"服务",
	"运动",
];
const TASK_FILTER_OPTIONS: Array<{
	label: MapPlaceTaskGroupLabel;
	value: Exclude<MapTaskFilter, "all">;
}> = [
	{ label: "食堂", value: "dining" },
	{ label: "教学楼", value: "teaching" },
	{ label: "宿舍", value: "dorm" },
	{ label: "出入口", value: "entrance" },
	{ label: "服务", value: "service" },
	{ label: "运动", value: "sport" },
];
const MAP_TAGS_HIDDEN_FROM_DETAILS = new Set(["丰台", "丰台校区", "海淀", "海淀校区"]);
const JINGYUAN_BUILDING_ORDER = new Map([
	["一", 1],
	["二", 2],
	["三", 3],
	["四", 4],
	["五", 5],
	["六", 6],
	["七", 7],
	["八", 8],
	["九", 9],
	["十", 10],
]);
const CHINESE_COLLATOR = new Intl.Collator("zh-Hans-CN", {
	numeric: true,
	sensitivity: "base",
});

export function createMapPlaceViews(places: CampusMapPlace[]): MapPlaceView[] {
	return places.map((place) => {
		const categoryLabel = getTaskGroupLabelForPlace(place);
		const displayTags = Array.from(new Set([categoryLabel, ...place.tags])).filter(
			(tag) => !MAP_TAGS_HIDDEN_FROM_DETAILS.has(tag),
		);
		const detailRows = [
			...(place.accessNote ? [{ label: "到达提示", value: place.accessNote }] : []),
		];
		return {
			category: place.category,
			categoryLabel,
			coordinates: place.geojson.geometry.coordinates,
			detailRows,
			displayTags,
			featureRefs: place.mapFeatureRefs ?? [],
			markerVariant: getMarkerVariant(place),
			place,
			searchText: [place.title, place.description, place.campus, ...place.tags]
				.join(" ")
				.toLowerCase(),
			usesFeatureHighlight: shouldUseFeatureHighlight(place),
		};
	});
}

export function filterMapPlaces(
	places: MapPlaceView[],
	input: {
		category: MapTaskFilter;
		campus: string;
		query: string;
	},
) {
	const normalizedQuery = input.query.trim().toLowerCase();
	const matchedPlaces = places.filter((place) => {
		if (place.place.campus !== input.campus) {
			return false;
		}
		if (input.category !== "all" && getTaskFilterForPlace(place) !== input.category) {
			return false;
		}
		return !normalizedQuery || place.searchText.includes(normalizedQuery);
	});
	return rankMapSearchResults(matchedPlaces, normalizedQuery);
}

export function rankMapSearchResults(places: MapPlaceView[], normalizedQuery: string) {
	return places
		.map((place, index) => ({ index, place }))
		.sort((left, right) => {
			const groupDiff = getTaskGroupOrder(left.place) - getTaskGroupOrder(right.place);
			if (!normalizedQuery) {
				if (groupDiff !== 0) {
					return groupDiff;
				}
				const displayDiff = compareMapPlaceForDisplay(left.place, right.place);
				return displayDiff === 0 ? left.index - right.index : displayDiff;
			}
			const relevanceDiff =
				getSearchRelevance(left.place, normalizedQuery) -
				getSearchRelevance(right.place, normalizedQuery);
			if (relevanceDiff !== 0) {
				return relevanceDiff;
			}
			if (groupDiff !== 0) {
				return groupDiff;
			}
			return left.index - right.index;
		})
		.map(({ place }) => place);
}

export function groupMapPlacesForDisplay(
	places: MapPlaceView[],
	_input: { sortWithinGroups?: boolean } = {},
): MapPlaceGroup[] {
	const groups = new Map<MapPlaceTaskGroupLabel, MapPlaceView[]>();
	for (const place of places) {
		const label = getTaskGroupLabel(place);
		groups.set(label, [...(groups.get(label) ?? []), place]);
	}
	return TASK_GROUP_DISPLAY_ORDER.flatMap((label) => {
		const groupPlaces = groups.get(label);
		return groupPlaces
			? [
					{
						label,
						places: groupPlaces,
					},
				]
			: [];
	});
}

export function getMapCampuses(places: MapPlaceView[]) {
	return sortCampusesForMapExperience(
		Array.from(new Set(places.map((place) => place.place.campus))),
	);
}

export function getMapTaskFilters(places: MapPlaceView[]) {
	const labels = new Set(places.map(getTaskGroupLabel));
	return TASK_FILTER_OPTIONS.filter((option) => labels.has(option.label));
}

function getMarkerVariant(place: CampusMapPlace): MapMarkerVariant {
	if (place.tags.includes("食堂")) {
		return "dining";
	}
	return place.category;
}

function shouldUseFeatureHighlight(place: CampusMapPlace) {
	return (place.mapFeatureRefs?.length ?? 0) > 0;
}

function getSearchRelevance(place: MapPlaceView, normalizedQuery: string) {
	if (!normalizedQuery) {
		return 0;
	}
	if (place.place.title.toLowerCase().includes(normalizedQuery)) {
		return 0;
	}
	if (place.place.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))) {
		return 1;
	}
	if (
		place.place.description.toLowerCase().includes(normalizedQuery) ||
		place.place.campus.toLowerCase().includes(normalizedQuery)
	) {
		return 2;
	}
	return 3;
}

function getTaskGroupOrder(place: MapPlaceView) {
	return TASK_GROUP_DISPLAY_ORDER.indexOf(getTaskGroupLabel(place));
}

function getTaskGroupLabel(place: MapPlaceView): MapPlaceTaskGroupLabel {
	return getTaskGroupLabelForPlace(place.place);
}

function getTaskGroupLabelForPlace(
	place: Pick<CampusMapPlace, "category" | "tags">,
): MapPlaceTaskGroupLabel {
	if (place.tags.includes("食堂")) {
		return "食堂";
	}
	if (place.tags.includes("宿舍") || place.tags.includes("静园") || place.tags.includes("公寓")) {
		return "宿舍";
	}
	if (place.tags.includes("教学") || place.tags.includes("上课")) {
		return "教学楼";
	}
	if (place.category === "gate" || place.category === "transport") {
		return "出入口";
	}
	if (place.tags.includes("运动") || place.category === "landmark") {
		return "运动";
	}
	return "服务";
}

function getTaskFilterForPlace(place: MapPlaceView): MapTaskFilter {
	const label = getTaskGroupLabel(place);
	const option = TASK_FILTER_OPTIONS.find((item) => item.label === label);
	if (!option) {
		throw new Error(`Unsupported campus map task label: ${label}`);
	}
	return option.value;
}

function compareMapPlaceForDisplay(left: MapPlaceView, right: MapPlaceView) {
	const leftDormRank = getDormDisplayRank(left);
	const rightDormRank = getDormDisplayRank(right);
	if (leftDormRank !== rightDormRank) {
		return leftDormRank - rightDormRank;
	}
	const leftJingyuanOrder = getJingyuanBuildingOrder(left.place.title);
	const rightJingyuanOrder = getJingyuanBuildingOrder(right.place.title);
	if (leftJingyuanOrder !== rightJingyuanOrder) {
		return leftJingyuanOrder - rightJingyuanOrder;
	}
	return CHINESE_COLLATOR.compare(left.place.title, right.place.title);
}

function getDormDisplayRank(place: MapPlaceView) {
	if (place.place.tags.includes("宿舍") || place.place.tags.includes("静园")) {
		return 0;
	}
	if (place.place.title.includes("学生") && place.place.tags.includes("公寓")) {
		return 1;
	}
	if (place.place.tags.includes("公寓")) {
		return 2;
	}
	return 1;
}

function getJingyuanBuildingOrder(title: string) {
	const match = /静园([一二三四五六七八九十])号楼/.exec(title);
	return match
		? (JINGYUAN_BUILDING_ORDER.get(match[1] ?? "") ?? Number.POSITIVE_INFINITY)
		: Number.POSITIVE_INFINITY;
}

function sortCampusesForMapExperience(campuses: string[]) {
	return [...campuses].sort((left, right) => {
		const leftIndex = CAMPUS_DISPLAY_ORDER.indexOf(left as (typeof CAMPUS_DISPLAY_ORDER)[number]);
		const rightIndex = CAMPUS_DISPLAY_ORDER.indexOf(right as (typeof CAMPUS_DISPLAY_ORDER)[number]);
		if (leftIndex >= 0 && rightIndex >= 0) {
			return leftIndex - rightIndex;
		}
		if (leftIndex >= 0) {
			return -1;
		}
		if (rightIndex >= 0) {
			return 1;
		}
		return left.localeCompare(right, "zh-Hans-CN");
	});
}
