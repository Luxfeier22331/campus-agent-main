import { createShapeId, type TLCreateShapePartial, type TLShape } from "tldraw";

import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	type DiningWayfindingLayout,
	type DiningWayfindingPoint,
} from "../src/floorplans/wayfinding-layout";
import type {
	DiningEditorMarkerKind,
	DiningEditorPathLayer,
	DiningMarkerShape,
	DiningPathShape,
} from "./tldraw-shapes";

export const DINING_REFERENCE_SHAPE_META_KEY = "diningReference";

export function layoutToTldrawRecords(
	layout: DiningWayfindingLayout,
): TLCreateShapePartial<DiningMarkerShape | DiningPathShape>[] {
	const canonical = canonicalizeDiningWayfindingLayout(layout);
	return [
		pathRecord("outline", "outline", canonical.outline.points, true),
		...canonical.regions.map((region) =>
			markerRecord("region", region.id, region.x, region.y, region.width, region.height, {
				iconKey: region.iconKey,
				label: region.label,
			}),
		),
		...canonical.structures.map((structure) =>
			pathRecord("structure", structure.id, structure.points, true),
		),
		...canonical.partitions.map((partition) =>
			pathRecord("partition", partition.id, partition.points, false),
		),
		...canonical.landmarks.map((landmark) =>
			markerRecord(
				"landmark",
				landmark.id,
				landmark.x,
				landmark.y,
				landmark.width,
				landmark.height,
				{ label: landmark.label, landmarkKind: landmark.kind },
			),
		),
		...canonical.entrances.map((entrance) =>
			markerRecord(
				"entrance",
				entrance.id,
				entrance.x,
				entrance.y,
				entrance.width,
				entrance.height,
				{ label: entrance.label, side: entrance.side },
			),
		),
		...canonical.windows.map((window) =>
			markerRecord("window", window.anchorId, window.x, window.y, window.width, window.height, {
				label: window.label,
			}),
		),
	];
}

export function tldrawRecordsToLayout(
	shapes: readonly TLShape[],
	baseLayout: DiningWayfindingLayout,
): DiningWayfindingLayout {
	const next = canonicalizeDiningWayfindingLayout(baseLayout);
	const baseOrder = {
		entrances: next.entrances.map((item) => item.id),
		landmarks: next.landmarks.map((item) => item.id),
		partitions: next.partitions.map((item) => item.id),
		regions: next.regions.map((item) => item.id),
		structures: next.structures.map((item) => item.id),
	};
	next.entrances = [];
	next.landmarks = [];
	next.partitions = [];
	next.regions = [];
	next.structures = [];
	next.windows = [];
	let outline: DiningWayfindingPoint[] | null = null;

	for (const shape of shapes) {
		if (isReferenceShape(shape)) {
			continue;
		}
		if (shape.rotation !== 0) {
			throw new Error(`Dining editor shape must not be rotated: ${shape.id}`);
		}
		if (shape.type === "dining-path") {
			const points = shape.props.points.map((point) => ({
				x: shape.x + point.x,
				y: shape.y + point.y,
			}));
			if (shape.props.layer === "outline") {
				if (outline) {
					throw new Error("Dining editor must contain exactly one outline.");
				}
				outline = points;
			} else if (shape.props.layer === "structure") {
				next.structures.push({ id: shape.props.entityId, points });
			} else {
				next.partitions.push({ id: shape.props.entityId, points });
			}
			continue;
		}
		if (shape.type !== "dining-marker") {
			throw new Error(`Unsupported shape in dining editor: ${shape.type}`);
		}
		const marker = shape.props;
		const rect = {
			height: marker.h,
			label: marker.label,
			width: marker.w,
			x: shape.x,
			y: shape.y,
		};
		if (marker.markerKind === "window") {
			next.windows.push({ anchorId: marker.entityId, ...rect });
		} else if (marker.markerKind === "region") {
			next.regions.push({ iconKey: marker.iconKey, id: marker.entityId, ...rect });
		} else if (marker.markerKind === "landmark") {
			if (!marker.landmarkKind) {
				throw new Error(`Dining landmark kind is missing: ${marker.entityId}`);
			}
			next.landmarks.push({ id: marker.entityId, kind: marker.landmarkKind, ...rect });
		} else {
			if (!marker.side) {
				throw new Error(`Dining entrance side is missing: ${marker.entityId}`);
			}
			next.entrances.push({ id: marker.entityId, side: marker.side, ...rect });
		}
	}

	if (!outline) {
		throw new Error("Dining editor outline is missing.");
	}
	next.outline = { points: outline };
	sortByBaseOrder(next.entrances, baseOrder.entrances);
	sortByBaseOrder(next.landmarks, baseOrder.landmarks);
	sortByBaseOrder(next.partitions, baseOrder.partitions);
	sortByBaseOrder(next.regions, baseOrder.regions);
	sortByBaseOrder(next.structures, baseOrder.structures);
	next.windows.sort((left, right) => left.anchorId.localeCompare(right.anchorId));
	assertDiningWayfindingLayout(next);
	return canonicalizeDiningWayfindingLayout(next);
}

export function isReferenceShape(shape: TLShape): boolean {
	return shape.type === "image" && shape.meta[DINING_REFERENCE_SHAPE_META_KEY] === true;
}

export function shapeIdForDiningEntity(kind: DiningEditorMarkerKind, entityId: string) {
	return createShapeId(`${kind}-${entityId}`);
}

function pathRecord(
	layer: DiningEditorPathLayer,
	entityId: string,
	points: DiningWayfindingPoint[],
	closed: boolean,
): TLCreateShapePartial<DiningPathShape> {
	const origin = pointOrigin(points);
	return {
		id: createShapeId(layer === "outline" ? "path-outline" : `${layer}-${entityId}`),
		meta: { diningCanonical: true },
		props: {
			closed,
			entityId,
			layer,
			points: points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y })),
		},
		type: "dining-path",
		x: origin.x,
		y: origin.y,
	};
}

function markerRecord(
	markerKind: DiningEditorMarkerKind,
	entityId: string,
	x: number,
	y: number,
	w: number,
	h: number,
	options: Partial<Pick<DiningMarkerShape["props"], "iconKey" | "label" | "landmarkKind" | "side">>,
): TLCreateShapePartial<DiningMarkerShape> {
	return {
		id: shapeIdForDiningEntity(markerKind, entityId),
		meta: { diningCanonical: true },
		props: {
			entityId,
			h,
			iconKey: options.iconKey ?? null,
			label: options.label ?? entityId,
			landmarkKind: options.landmarkKind ?? null,
			markerKind,
			side: options.side ?? null,
			w,
		},
		type: "dining-marker",
		x,
		y,
	};
}

function pointOrigin(points: DiningWayfindingPoint[]): DiningWayfindingPoint {
	return points.reduce(
		(origin, point) => ({ x: Math.min(origin.x, point.x), y: Math.min(origin.y, point.y) }),
		{ x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
	);
}

function sortByBaseOrder<T extends { id: string }>(items: T[], baseIds: string[]): void {
	const indexById = new Map(baseIds.map((id, index) => [id, index]));
	items.sort((left, right) => {
		const leftIndex = indexById.get(left.id) ?? Number.POSITIVE_INFINITY;
		const rightIndex = indexById.get(right.id) ?? Number.POSITIVE_INFINITY;
		return leftIndex - rightIndex || left.id.localeCompare(right.id);
	});
}
