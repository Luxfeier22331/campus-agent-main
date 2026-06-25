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

	it("caches public transport schedules by service date at the edge", async () => {
		installFakeEdgeCache();
		const appApiFetch = vi.fn((request: Request) => {
			const serviceDate = new URL(request.url).searchParams.get("serviceDate");
			return Promise.resolve(
				new Response(
					JSON.stringify({
						serviceDate,
						status: "available",
						routes: [],
					}),
					{
						headers: {
							"cache-control": "public, max-age=60, s-maxage=300",
							"content-type": "application/json; charset=utf-8",
							etag: `"campus-services-transport-schedule:${serviceDate}:release:published"`,
						},
					},
				),
			);
		});
		const env = createEnv({ fetch: appApiFetch });

		const first = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/api/campus-services/transport-schedule?serviceDate=2026-06-24",
			),
			env,
		);
		const second = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/api/campus-services/transport-schedule?serviceDate=2026-06-24",
			),
			env,
		);
		const third = await worker.fetch(
			new Request(
				"https://campus.muc.wiki/api/campus-services/transport-schedule?serviceDate=2026-06-25",
			),
			env,
		);

		expect(first.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(second.headers.get("x-campus-edge-cache")).toBe("hit");
		expect(third.headers.get("x-campus-edge-cache")).toBe("miss");
		expect(appApiFetch).toHaveBeenCalledTimes(2);
		await expect(second.json()).resolves.toMatchObject({ serviceDate: "2026-06-24" });
		await expect(third.json()).resolves.toMatchObject({ serviceDate: "2026-06-25" });
	});
});
