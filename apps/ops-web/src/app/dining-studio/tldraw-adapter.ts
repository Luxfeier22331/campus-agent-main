import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	type DiningWayfindingLayout,
	type DiningWayfindingPoint,
} from "@campus-agent/dining/floorplans";
import { createShapeId, type TLCreateShapePartial, type TLShape } from "tldraw";
import type {
	DiningEditorPathLayer,
	DiningEditorShape,
	DiningEntranceShape,
	DiningLandmarkShape,
	DiningPathShape,
	DiningRegionShape,
	DiningWindowShape,
} from "./tldraw-shapes";

export function layoutToTldrawRecords(
	layout: DiningWayfindingLayout,
): TLCreateShapePartial<DiningEditorShape>[] {
	const canonical = canonicalizeDiningWayfindingLayout(layout);
	return [
		pathRecord(canonical.floorId, "outline", "outline", canonical.outline.points, true),
		...canonical.regions.map((region) => regionRecord(canonical.floorId, region)),
		...canonical.structures.map((structure) =>
			pathRecord(canonical.floorId, "structure", structure.id, structure.points, true),
		),
		...canonical.partitions.map((partition) =>
			pathRecord(canonical.floorId, "partition", partition.id, partition.points, false),
		),
		...canonical.landmarks.map((landmark) => landmarkRecord(canonical.floorId, landmark)),
		...canonical.entrances.map((entrance) => entranceRecord(canonical.floorId, entrance)),
		...canonical.windows.map((window) => windowRecord(canonical.floorId, window)),
	];
}

export function tldrawRecordsToDraft(
	shapes: readonly TLShape[],
	baseLayout: DiningWayfindingLayout,
): DiningWayfindingLayout {
	const next = structuredClone(baseLayout);
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
		if (shape.type === "dining-window") {
			next.windows.push({ anchorId: shape.props.entityId, ...shapeRect(shape) });
		} else if (shape.type === "dining-region") {
			next.regions.push({
				iconKey: shape.props.iconKey,
				id: shape.props.entityId,
				...shapeRect(shape),
			});
		} else if (shape.type === "dining-landmark") {
			next.landmarks.push({
				id: shape.props.entityId,
				kind: shape.props.landmarkKind,
				...shapeRect(shape),
			});
		} else if (shape.type === "dining-entrance") {
			next.entrances.push({
				id: shape.props.entityId,
				side: shape.props.side,
				...shapeRect(shape),
			});
		} else {
			throw new Error(`Unsupported shape in dining editor: ${shape.type}`);
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
	return next;
}

function shapeRect(
	shape: DiningEntranceShape | DiningLandmarkShape | DiningRegionShape | DiningWindowShape,
) {
	return {
		height: shape.props.h,
		label: shape.props.label,
		width: shape.props.w,
		x: shape.x,
		y: shape.y,
	};
}

export function tldrawRecordsToLayout(
	shapes: readonly TLShape[],
	baseLayout: DiningWayfindingLayout,
): DiningWayfindingLayout {
	const next = tldrawRecordsToDraft(shapes, baseLayout);
	assertDiningWayfindingLayout(next);
	return canonicalizeDiningWayfindingLayout(next);
}

export function shapeIdForDiningEntity(floorId: string, kind: string, entityId: string) {
	return createShapeId(`${floorId}-${kind}-${entityId}`);
}

function pathRecord(
	floorId: string,
	layer: DiningEditorPathLayer,
	entityId: string,
	points: DiningWayfindingPoint[],
	closed: boolean,
): TLCreateShapePartial<DiningPathShape> {
	const origin = pointOrigin(points);
	return {
		id: shapeIdForDiningEntity(floorId, layer === "outline" ? "path" : layer, entityId),
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

function windowRecord(
	floorId: string,
	window: DiningWayfindingLayout["windows"][number],
): TLCreateShapePartial<DiningWindowShape> {
	return {
		id: shapeIdForDiningEntity(floorId, "window", window.anchorId),
		meta: { diningCanonical: true },
		props: {
			entityId: window.anchorId,
			h: window.height,
			label: window.label,
			w: window.width,
		},
		type: "dining-window",
		x: window.x,
		y: window.y,
	};
}

function regionRecord(
	floorId: string,
	region: DiningWayfindingLayout["regions"][number],
): TLCreateShapePartial<DiningRegionShape> {
	return {
		id: shapeIdForDiningEntity(floorId, "region", region.id),
		meta: { diningCanonical: true },
		props: {
			entityId: region.id,
			h: region.height,
			iconKey: region.iconKey,
			label: region.label,
			w: region.width,
		},
		type: "dining-region",
		x: region.x,
		y: region.y,
	};
}

function entranceRecord(
	floorId: string,
	entrance: DiningWayfindingLayout["entrances"][number],
): TLCreateShapePartial<DiningEntranceShape> {
	return {
		id: shapeIdForDiningEntity(floorId, "entrance", entrance.id),
		meta: { diningCanonical: true },
		props: {
			entityId: entrance.id,
			h: entrance.height,
			label: entrance.label,
			side: entrance.side,
			w: entrance.width,
		},
		type: "dining-entrance",
		x: entrance.x,
		y: entrance.y,
	};
}

function landmarkRecord(
	floorId: string,
	landmark: DiningWayfindingLayout["landmarks"][number],
): TLCreateShapePartial<DiningLandmarkShape> {
	return {
		id: shapeIdForDiningEntity(floorId, "landmark", landmark.id),
		meta: { diningCanonical: true },
		props: {
			entityId: landmark.id,
			h: landmark.height,
			label: landmark.label,
			landmarkKind: landmark.kind,
			w: landmark.width,
		},
		type: "dining-landmark",
		x: landmark.x,
		y: landmark.y,
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
