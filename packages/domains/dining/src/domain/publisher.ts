import { createHash } from "node:crypto";
import {
	canonicalizeDiningFloorplanBundle,
	type DiningFloorplanBundleV1,
	serializeDiningFloorplanBundle,
} from "../floorplans/bundle.ts";
import {
	assertDiningWayfindingPublishableLayout,
	createDiningRenderedFloorplan,
	renderDiningWayfindingSvg,
	sanitizeDiningFloorplanSvg,
} from "../floorplans/index.ts";
import type { DiningMapResponse } from "./map.ts";

export interface DiningMapPublishedAsset {
	canvas: { height: number; width: number };
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
	svgAssetUrl: string;
	svgMarkup: string;
}

export function diningMapBundleFingerprint(value: unknown): `sha256:${string}` {
	return sha256Tag(serializeDiningFloorplanBundle(value));
}

export function renderDiningMapAssets(value: unknown): DiningMapPublishedAsset[] {
	const bundle = canonicalizeDiningFloorplanBundle(value);
	return bundle.layouts.map((layout) => {
		assertDiningWayfindingPublishableLayout(layout);
		const svgMarkup = sanitizeDiningFloorplanSvg(renderDiningWayfindingSvg(layout));
		const sha256 = sha256Tag(svgMarkup);
		return createDiningRenderedFloorplan({
			anchorInventory: layout.windows.map((window) => ({
				anchorId: window.anchorId,
				label: window.label,
				role: "window",
			})),
			floorId: layout.floorId,
			floorplanId: layout.floorplanId,
			hallId: layout.hallId,
			sha256,
			svgMarkup,
		});
	});
}

export function buildDiningMapResponse(input: {
	assets: DiningMapPublishedAsset[];
	bundle: DiningFloorplanBundleV1;
	releaseId: string;
	updatedAt: string;
}): DiningMapResponse {
	const assetByFloorId = new Map(input.assets.map((asset) => [asset.floorId, asset]));
	return {
		halls: input.bundle.halls.map((hall) => ({
			campus: hall.campus,
			floors: input.bundle.layouts
				.filter((layout) => layout.hallId === hall.hallId)
				.map((layout) => {
					const asset = assetByFloorId.get(layout.floorId);
					if (!asset || asset.floorplanId !== layout.floorplanId) {
						throw new Error(`Dining floorplan asset is missing: ${layout.floorId}`);
					}
					return {
						floorId: layout.floorId,
						floorplan: {
							canvas: asset.canvas,
							floorplanId: asset.floorplanId,
							sha256: asset.sha256,
							svgAssetUrl: asset.svgAssetUrl,
						},
						label: layout.label,
						windows: layout.windows.map((window) => ({
							name: window.label,
							svgAnchorId: window.anchorId,
							windowId: `${layout.hallId}:${layout.floorId}:${window.anchorId}`,
						})),
					};
				}),
			hallId: hall.hallId,
			name: hall.name,
		})),
		releaseId: input.releaseId,
		updatedAt: input.updatedAt,
	};
}

function sha256Tag(value: string): `sha256:${string}` {
	return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
