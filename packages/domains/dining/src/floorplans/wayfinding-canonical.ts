import type { DiningWayfindingLayout, DiningWayfindingPoint } from "./wayfinding-types.ts";
import { DINING_WAYFINDING_SCHEMA_VERSION } from "./wayfinding-types.ts";
import { assertDiningWayfindingLayout } from "./wayfinding-validation.ts";

export function canonicalizeDiningWayfindingLayout(
	value: DiningWayfindingLayout,
): DiningWayfindingLayout {
	assertDiningWayfindingLayout(value);
	const canonical: DiningWayfindingLayout = {
		canvas: { height: value.canvas.height, width: value.canvas.width },
		entrances: value.entrances.map((entrance) => ({
			height: canonicalizeNumber(entrance.height),
			id: entrance.id.trim(),
			label: entrance.label.trim(),
			side: entrance.side,
			width: canonicalizeNumber(entrance.width),
			x: canonicalizeNumber(entrance.x),
			y: canonicalizeNumber(entrance.y),
		})),
		floorId: value.floorId.trim(),
		floorplanId: value.floorplanId.trim(),
		hallId: value.hallId.trim(),
		label: value.label.trim(),
		landmarks: value.landmarks.map((landmark) => ({
			height: canonicalizeNumber(landmark.height),
			id: landmark.id.trim(),
			kind: landmark.kind,
			label: landmark.label.trim(),
			width: canonicalizeNumber(landmark.width),
			x: canonicalizeNumber(landmark.x),
			y: canonicalizeNumber(landmark.y),
		})),
		outline: { points: canonicalizePoints(value.outline.points) },
		partitions: value.partitions.map((partition) => ({
			id: partition.id.trim(),
			points: canonicalizePoints(partition.points),
		})),
		regions: value.regions.map((region) => ({
			height: canonicalizeNumber(region.height),
			iconKey: region.iconKey,
			id: region.id.trim(),
			label: region.label.trim(),
			width: canonicalizeNumber(region.width),
			x: canonicalizeNumber(region.x),
			y: canonicalizeNumber(region.y),
		})),
		schemaVersion: DINING_WAYFINDING_SCHEMA_VERSION,
		structures: value.structures.map((structure) => ({
			id: structure.id.trim(),
			points: canonicalizePoints(structure.points),
		})),
		windows: value.windows.map((window) => ({
			anchorId: window.anchorId.trim(),
			height: canonicalizeNumber(window.height),
			label: window.label.trim(),
			width: canonicalizeNumber(window.width),
			x: canonicalizeNumber(window.x),
			y: canonicalizeNumber(window.y),
		})),
	};
	assertDiningWayfindingLayout(canonical);
	return canonical;
}

export function serializeDiningWayfindingLayout(value: DiningWayfindingLayout): string {
	return `${JSON.stringify(canonicalizeDiningWayfindingLayout(value), null, "\t")}\n`;
}

export function canonicalizePoints(points: DiningWayfindingPoint[]): DiningWayfindingPoint[] {
	return points.map((point) => ({
		x: canonicalizeNumber(point.x),
		y: canonicalizeNumber(point.y),
	}));
}

export function canonicalizeNumber(value: number): number {
	const rounded = Math.round(value * 1_000) / 1_000;
	return Object.is(rounded, -0) ? 0 : rounded;
}
