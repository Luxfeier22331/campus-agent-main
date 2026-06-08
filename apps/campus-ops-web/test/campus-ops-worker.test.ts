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
			"/api/ops/dining/halls",
			"/api/ops/dining/halls/haidian-canteen-1/floors/1f",
			"/api/ops/dining/windows/haidian-canteen-1:1f:window-01",
			"/api/ops/dining/window-assignments",
			"/api/ops/dining/window-assignments/assignment:haidian-canteen-1:1f:haidian-canteen-1:1f:window-01",
			"/api/ops/dining/menu-items",
			"/api/ops/dining/menu-items/menu:fanqie-niunanfan:1",
			"/api/ops/dining/menu-offerings",
			"/api/ops/dining/menu-offerings/offering:assignment:haidian-canteen-1:1f:haidian-canteen-1:1f:window-01:menu:fanqie-niunanfan:1",
			"/api/ops/dining/releases",
			"/api/ops/dining/releases/dining_release:initial/preview",
			"/api/ops/dining/releases/dining_release:initial/publish",
			"/api/ops/dining/audit-events",
		];

		for (const path of allowed) {
			const response = await worker.fetch(new Request(`https://ops.mucwiki-edge.link${path}`), env);
			expect(response.status).toBe(200);
		}

		const unknown = await worker.fetch(
			new Request("https://ops.mucwiki-edge.link/api/ops/dining/source-observations"),
			env,
		);
		const federation = await worker.fetch(
			new Request("https://ops.mucwiki-edge.link/api/federation/authorize"),
			env,
		);

		expect(unknown.status).toBe(404);
		expect(federation.status).toBe(404);
		expect(seen).toEqual(allowed);
	});

	it("serves registered operator shell routes", async () => {
		for (const path of ["/", "/dining", "/dining/releases", "/dining/audit", "/map", "/feedback"]) {
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
