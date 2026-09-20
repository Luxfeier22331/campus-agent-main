import {
	transportScheduleRangeUrl,
	transportScheduleUrl,
} from "@campus-agent/transport/public-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { type Env } from "../src/index";

function createEnv(appApi?: Env["APP_API"]): Env {
	return {
		...(appApi ? { APP_API: appApi } : {}),
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
		transportScheduleUrl("2026-09-19"),
		transportScheduleRangeUrl("2026-09-01", "2026-09-30"),
	])("caches the actual frontend URL, normalizes order and separates include: %s", async (path) => {
		installFakeEdgeCache();
		const fetch = vi.fn(async (request: Request) =>
			Response.json(
				{ query: new URL(request.url).search },
				{
					headers: { "cache-control": "public, max-age=30, s-maxage=60" },
				},
			),
		);
		const env = createEnv({ fetch });
		const url = new URL(path, "https://campus.muc.wiki");
		const first = await worker.fetch(new Request(url), env);
		url.search = new URLSearchParams([...url.searchParams].reverse()).toString();
		const second = await worker.fetch(new Request(url), env);
		const head = await worker.fetch(new Request(url, { method: "HEAD" }), env);
		expect(first.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(second.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(head.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(await head.text()).toBe("");
		expect(fetch).toHaveBeenCalledOnce();
		expect(new URL(fetch.mock.calls[0]?.[0].url ?? "").searchParams.get("include")).toBe("notices");
		url.searchParams.delete("include");
		expect((await worker.fetch(new Request(url), env)).headers.get("x-campus-edge-cache")).toBe(
			"miss",
		);
		expect((await worker.fetch(new Request(url), env)).headers.get("x-campus-edge-cache")).toBe(
			"hit",
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it.each([
		"schedule?date=2026-09-19&include=notices&include=notices",
		"schedule?date=2026-09-19&date=2026-09-20&include=notices",
		"schedule?date=2026-02-30&include=notices",
		"schedule?date=2026-09-19&include=other",
		"schedule?date=2026-09-19&include=notices&extra=1",
		"schedule-range?from=2026-09-02&to=2026-09-01&include=notices",
		"schedule-range?from=2026-09-01&to=2026-10-02&include=notices",
	])("bypasses invalid/unknown transport parameters without stripping them: %s", async (query) => {
		installFakeEdgeCache();
		const fetch = vi.fn(async (_request: Request) =>
			Response.json({}, { headers: { "cache-control": "public, max-age=60" } }),
		);
		const env = createEnv({ fetch });
		const url = `https://campus.muc.wiki/api/transport/${query}`;
		for (let i = 0; i < 2; i++) {
			const response = await worker.fetch(new Request(url), env);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(new URL(fetch.mock.calls[0]?.[0].url ?? "").search).toBe(new URL(url).search);
	});

	it.each(["error", "cookie", "private"])("does not cache transport %s responses", async (kind) => {
		installFakeEdgeCache();
		const fetch = vi.fn(async () =>
			Response.json(
				{},
				{
					status: kind === "error" ? 503 : 200,
					headers: {
						"cache-control": kind === "private" ? "private, no-store" : "public, max-age=60",
						...(kind === "cookie" ? { "set-cookie": "session=private" } : {}),
					},
				},
			),
		);
		const env = createEnv({ fetch });
		for (let i = 0; i < 2; i++) {
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki${transportScheduleUrl("2026-09-19")}`),
				env,
			);
			expect(response.headers.get("cache-control")).toBe("no-store");
		}
		expect(fetch).toHaveBeenCalledTimes(2);
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

	it.each([
		"/api/dining/windows/window_1/submissions",
		"/api/dining/submissions/submission_1",
		"/api/dining/submissions/submission_1/reviews",
	])(
		"always rechecks submission reads even if an upstream response claims cacheability: %s",
		async (pathname) => {
			installFakeEdgeCache();
			const appApiFetch = vi.fn(
				async () => new Response("photo", { headers: { "cache-control": "public, max-age=600" } }),
			);
			const env = createEnv({ fetch: appApiFetch });
			for (let i = 0; i < 2; i++) {
				const response = await worker.fetch(new Request(`https://campus.muc.wiki${pathname}`), env);
				expect(response.headers.get("cache-control")).toBe("no-store");
			}
			expect(appApiFetch).toHaveBeenCalledTimes(2);
		},
	);

	it.each([
		"/api/dining/submissions/submission_1/photos/photo_1",
		"/api/dining/me/submissions/submission_1/photos/photo_1",
	])("forces submission photos into store-but-revalidate policy: %s", async (pathname) => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(
			async () =>
				new Response("photo", {
					headers: { "cache-control": "public, max-age=600", etag: '"photo_1"' },
				}),
		);
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(new Request(`https://campus.muc.wiki${pathname}`), env);
		const second = await worker.fetch(new Request(`https://campus.muc.wiki${pathname}`), env);

		expect(first.headers.get("cache-control")).toBe("private, no-cache");
		expect(first.headers.get("etag")).toBe('"photo_1"');
		expect(first.headers.get("x-campus-edge-cache")).toBeNull();
		expect(second.headers.get("cache-control")).toBe("private, no-cache");
		expect(appApiFetch).toHaveBeenCalledTimes(2);
	});

	it.each([
		"/api/dining/submissions/submission_1/photos/photo_1",
		"/api/dining/me/submissions/submission_1/photos/photo_1",
	])("forwards photo validators and passes a 304 through: %s", async (pathname) => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(async (request: Request) =>
			request.headers.get("if-none-match") === '"photo_1"'
				? new Response(null, { status: 304, headers: { etag: '"photo_1"' } })
				: new Response("photo", { headers: { etag: '"photo_1"' } }),
		);
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(new Request(`https://campus.muc.wiki${pathname}`), env);
		const revalidation = await worker.fetch(
			new Request(`https://campus.muc.wiki${pathname}`, {
				headers: { "if-none-match": '"photo_1"' },
			}),
			env,
		);

		expect(first.status).toBe(200);
		expect(revalidation.status).toBe(304);
		expect(revalidation.headers.get("cache-control")).toBe("private, no-cache");
		expect(revalidation.headers.get("etag")).toBe('"photo_1"');
		expect(appApiFetch).toHaveBeenCalledTimes(2);
		const upstreamSecondCall = appApiFetch.mock.calls[1]?.[0] as Request;
		expect(upstreamSecondCall.headers.get("if-none-match")).toBe('"photo_1"');
	});

	it("keeps photo error responses no-store without a validator escape", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: { code: "dining_submission_photo_not_found" } }), {
					headers: { "content-type": "application/json" },
					status: 404,
				}),
		);
		const env = createEnv({ fetch: appApiFetch });

		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/api/dining/submissions/submission_1/photos/photo_1"),
			env,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe("no-store");
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

	it.each([
		["schedule?date=2026-09-08", "schedule?date=2026-09-09", "schedule?date=2026-9-8"],
		[
			"schedule-range?from=2026-09-01&to=2026-09-30",
			"schedule-range?from=2026-10-01&to=2026-10-31",
			"schedule-range?from=2026-9-1&to=2026-09-30",
		],
	])("caches transport query %s independently", async (query, another, invalid) => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn((request: Request) =>
			Promise.resolve(
				new Response(JSON.stringify({ search: new URL(request.url).search }), {
					headers: {
						"cache-control": "public, max-age=30, s-maxage=60",
						"content-type": "application/json; charset=utf-8",
					},
				}),
			),
		);
		const env = createEnv({ fetch: appApiFetch });
		const request = (url: string) => worker.fetch(new Request(url), env);

		const first = await request(`https://campus.muc.wiki/api/transport/${query}`);
		const second = await request(`https://campus.muc.wiki/api/transport/${query}`);
		const anotherDate = await request(`https://campus.muc.wiki/api/transport/${another}`);
		const malformed = await request(`https://campus.muc.wiki/api/transport/${invalid}`);

		expect(first.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(second.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(anotherDate.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(malformed.headers.get("x-campus-edge-cache")).toBeNull();
		expect(malformed.headers.get("cache-control")).toBe("no-store");
		expect(appApiFetch).toHaveBeenCalledTimes(3);
		expect(appApiFetch.mock.calls[0]?.[0].url).toContain(query);
		expect(appApiFetch.mock.calls[1]?.[0].url).toContain(another);
		expect(appApiFetch.mock.calls[2]?.[0].url).toContain(invalid);
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

	it.each(["match", "put"] as const)(
		"serves a valid upstream response when edge cache %s fails",
		async (operation) => {
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
		},
	);

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
