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
		CAMPUS_WEB_HOSTNAME: "campus.muc.wiki",
		DOCS_RELEASE_ID: `sha256:${"a".repeat(64)}`,
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

	it("caches the public transport status projection at the edge", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn((request: Request) => {
			const url = new URL(request.url);
			return Promise.resolve(
				new Response(
					JSON.stringify({
						groups: [],
						release: {
							publishedAt: "2026-03-20T00:00:00+08:00",
							releaseId: "snapshot:bus:2026-03-20",
							sourceRefs: ["https://portal.example.edu/notice/123"],
						},
						pathname: url.pathname,
						search: url.search,
					}),
					{
						headers: {
							"cache-control": "public, max-age=60, s-maxage=300",
							"content-type": "application/json; charset=utf-8",
							etag: '"campus-services-transport-schedule-status:snapshot:bus:2026-03-20"',
						},
					},
				),
			);
		});
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(
			new Request("https://campus.muc.wiki/api/campus-services/transport-schedule/status"),
			env,
		);
		const second = await worker.fetch(
			new Request("https://campus.muc.wiki/api/campus-services/transport-schedule/status"),
			env,
		);
		const withQuery = await worker.fetch(
			new Request("https://campus.muc.wiki/api/campus-services/transport-schedule/status?x=1"),
			env,
		);

		expect(first.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(second.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(withQuery.headers.get("x-campus-edge-cache")).not.toBe("hit");
		expect(withQuery.headers.get("x-campus-edge-cache")).not.toBe("miss");
		expect(appApiFetch).toHaveBeenCalledTimes(2);
		await expect(second.json()).resolves.toMatchObject({
			pathname: "/api/campus-services/transport-schedule/status",
			search: "",
		});
		await expect(withQuery.json()).resolves.toMatchObject({ search: "?x=1" });
	});

	it.each([
		"/api/dining/bootstrap",
		"/api/dining/halls",
		"/api/dining/halls/haidian-canteen-1/floors/haidian-canteen-1-1f",
		"/api/dining/offerings/offering-1/reviews",
	])("caches the public dining projection %s for GET and HEAD", async (pathname) => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn((request: Request) =>
			Promise.resolve(
				new Response(JSON.stringify({ pathname: new URL(request.url).pathname }), {
					headers: {
						"cache-control": "public, max-age=60, s-maxage=300",
						"content-type": "application/json; charset=utf-8",
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
		expect(appApiFetch).toHaveBeenCalledTimes(1);
	});

	it("bypasses and does not store non-public dining responses", async () => {
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
		const request = new Request("https://campus.muc.wiki/api/dining/bootstrap");

		const first = await worker.fetch(request, env);
		const second = await worker.fetch(request, env);

		expect(first.status).toBe(503);
		expect(first.headers.get("x-campus-edge-cache")).toBe("bypass");
		expect(first.headers.get("cache-control")).toBe("no-store");
		expect(second.headers.get("x-campus-edge-cache")).toBe("bypass");
		expect(appApiFetch).toHaveBeenCalledTimes(2);
	});

	it("fails closed without caching an upstream dining HTML error", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(() =>
			Promise.resolve(
				new Response("<html>upstream failure</html>", {
					headers: { "content-type": "text/html" },
					status: 500,
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });
		const request = new Request("https://campus.muc.wiki/api/dining/bootstrap");

		const first = await worker.fetch(request, env);
		const second = await worker.fetch(request, env);

		expect(first.status).toBe(503);
		expect(first.headers.get("x-campus-edge-cache")).toBe("bypass");
		await expect(first.json()).resolves.toMatchObject({
			error: { code: "dependency_not_ready" },
		});
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
					return;
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
		const env = createEnv({ fetch: appApiFetch });

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/dining/bootstrap"),
			env,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-campus-edge-cache")).toBe("bypass");
		expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
		await expect(response.json()).resolves.toEqual({ halls: [] });
		expect(appApiFetch).toHaveBeenCalledOnce();
	});

	it("keeps the native fetch receiver for the local loopback transport", async () => {
		installFakeEdgeCache();
		const appApiBinding = {
			fetch() {
				throw new Error("service binding should not be used for local loopback proxy");
			},
		};
		const env = {
			...createEnv(appApiBinding),
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

		const response = await worker.fetch(
			new Request("http://127.0.0.1:27014/api/dining/bootstrap"),
			env,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
