import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDiningFloorplanAsset } from "../src/features/dining/floorplan-asset";

const svgAssetUrl = `/api/dining/floorplans/${"a".repeat(64)}.svg`;
afterEach(() => vi.unstubAllGlobals());
describe("dining floorplan asset loader", () => {
	it("loads the server-verified SVG without requiring browser crypto", async () => {
		vi.stubGlobal("crypto", undefined);
		const fetcher = vi.fn(async () => new Response("<svg></svg>"));
		vi.stubGlobal("fetch", fetcher);
		const signal = new AbortController().signal;
		await expect(loadDiningFloorplanAsset({ svgAssetUrl, signal })).resolves.toBe("<svg></svg>");
		expect(fetcher).toHaveBeenCalledWith(
			svgAssetUrl,
			expect.objectContaining({ signal, credentials: "same-origin" }),
		);
	});
	it("reports a failed asset request", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 502 })),
		);
		await expect(loadDiningFloorplanAsset({ svgAssetUrl })).rejects.toThrow("could not be loaded");
	});
	it("rejects external and non-dining URLs before fetching", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		for (const url of ["https://example.com/map.svg", "/uploads/map.svg"]) {
			await expect(loadDiningFloorplanAsset({ svgAssetUrl: url })).rejects.toThrow(
				"asset URL is invalid",
			);
		}
		expect(fetcher).not.toHaveBeenCalled();
	});
});
