const DINING_FLOORPLAN_ASSET_PATH = /^\/api\/dining\/floorplans\/[0-9a-f]{64}\.svg$/;

export async function loadDiningFloorplanAsset(input: {
	signal?: AbortSignal;
	svgAssetUrl: string;
}): Promise<string> {
	const assetUrl = new URL(input.svgAssetUrl, window.location.href);
	if (
		assetUrl.origin !== window.location.origin ||
		assetUrl.search ||
		assetUrl.hash ||
		!DINING_FLOORPLAN_ASSET_PATH.test(assetUrl.pathname)
	) {
		throw new Error("Dining floorplan asset URL is invalid.");
	}
	const response = await fetch(assetUrl.pathname, {
		credentials: "same-origin",
		headers: { accept: "image/svg+xml" },
		...(input.signal ? { signal: input.signal } : {}),
	});
	if (!response.ok) {
		throw new Error("Dining floorplan asset could not be loaded.");
	}
	return response.text();
}
