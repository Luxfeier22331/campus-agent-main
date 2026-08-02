import { afterEach, describe, expect, it, vi } from "vitest";
import { getCampusMapManifest } from "../src/features/map/api";

describe("campus map api", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("rejects invalid runtime map manifests before rendering", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					attribution: ["Synthetic map contributors"],
					licenseBoundary: "External map data",
				}),
				{ headers: { "content-type": "application/json" } },
			),
		);

		await expect(getCampusMapManifest()).rejects.toThrow("Campus map manifest is invalid.");
	});
});
