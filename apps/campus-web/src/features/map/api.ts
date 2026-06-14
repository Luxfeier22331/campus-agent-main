import { requestJson } from "@/platform/api/client";
import type { CampusMapPlace, CampusMapPlacesResponse } from "./model";

export async function getCampusMapPlaces(): Promise<CampusMapPlacesResponse> {
	return requestJson<CampusMapPlacesResponse>({
		path: "/api/campus-map/places",
	});
}

export async function getCampusMapPlace(placeId: string): Promise<CampusMapPlace> {
	const payload = await requestJson<{ place: CampusMapPlace }>({
		path: `/api/campus-map/places/${encodeURIComponent(placeId)}`,
	});
	return payload.place;
}
