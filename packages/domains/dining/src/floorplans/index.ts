import { DINING_FLOORPLAN_ASSETS } from "./assets.ts";
import {
	createDiningFloorplanManifestEntry,
	type DiningFloorplanManifestEntry,
} from "./floorplan-contract.ts";
import { DINING_WAYFINDING_LAYOUTS } from "./layout-registry.ts";
import { renderDiningWayfindingSvg } from "./wayfinding-layout.ts";

const generatedAssetByFloorId = new Map(
	DINING_FLOORPLAN_ASSETS.map((asset) => [asset.floorId, asset]),
);

export const DINING_FLOORPLAN_MANIFEST: DiningFloorplanManifestEntry[] =
	DINING_WAYFINDING_LAYOUTS.map((layout) => {
		const asset = generatedAssetByFloorId.get(layout.floorId);
		if (!asset || asset.hallId !== layout.hallId || asset.floorplanId !== layout.floorplanId) {
			throw new Error(`Dining floorplan generated asset is missing or stale: ${layout.floorId}`);
		}
		return createDiningFloorplanManifestEntry({
			anchorInventory: layout.windows.map((window) => ({
				anchorId: window.anchorId,
				label: window.label,
				role: "window",
			})),
			floorId: layout.floorId,
			floorplanId: layout.floorplanId,
			hallId: layout.hallId,
			sha256: asset.sha256,
			svgMarkup: renderDiningWayfindingSvg(layout),
		});
	});

if (generatedAssetByFloorId.size !== DINING_WAYFINDING_LAYOUTS.length) {
	throw new Error("Dining floorplan generated asset manifest contains stale entries.");
}

export function getDiningFloorplanByFloor(input: {
	floorId: string;
	hallId: string;
}): DiningFloorplanManifestEntry {
	const match = DINING_FLOORPLAN_MANIFEST.find(
		(entry) => entry.hallId === input.hallId && entry.floorId === input.floorId,
	);
	if (!match) {
		throw new Error(`Dining floorplan manifest entry not found: ${input.hallId}/${input.floorId}`);
	}
	return match;
}

export type {
	DiningFloorplanAnchor,
	DiningFloorplanAnchorRole,
	DiningFloorplanManifestEntry,
	DiningFloorplanManifestInput,
} from "./floorplan-contract.ts";
export {
	assertDiningFloorplanManifest,
	buildDiningFloorplanAssetUrl,
	createDiningFloorplanManifestEntry,
	sanitizeDiningFloorplanSvg,
} from "./floorplan-contract.ts";
export { DINING_WAYFINDING_LAYOUTS } from "./layout-registry.ts";
export type {
	DiningWayfindingCanvas,
	DiningWayfindingEntrance,
	DiningWayfindingIconKey,
	DiningWayfindingLandmark,
	DiningWayfindingLayout,
	DiningWayfindingPoint,
	DiningWayfindingPolygon,
	DiningWayfindingPolyline,
	DiningWayfindingRect,
	DiningWayfindingRegion,
	DiningWayfindingWindow,
} from "./wayfinding-layout.ts";
export {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	DINING_WAYFINDING_CANVAS,
	DINING_WAYFINDING_ICON_KEYS,
	DINING_WAYFINDING_MIN_WINDOW,
	DINING_WAYFINDING_SCHEMA_VERSION,
	renderDiningWayfindingSvg,
	serializeDiningWayfindingLayout,
} from "./wayfinding-layout.ts";
