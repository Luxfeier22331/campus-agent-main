import { canonicalizeDiningWayfindingLayout } from "./wayfinding-canonical.ts";
import type { DiningWayfindingLayout } from "./wayfinding-types.ts";
import { DINING_WAYFINDING_CANVAS, DINING_WAYFINDING_SCHEMA_VERSION } from "./wayfinding-types.ts";

export function createDefaultDiningWayfindingLayout(input: {
	floorId: string;
	floorplanId: string;
	hallId: string;
	label: string;
}): DiningWayfindingLayout {
	return canonicalizeDiningWayfindingLayout({
		canvas: { ...DINING_WAYFINDING_CANVAS },
		entrances: [],
		floorId: input.floorId,
		floorplanId: input.floorplanId,
		hallId: input.hallId,
		label: input.label,
		landmarks: [],
		outline: {
			points: [
				{ x: 80, y: 80 },
				{ x: 1200, y: 80 },
				{ x: 1200, y: 680 },
				{ x: 80, y: 680 },
			],
		},
		partitions: [],
		regions: [],
		schemaVersion: DINING_WAYFINDING_SCHEMA_VERSION,
		structures: [],
		windows: [
			{
				anchorId: "window-01",
				height: 72,
				label: "示例窗口",
				width: 104,
				x: 120,
				y: 120,
			},
		],
	});
}
