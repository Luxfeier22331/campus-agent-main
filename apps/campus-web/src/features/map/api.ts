import { requestJson } from "@/platform/api/client";
import type { CampusMapManifest, CampusMapPlace, CampusMapPlacesResponse } from "./model";

const CAMPUS_MAP_DATA_URL_PATTERN =
	/^\/map-data\/v[0-9]{4}-[0-9]{2}-[0-9]{2}\/geojson\/[a-z0-9-]+\.geojson$/;
const CAMPUS_MAP_TILE_URL_TEMPLATE_PATTERN =
	/^\/map-data\/v[0-9]{4}-[0-9]{2}-[0-9]{2}\/tiles\/[a-z0-9-]+\/\{z\}\/\{x\}\/\{y\}\.png$/;

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

export async function getCampusMapManifest(): Promise<CampusMapManifest> {
	const payload = await requestJson<unknown>({
		path: "/map-data/manifest.json",
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
	const version = payload.version;
	if (
		!(
			Array.isArray(attribution) &&
			attribution.every((item) => typeof item === "string") &&
			isRecord(campuses) &&
			typeof licenseBoundary === "string" &&
			typeof version === "string"
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
		version,
	};
}

function isCampusMapManifestCampus(input: unknown): input is CampusMapManifest["campuses"][string] {
	if (!isRecord(input)) {
		return false;
	}
	const bounds = input.bounds;
	const geojsonUrl = input.geojsonUrl;
	const name = input.name;
	const tileUrlTemplate = input.tileUrlTemplate;
	return (
		Array.isArray(bounds) &&
		bounds.length === 4 &&
		bounds.every((value) => typeof value === "number" && Number.isFinite(value)) &&
		typeof geojsonUrl === "string" &&
		CAMPUS_MAP_DATA_URL_PATTERN.test(geojsonUrl) &&
		typeof name === "string" &&
		(tileUrlTemplate === undefined ||
			(typeof tileUrlTemplate === "string" &&
				CAMPUS_MAP_TILE_URL_TEMPLATE_PATTERN.test(tileUrlTemplate)))
	);
}

function isRecord(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}
