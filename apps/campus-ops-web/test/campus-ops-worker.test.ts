import { describe, expect, it } from "vitest";

import worker, { type Env } from "../src/index";

function createEnv(appApi?: Env["APP_API"]): Env {
	return {
		APP_API: appApi,
		APP_API_BASE_URL: "https://app-api.internal",
		ASSETS: {
			fetch: () =>
				new Response("<!doctype html><main>Campus Ops</main>", {
					headers: { "content-type": "text/html" },
				}),
		},
		CAMPUS_OPS_WEB_HOSTNAME: "ops.mucwiki-edge.link",
	};
}

describe("campus ops worker boundary", () => {
	it("serves healthz without app-api", async () => {
		const response = await worker.fetch(
			new Request("https://ops.mucwiki-edge.link/healthz"),
			createEnv(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-campus-ops-web",
			surface: "campus-ops-web",
		});
	});

	it("passes only allowlisted dining ops api seams", async () => {
		const seen: string[] = [];
		const env = createEnv({
			fetch(request) {
				seen.push(new URL(request.url).pathname);
				return new Response(JSON.stringify({ ok: true }), {
					headers: { "content-type": "application/json" },
				});
			},
		});

		const allowed = [
			{ method: "GET", path: "/api/ops/dining/halls" },
			{ method: "GET", path: "/api/ops/dining/halls/haidian-canteen-1/floors/1f" },
			{ method: "PATCH", path: "/api/ops/dining/windows/haidian-canteen-1:1f:window-01" },
			{ method: "POST", path: "/api/ops/dining/window-assignments" },
			{
				method: "PATCH",
				path: "/api/ops/dining/window-assignments/assignment:haidian-canteen-1:1f:haidian-canteen-1:1f:window-01",
			},
			{ method: "POST", path: "/api/ops/dining/menu-items" },
			{ method: "PATCH", path: "/api/ops/dining/menu-items/menu:fanqie-niunanfan:1" },
			{ method: "POST", path: "/api/ops/dining/menu-offerings" },
			{
				method: "PATCH",
				path: "/api/ops/dining/menu-offerings/offering:assignment:haidian-canteen-1:1f:haidian-canteen-1:1f:window-01:menu:fanqie-niunanfan:1",
			},
			{ method: "POST", path: "/api/ops/dining/floorplan-assets" },
			{ method: "GET", path: "/api/ops/dining/release-candidates" },
			{ method: "POST", path: "/api/ops/dining/release-candidates" },
			{ method: "GET", path: "/api/ops/dining/release-candidates/dining_release_candidate:1" },
			{
				method: "POST",
				path: "/api/ops/dining/release-candidates/dining_release_candidate:1/validate",
			},
			{
				method: "POST",
				path: "/api/ops/dining/release-candidates/dining_release_candidate:1/approve",
			},
			{
				method: "POST",
				path: "/api/ops/dining/release-candidates/dining_release_candidate:1/schedule",
			},
			{
				method: "POST",
				path: "/api/ops/dining/release-candidates/dining_release_candidate:1/publish",
			},
			{
				method: "POST",
				path: "/api/ops/dining/release-candidates/dining_release_candidate:1/cancel",
			},
			{ method: "GET", path: "/api/ops/dining/releases" },
			{ method: "GET", path: "/api/ops/dining/releases/dining_release:initial" },
			{ method: "POST", path: "/api/ops/dining/releases/dining_release:initial/rollback" },
			{ method: "GET", path: "/api/ops/dining/audit-events" },
		];

		for (const route of allowed) {
			const response = await worker.fetch(
				new Request(`https://ops.mucwiki-edge.link${route.path}`, { method: route.method }),
				env,
			);
			expect(response.status).toBe(200);
		}

		const unknown = await worker.fetch(
			new Request("https://ops.mucwiki-edge.link/api/ops/dining/source-observations"),
			env,
		);
		const legacyDirectPublish = await worker.fetch(
			new Request("https://ops.mucwiki-edge.link/api/ops/dining/releases", {
				method: "POST",
			}),
			env,
		);
		const legacyPreview = await worker.fetch(
			new Request(
				"https://ops.mucwiki-edge.link/api/ops/dining/releases/dining_release:initial/preview",
			),
			env,
		);
		const legacyPublish = await worker.fetch(
			new Request(
				"https://ops.mucwiki-edge.link/api/ops/dining/releases/dining_release:initial/publish",
				{ method: "POST" },
			),
			env,
		);
		const federation = await worker.fetch(
			new Request("https://ops.mucwiki-edge.link/api/federation/authorize"),
			env,
		);

		expect(unknown.status).toBe(404);
		expect(legacyDirectPublish.status).toBe(404);
		expect(legacyPreview.status).toBe(404);
		expect(legacyPublish.status).toBe(404);
		expect(federation.status).toBe(404);
		expect(seen).toEqual(allowed.map((route) => route.path));
	});

	it("serves registered operator shell routes", async () => {
		for (const path of [
			"/",
			"/dining",
			"/dining/assets",
			"/dining/candidates",
			"/dining/candidates/dining_release_candidate:1",
			"/dining/releases",
			"/dining/releases/dining_release:initial",
			"/dining/audit",
			"/map",
			"/feedback",
			"/knowledge",
			"/notices",
			"/services",
		]) {
			const response = await worker.fetch(
				new Request(`https://ops.mucwiki-edge.link${path}`, {
					headers: { accept: "text/html" },
				}),
				createEnv(),
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
		}
	});
});
