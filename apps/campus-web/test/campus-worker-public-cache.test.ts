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
							sourceRefs: ["https://portal.muc.edu.cn/notice/123"],
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
});
