import { afterEach, describe, expect, it, vi } from "vitest";
import { getCampusMapManifest, getCampusMapPlaces } from "../src/features/map/api";

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

	it("loads the content-addressed places URL from the static manifest", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const path =
				typeof input === "string"
					? input
					: input instanceof Request
						? new URL(input.url).pathname
						: input.toString();
			if (path === "/campus-map/manifest.json") {
				return new Response(
					JSON.stringify({
						attribution: ["Synthetic"],
						campuses: {
							fengtai: {
								bounds: [120, 30, 120.1, 30.1],
								geojsonUrl: `/campus-map/assets/${"a".repeat(64)}.geojson`,
								name: "丰台校区",
							},
						},
						licenseBoundary: "ODbL 1.0",
						placesUrl: `/campus-map/places/${"b".repeat(64)}.json`,
					}),
					{ headers: { "content-type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					campus: { defaultCenter: [120, 30], id: "test", name: "测试" },
					places: [],
				}),
				{ headers: { "content-type": "application/json" } },
			);
		});
		const manifest = await getCampusMapManifest();
		await expect(getCampusMapPlaces({ placesUrl: manifest.placesUrl })).resolves.toMatchObject({
			places: [],
		});
		expect(fetchMock).toHaveBeenNthCalledWith(1, "/campus-map/manifest.json", expect.anything());
		expect(fetchMock).toHaveBeenNthCalledWith(2, manifest.placesUrl, expect.anything());
	});
});
