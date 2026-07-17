import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDiningFloorplanAsset } from "../src/features/dining/floorplan-asset";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("dining floorplan asset loader", () => {
	it("loads a same-origin asset after verifying its digest", async () => {
		const markup = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
		const sha256 = `sha256:${createHash("sha256").update(markup).digest("hex")}`;
		globalThis.fetch = vi.fn(async () => new Response(markup, { status: 200 }));

		await expect(
			loadDiningFloorplanAsset({ sha256, svgAssetUrl: "/assets/dining/test.svg" }),
		).resolves.toBe(markup);
		expect(globalThis.fetch).toHaveBeenCalledWith(
			"/assets/dining/test.svg",
			expect.objectContaining({ credentials: "same-origin" }),
		);
	});

	it("fails closed when the digest does not match", async () => {
		globalThis.fetch = vi.fn(async () => new Response("<svg></svg>", { status: 200 }));

		await expect(
			loadDiningFloorplanAsset({
				sha256: `sha256:${"0".repeat(64)}`,
				svgAssetUrl: "/assets/dining/test.svg",
			}),
		).rejects.toThrow("checksum does not match");
	});

	it("rejects external and non-dining asset URLs before fetching", async () => {
		globalThis.fetch = vi.fn();
		const sha256 = `sha256:${"0".repeat(64)}`;

		await expect(
			loadDiningFloorplanAsset({ sha256, svgAssetUrl: "https://example.com/map.svg" }),
		).rejects.toThrow("asset URL is invalid");
		await expect(
			loadDiningFloorplanAsset({ sha256, svgAssetUrl: "/uploads/map.svg" }),
		).rejects.toThrow("asset URL is invalid");
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
