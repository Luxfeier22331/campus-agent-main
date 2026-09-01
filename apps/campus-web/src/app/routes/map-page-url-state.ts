import type { MapTaskFilter } from "@/features/map/view-model";

export function readMapUrlState(campuses: string[]) {
	if (typeof window === "undefined") {
		return {
			campus: null,
			category: "all" as MapTaskFilter,
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

export function writeMapUrlState(input: {
	category: MapTaskFilter;
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

function readMapCategoryParam(value: string | null): MapTaskFilter {
	switch (value) {
		case "dining":
		case "teaching":
		case "dorm":
		case "entrance":
		case "service":
		case "sport":
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
