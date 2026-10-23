import type { MapGeoJSONFeature, PointLike } from "maplibre-gl";

import type { CampusMapFeatureRef } from "./model";
import type { MapPlaceView } from "./view-model";

export type MapFeatureRefKey = `${string}:${CampusMapFeatureRef["layer"]}:${number}`;

export const INTERACTIVE_CAMPUS_MAP_LAYER_IDS = [
	"campus-building",
	"campus-building-labels",
	"campus-gatehouse-markers",
	"campus-north-gatehouse-label",
	"campus-south-gatehouse-label",
	"campus-sport",
] as const;
export const MAP_HIT_TEST_RADIUS_PX = 8;

export function createFeatureRefKey(featureRef: CampusMapFeatureRef): MapFeatureRefKey {
	return `${featureRef.sourceId}:${featureRef.layer}:${featureRef.fid}`;
}

export function createPlaceFeatureIndex(places: MapPlaceView[]): Map<MapFeatureRefKey, string> {
	const index = new Map<MapFeatureRefKey, string>();
	for (const place of places) {
		for (const featureRef of place.featureRefs) {
			index.set(createFeatureRefKey(featureRef), place.place.id);
		}
	}
	return index;
}

export function findPlaceForRenderedFeature(
	index: Map<MapFeatureRefKey, string>,
	feature: Pick<MapGeoJSONFeature, "properties" | "source">,
) {
	const sourceId = typeof feature.source === "string" ? feature.source : null;
	const layer = readFeatureLayer(feature.properties);
	const fid = readFeatureId(feature.properties);
	if (!(sourceId && layer && fid !== null)) {
		return null;
	}
	return index.get(createFeatureRefKey({ fid, layer, sourceId })) ?? null;
}

export function createHitTestBox(
	point: { x: number; y: number },
	radius = MAP_HIT_TEST_RADIUS_PX,
): [PointLike, PointLike] {
	return [
		[point.x - radius, point.y - radius],
		[point.x + radius, point.y + radius],
	];
}

function readFeatureLayer(properties: MapGeoJSONFeature["properties"]) {
	const value = properties?.layer;
	switch (value) {
		case "boundary":
		case "building":
		case "sport":
			return value;
		default:
			return null;
	}
}

function readFeatureId(properties: MapGeoJSONFeature["properties"]) {
	const value = properties?.fid;
	if (typeof value === "number" && Number.isInteger(value)) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value)) {
		return Number(value);
	}
	return null;
}
