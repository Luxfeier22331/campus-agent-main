import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";

function createEnv(appApi?: Env["APP_API"]): Env {
	return {
		APP_API: appApi,
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: {
			fetch: () =>
				new Response('<!doctype html><div id="root"></div>', {
					headers: { "content-type": "text/html" },
				}),
		},
	};
}

function installFakeEdgeCache() {
	const entries = new Map<string, Response>();
	vi.stubGlobal("caches", {
		default: {
			async match(request: Request) {
				return entries.get(request.url)?.clone();
			},
			async put(request: Request, response: Response) {
				entries.set(request.url, response.clone());
			},
		},
	});
}

describe("campus worker public app-api cache", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		"/api/dining",
		"/api/dining/windows/hall:floor:window-01/menu",
		`/api/dining/floorplans/${"a".repeat(64)}.svg`,
	])("caches public projections at the edge for GET and HEAD: %s", async (pathname) => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn((request: Request) =>
			Promise.resolve(
				new Response(JSON.stringify({ pathname: new URL(request.url).pathname }), {
					headers: {
						"cache-control": pathname.endsWith(".svg")
							? "public, max-age=31536000, immutable"
							: "public, max-age=60, s-maxage=300",
						"content-type": pathname.endsWith(".svg")
							? "image/svg+xml"
							: "application/json; charset=utf-8",
					},
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(new Request(`https://campus.muc.wiki${pathname}`), env);
		const second = await worker.fetch(new Request(`https://campus.muc.wiki${pathname}`), env);
		const head = await worker.fetch(
			new Request(`https://campus.muc.wiki${pathname}`, { method: "HEAD" }),
			env,
		);

		expect(first.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(second.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(head.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(await head.text()).toBe("");
		expect(appApiFetch).toHaveBeenCalledOnce();
	});

	it("always reads the latest campus groups catalog", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ schemaVersion: "campus-groups-catalog.v1", sections: [] }), {
					headers: {
						"cache-control": "no-store",
						"content-type": "application/json; charset=utf-8",
					},
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(
			new Request("https://campus.muc.wiki/api/campus-groups/catalog"),
			env,
		);
		const second = await worker.fetch(
			new Request("https://campus.muc.wiki/api/campus-groups/catalog"),
			env,
		);

		expect(first.headers.get("cache-control")).toBe("no-store");
		expect(first.headers.get("x-campus-edge-cache")).toBeNull();
		expect(second.headers.get("x-campus-edge-cache")).toBeNull();
		expect(appApiFetch).toHaveBeenCalledTimes(2);
	});

	it("never shares review reads through the edge cache", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ items: [], nextCursor: null }), {
					headers: {
						"cache-control": "no-store",
						"content-type": "application/json; charset=utf-8",
					},
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });
		const request = () =>
			worker.fetch(new Request("https://campus.muc.wiki/api/dining/menu-items/dmi_1/reviews"), env);

		const first = await request();
		const second = await request();

		expect(first.headers.get("cache-control")).toBe("no-store");
		expect(second.headers.get("cache-control")).toBe("no-store");
		expect(appApiFetch).toHaveBeenCalledTimes(2);
	});

	it("does not cache dining requests with query parameters", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn((request: Request) =>
			Promise.resolve(
				new Response(JSON.stringify({ search: new URL(request.url).search }), {
					headers: {
						"cache-control": "public, max-age=60, s-maxage=300",
						"content-type": "application/json; charset=utf-8",
					},
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(
			new Request("https://campus.muc.wiki/api/dining?date=2026-07-24"),
			env,
		);
		const second = await worker.fetch(
			new Request("https://campus.muc.wiki/api/dining?date=2026-07-24"),
			env,
		);

		expect(first.headers.get("x-campus-edge-cache")).toBeNull();
		expect(first.headers.get("cache-control")).toBe("no-store");
		expect(second.headers.get("x-campus-edge-cache")).toBeNull();
		expect(appApiFetch).toHaveBeenCalledTimes(2);
	});

	it("bypasses and does not store failed dining responses", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: { code: "dining_unavailable" } }), {
					headers: { "cache-control": "private, no-store" },
					status: 503,
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(new Request("https://campus.muc.wiki/api/dining"), env);
		const second = await worker.fetch(new Request("https://campus.muc.wiki/api/dining"), env);

		expect(first.status).toBe(503);
		expect(first.headers.get("x-campus-edge-cache")).toBe("bypass");
		expect(first.headers.get("cache-control")).toBe("no-store");
		expect(second.headers.get("x-campus-edge-cache")).toBe("bypass");
		expect(appApiFetch).toHaveBeenCalledTimes(2);
	});

	it.each([
		"match",
		"put",
	] as const)("serves a valid upstream response when edge cache %s fails", async (operation) => {
		vi.stubGlobal("caches", {
			default: {
				async match() {
					if (operation === "match") {
						throw new Error("edge cache read unavailable");
					}
				},
				async put() {
					if (operation === "put") {
						throw new Error("edge cache write unavailable");
					}
				},
			},
		});
		const appApiFetch = vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ halls: [] }), {
					headers: {
						"cache-control": "public, max-age=60, s-maxage=300",
						"content-type": "application/json; charset=utf-8",
					},
				}),
			),
		);
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/dining"),
			createEnv({ fetch: appApiFetch }),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-campus-edge-cache")).toBe("bypass");
		expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		expect(appApiFetch).toHaveBeenCalledOnce();
	});

	it("keeps the native fetch receiver for local loopback transport", async () => {
		installFakeEdgeCache();
		const env = {
			...createEnv({
				fetch() {
					throw new Error("service binding should not be used for local loopback proxy");
				},
			}),
			APP_API_BASE_URL: "http://127.0.0.1:27031",
		};
		const fetchMock = vi.fn(function (this: unknown) {
			if (this !== globalThis) {
				throw new TypeError("Illegal invocation");
			}
			return Promise.resolve(
				new Response(JSON.stringify({ halls: [] }), {
					headers: {
						"cache-control": "public, max-age=60, s-maxage=300",
						"content-type": "application/json; charset=utf-8",
					},
				}),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(new Request("http://127.0.0.1:27014/api/dining"), env);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
