import { requestJson } from "@/platform/api/client";
import type { CampusMapManifest, CampusMapPlace, CampusMapPlacesResponse } from "./model";

const CAMPUS_MAP_DATA_URL_PATTERN = /^\/api\/campus-map\/assets\/[0-9a-f]{64}\.geojson$/;

export async function getCampusMapPlaces(
	input: { signal?: AbortSignal } = {},
): Promise<CampusMapPlacesResponse> {
	return requestJson<CampusMapPlacesResponse>({
		path: "/api/campus-map/places",
		...(input.signal ? { signal: input.signal } : {}),
	});
}

export async function getCampusMapPlace(placeId: string): Promise<CampusMapPlace> {
	const payload = await requestJson<{ place: CampusMapPlace }>({
		path: `/api/campus-map/places/${encodeURIComponent(placeId)}`,
	});
	return payload.place;
}

export async function getCampusMapManifest(
	input: { signal?: AbortSignal } = {},
): Promise<CampusMapManifest> {
	const payload = await requestJson<unknown>({
		path: "/api/campus-map/manifest",
		...(input.signal ? { signal: input.signal } : {}),
	});
	return normalizeCampusMapManifest(payload);
}

function normalizeCampusMapManifest(payload: unknown): CampusMapManifest {
	if (!isRecord(payload)) {
		throw new Error("Campus map manifest is invalid.");
	}
	const attribution = payload.attribution;
	const campuses = payload.campuses;
	const licenseBoundary = payload.licenseBoundary;
	if (
		!(
			Array.isArray(attribution) &&
			attribution.length > 0 &&
			attribution.every((item) => typeof item === "string" && item.trim().length > 0) &&
			isRecord(campuses) &&
			Object.keys(campuses).length > 0 &&
			typeof licenseBoundary === "string" &&
			licenseBoundary.trim().length > 0
		)
	) {
		throw new Error("Campus map manifest is invalid.");
	}

	const normalizedCampuses: CampusMapManifest["campuses"] = {};
	for (const [campusId, campus] of Object.entries(campuses)) {
		if (!(isCampusMapManifestCampus(campus) && /^[a-z0-9-]+$/.test(campusId))) {
			throw new Error("Campus map manifest is invalid.");
		}
		normalizedCampuses[campusId] = campus;
	}

	return {
		attribution,
		campuses: normalizedCampuses,
		licenseBoundary,
	};
}

function isCampusMapManifestCampus(input: unknown): input is CampusMapManifest["campuses"][string] {
	if (!isRecord(input)) {
		return false;
	}
	const bounds = input.bounds;
	const geojsonUrl = input.geojsonUrl;
	const name = input.name;
	return (
		Array.isArray(bounds) &&
		bounds.length === 4 &&
		bounds.every((value) => typeof value === "number" && Number.isFinite(value)) &&
		bounds[0] < bounds[2] &&
		bounds[1] < bounds[3] &&
		typeof geojsonUrl === "string" &&
		CAMPUS_MAP_DATA_URL_PATTERN.test(geojsonUrl) &&
		typeof name === "string" &&
		name.trim().length > 0
	);
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}
