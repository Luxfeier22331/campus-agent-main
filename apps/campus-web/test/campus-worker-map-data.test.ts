import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

function createEnv(mapData?: Env["MAP_DATA"]): Env {
	return {
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: {
			fetch: () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html" },
				}),
		},
		MAP_DATA: mapData,
	};
}

function createMapDataBucket(objects: Record<string, { body: string; contentType: string }>) {
	return {
		async get(key: string) {
			const object = objects[key];
			if (!object) {
				return null;
			}
			return {
				body: new ReadableStream({
					start(controller) {
						controller.enqueue(new TextEncoder().encode(object.body));
						controller.close();
					},
				}),
				httpMetadata: {
					contentType: object.contentType,
				},
			};
		},
	} as Env["MAP_DATA"];
}

describe("campus worker map data boundary", () => {
	it("serves campus map manifest from object storage with short edge cache", async () => {
		const env = createEnv(
			createMapDataBucket({
				"campus_navigation/releases/map_data/current/manifest.json": {
					body: JSON.stringify({
						attribution: ["Synthetic map contributors"],
						campuses: {},
						licenseBoundary: "External map data; not covered by repository Apache-2.0.",
						version: "v2026-06-30",
					}),
					contentType: "application/json; charset=utf-8",
				},
			}),
		);

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/map-data/manifest.json"),
			env,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe(
			"public, max-age=300, stale-while-revalidate=300",
		);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toMatchObject({
			version: "v2026-06-30",
		});
	});

	it("serves versioned campus map objects from object storage with long edge cache", async () => {
		const env = createEnv(
			createMapDataBucket({
				"campus_navigation/releases/map_data/v2026-06-30/geojson/haidian-campus.geojson": {
					body: '{"type":"FeatureCollection","features":[]}',
					contentType: "application/geo+json; charset=utf-8",
				},
				"campus_navigation/releases/map_data/v2026-06-30/tiles/fengtai/16/1/2.png": {
					body: "png",
					contentType: "image/png",
				},
			}),
		);

		const geojson = await worker.fetch(
			new Request("https://campus.muc.wiki/map-data/v2026-06-30/geojson/haidian-campus.geojson"),
			env,
		);
		const tile = await worker.fetch(
			new Request("https://campus.muc.wiki/map-data/v2026-06-30/tiles/fengtai/16/1/2.png"),
			env,
		);

		expect(geojson.status).toBe(200);
		expect(geojson.headers.get("cache-control")).toBe(
			"public, max-age=86400, stale-while-revalidate=3600",
		);
		expect(geojson.headers.get("content-type")).toContain("application/geo+json");
		expect(tile.status).toBe(200);
		expect(tile.headers.get("cache-control")).toBe("public, max-age=604800, immutable");
		expect(tile.headers.get("content-type")).toBe("image/png");
	});

	it("fails closed when campus map object storage is not configured", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/map-data/manifest.json"),
			createEnv(),
		);

		expect(response.status).toBe(503);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "地图数据暂不可用。",
			},
		});
	});
});
