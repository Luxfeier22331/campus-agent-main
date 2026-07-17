import generatedAssetsJson from "./generated-assets.json" with { type: "json" };

export interface DiningFloorplanAssetAnchor {
	anchorId: string;
	label?: string;
	role: "window";
}

export interface DiningFloorplanAssetEntry {
	anchorInventory: DiningFloorplanAssetAnchor[];
	canvas: { height: number; width: number };
	floorId: string;
	floorplanId: string;
	hallId: string;
	sha256: `sha256:${string}`;
	svgAssetUrl: string;
}

export const DINING_FLOORPLAN_ASSETS = parseGeneratedAssetManifest(generatedAssetsJson);

export function getDiningFloorplanAssetById(floorplanId: string): DiningFloorplanAssetEntry {
	const asset = DINING_FLOORPLAN_ASSETS.find((entry) => entry.floorplanId === floorplanId);
	if (!asset) {
		throw new Error(`Dining floorplan asset is missing: ${floorplanId}`);
	}
	return asset;
}

function parseGeneratedAssetManifest(value: unknown): DiningFloorplanAssetEntry[] {
	if (!value || typeof value !== "object") {
		throw new Error("Dining generated asset manifest must be an object.");
	}
	const manifest = value as { assets?: unknown; schemaVersion?: unknown };
	if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.assets)) {
		throw new Error("Dining generated asset manifest schema is invalid.");
	}
	const seenFloorIds = new Set<string>();
	const seenFloorplanIds = new Set<string>();
	return manifest.assets.map((value) => {
		const asset = parseAsset(value);
		if (seenFloorIds.has(asset.floorId) || seenFloorplanIds.has(asset.floorplanId)) {
			throw new Error(`Duplicate dining generated asset: ${asset.floorplanId}`);
		}
		seenFloorIds.add(asset.floorId);
		seenFloorplanIds.add(asset.floorplanId);
		return asset;
	});
}

function parseAsset(value: unknown): DiningFloorplanAssetEntry {
	if (!value || typeof value !== "object") {
		throw new Error("Dining generated asset entry must be an object.");
	}
	const asset = value as Record<string, unknown>;
	if (
		typeof asset.floorId !== "string" ||
		typeof asset.floorplanId !== "string" ||
		typeof asset.hallId !== "string" ||
		typeof asset.sha256 !== "string" ||
		!/^sha256:[0-9a-f]{64}$/.test(asset.sha256) ||
		!isCanvas(asset.canvas) ||
		!Array.isArray(asset.anchorInventory)
	) {
		throw new Error("Dining generated asset entry is invalid.");
	}
	const anchorInventory = asset.anchorInventory.map(parseAnchor);
	const digest = asset.sha256.slice("sha256:".length);
	return {
		anchorInventory,
		canvas: asset.canvas,
		floorId: asset.floorId,
		floorplanId: asset.floorplanId,
		hallId: asset.hallId,
		sha256: asset.sha256 as `sha256:${string}`,
		svgAssetUrl: `/assets/dining/${digest}.svg`,
	};
}

function parseAnchor(value: unknown): DiningFloorplanAssetAnchor {
	if (!value || typeof value !== "object") {
		throw new Error("Dining generated asset anchor must be an object.");
	}
	const anchor = value as Record<string, unknown>;
	if (
		typeof anchor.anchorId !== "string" ||
		anchor.role !== "window" ||
		!(anchor.label === undefined || typeof anchor.label === "string")
	) {
		throw new Error("Dining generated asset anchor is invalid.");
	}
	return {
		anchorId: anchor.anchorId,
		...(typeof anchor.label === "string" ? { label: anchor.label } : {}),
		role: "window",
	};
}

function isCanvas(value: unknown): value is { height: number; width: number } {
	return (
		Boolean(value) &&
		typeof value === "object" &&
		typeof (value as Record<string, unknown>).height === "number" &&
		typeof (value as Record<string, unknown>).width === "number"
	);
}
