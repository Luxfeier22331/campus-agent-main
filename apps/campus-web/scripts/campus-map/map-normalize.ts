import {
	isInsideBounds,
	isObject,
	readSafeInteger,
	readString,
	visitCoordinates,
} from "./map-format.ts";
import type {
	CampusId,
	GeoJsonCollection,
	GeoJsonFeature,
	Place,
	PlaceFeatureRef,
	PlacesDocument,
} from "./map-model.ts";
import { CAMPUS_CONFIG } from "./map-model.ts";

export function normalizeGeoJson(value: unknown, campus: CampusId): GeoJsonCollection {
	if (!isObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
		throw new Error(`Invalid GeoJSON FeatureCollection for ${campus}.`);
	}
	const identities = new Set<string>();
	const features = value.features.map((feature, index) => {
		if (!isObject(feature) || feature.type !== "Feature" || !isObject(feature.properties)) {
			throw new Error(`Invalid GeoJSON feature ${campus}:${index}.`);
		}
		const layer = readString(feature.properties.layer);
		const fid = readSafeInteger(feature.properties.fid);
		if (!layer || fid === null) {
			throw new Error(`Missing feature identity ${campus}:${index}.`);
		}
		const identity = `${layer}:${fid}`;
		if (identities.has(identity)) {
			throw new Error(`Duplicate feature identity: ${campus}:${identity}`);
		}
		identities.add(identity);
		if (!["boundary", "building", "green", "roadp", "sport"].includes(layer)) {
			throw new Error(`Unsupported map layer ${layer}.`);
		}
		if (!isObject(feature.geometry) || typeof feature.geometry.type !== "string") {
			throw new Error(`Invalid feature geometry ${campus}:${fid}.`);
		}
		visitCoordinates(feature.geometry.coordinates, () => undefined);
		return {
			geometry: feature.geometry as GeoJsonFeature["geometry"],
			properties: feature.properties,
			type: "Feature" as const,
		};
	});
	features.sort((left, right) => {
		const layerLeft = String(left.properties.layer);
		const layerRight = String(right.properties.layer);
		const layerCompare = layerLeft < layerRight ? -1 : layerLeft > layerRight ? 1 : 0;
		return layerCompare || Number(left.properties.fid) - Number(right.properties.fid);
	});
	return { features, type: "FeatureCollection" };
}

export function normalizePlaces(value: unknown): PlacesDocument {
	if (!(isObject(value) && isObject(value.campus) && Array.isArray(value.places))) {
		throw new Error("Invalid campus map places document.");
	}
	const campus = value.campus;
	if (
		typeof campus.id !== "string" ||
		typeof campus.name !== "string" ||
		!Array.isArray(campus.defaultCenter) ||
		campus.defaultCenter.length !== 2 ||
		!campus.defaultCenter.every((item) => typeof item === "number" && Number.isFinite(item))
	) {
		throw new Error("Invalid campus map places campus metadata.");
	}
	const ids = new Set<string>();
	const places = value.places.map((item, index) => {
		if (!isObject(item) || typeof item.id !== "string" || !item.id || ids.has(item.id)) {
			throw new Error(`Invalid or duplicate place id at index ${index}.`);
		}
		ids.add(item.id);
		const campusName = readString(item.campus);
		const campusConfig = campusName ? getCampusConfigByName(campusName) : null;
		if (
			typeof item.campus !== "string" ||
			!campusConfig ||
			!isPlaceCategory(item.category) ||
			typeof item.title !== "string" ||
			item.title.trim().length === 0 ||
			typeof item.description !== "string" ||
			item.description.trim().length === 0 ||
			(item.accessNote !== null && typeof item.accessNote !== "string") ||
			!Array.isArray(item.sourceRefs) ||
			item.sourceRefs.length === 0 ||
			!item.sourceRefs.every((ref) => typeof ref === "string") ||
			!Array.isArray(item.tags) ||
			!item.tags.every((tag) => typeof tag === "string") ||
			!isObject(item.geojson) ||
			item.geojson.type !== "Feature" ||
			!isObject(item.geojson.geometry) ||
			item.geojson.geometry.type !== "Point" ||
			!Array.isArray(item.geojson.geometry.coordinates) ||
			item.geojson.geometry.coordinates.length !== 2
		) {
			throw new Error(`Invalid place document: ${item.id}.`);
		}
		const coordinates = item.geojson.geometry.coordinates;
		if (
			!coordinates.every(
				(coordinate, coordinateIndex) =>
					typeof coordinate === "number" &&
					Number.isFinite(coordinate) &&
					(coordinateIndex === 0
						? coordinate >= -180 && coordinate <= 180
						: coordinate >= -90 && coordinate <= 90),
			)
		) {
			throw new Error(`Invalid place coordinates: ${item.id}.`);
		}
		if (
			!(
				isInsideBounds(coordinates as [number, number], campusConfig.bounds) ||
				(item.category === "transport" && !item.mapFeatureRefs)
			)
		) {
			throw new Error(`Place ${item.id} is outside ${campusName} bounds.`);
		}
		if (
			!isObject(item.geojson.properties) ||
			item.geojson.properties.placeId !== item.id ||
			item.geojson.properties.title !== item.title ||
			item.geojson.properties.category !== item.category
		) {
			throw new Error(`Place GeoJSON properties do not match ${item.id}.`);
		}
		if (item.mapFeatureRefs !== undefined) {
			if (!Array.isArray(item.mapFeatureRefs)) {
				throw new Error(`Invalid feature references: ${item.id}.`);
			}
			for (const ref of item.mapFeatureRefs) {
				if (
					!isObject(ref) ||
					readSafeInteger(ref.fid) === null ||
					!isMapFeatureLayer(ref.layer) ||
					ref.sourceId !== campusConfig.sourceId
				) {
					throw new Error(`Invalid feature reference: ${item.id}.`);
				}
			}
		}
		return item as unknown as Place;
	});
	return {
		campus: {
			defaultCenter: campus.defaultCenter as [number, number],
			id: campus.id,
			name: campus.name,
		},
		places,
	};
}

function isPlaceCategory(value: unknown): value is Place["category"] {
	return (
		value === "building" ||
		value === "gate" ||
		value === "landmark" ||
		value === "service" ||
		value === "transport"
	);
}

function getCampusConfigByName(name: string): (typeof CAMPUS_CONFIG)[CampusId] | null {
	for (const campus of Object.values(CAMPUS_CONFIG)) {
		if (campus.name === name) {
			return campus;
		}
	}
	return null;
}

function isMapFeatureLayer(value: unknown): value is PlaceFeatureRef["layer"] {
	return value === "boundary" || value === "building" || value === "sport";
}
