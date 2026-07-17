const DINING_FLOORPLAN_ASSET_PATH = /^\/assets\/dining\/[A-Za-z0-9][A-Za-z0-9._-]*\.svg$/;
const SHA256_REFERENCE = /^sha256:([0-9a-f]{64})$/;

export async function loadDiningFloorplanAsset(input: {
	sha256: string;
	signal?: AbortSignal;
	svgAssetUrl: string;
}): Promise<string> {
	const expectedDigest = SHA256_REFERENCE.exec(input.sha256)?.[1];
	if (!expectedDigest) {
		throw new Error("Dining floorplan checksum is invalid.");
	}
	const assetUrl = new URL(input.svgAssetUrl, window.location.href);
	if (
		assetUrl.origin !== window.location.origin ||
		assetUrl.search ||
		assetUrl.hash ||
		!DINING_FLOORPLAN_ASSET_PATH.test(assetUrl.pathname)
	) {
		throw new Error("Dining floorplan asset URL is invalid.");
	}
	if (!globalThis.crypto?.subtle) {
		throw new Error("Dining floorplan checksum verification is unavailable.");
	}

	const response = await fetch(assetUrl.pathname, {
		credentials: "same-origin",
		headers: { accept: "image/svg+xml" },
		signal: input.signal,
	});
	if (!response.ok) {
		throw new Error("Dining floorplan asset could not be loaded.");
	}
	const bytes = await response.arrayBuffer();
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	const actualDigest = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	if (actualDigest !== expectedDigest) {
		throw new Error("Dining floorplan asset checksum does not match its projection.");
	}
	return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
