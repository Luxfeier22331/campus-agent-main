import { describe, expect, it } from "vitest";

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
		HUB_WEB_ORIGIN: "https://hub.muc.wiki",
	};
}

describe("campus worker boundary", () => {
	it("serves healthz without requiring app-api", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/healthz"),
			createEnv(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			app_name: "campus-agent-campus-web",
			surface: "campus-web",
		});
	});

	it("allows only explicit app-api seams", async () => {
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
			"/api/me",
			"/api/chat/conversations",
			"/api/chat/conversations/conv_1",
			"/api/chat/requests",
			"/api/chat/requests/stream",
			"/api/docs/collections/regulations/student_rules/navigation",
			"/api/docs/collections/regulations/student_rules/documents/index/resolve",
			"/api/campus-map/places",
			"/api/campus-map/places/library",
			"/api/dining/halls",
			"/api/dining/halls/haidian-canteen-1/floors/1f",
			"/api/feedback",
		];

		for (const path of allowed) {
			const response = await worker.fetch(new Request(`https://campus.muc.wiki${path}`), env);
			expect(response.status).toBe(200);
		}

		const rejected = await worker.fetch(
			new Request("https://campus.muc.wiki/api/federation/authorize"),
			env,
		);
		expect(rejected.status).toBe(404);
		expect(seen).toEqual(allowed);
	});

	it("serves registered browser routes through the shell", async () => {
		const env = createEnv();
		for (const path of ["/", "/c/conv_1", "/docs/student_rules", "/map", "/dining", "/feedback"]) {
			const response = await worker.fetch(
				new Request(`https://campus.muc.wiki${path}`, {
					headers: { accept: "text/html" },
				}),
				env,
			);
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
		}
	});

	it("injects public runtime config from worker env into the shell", async () => {
		const response = await worker.fetch(
			new Request("https://campus.muc.wiki/", {
				headers: { accept: "text/html" },
			}),
			createEnv(),
		);

		expect(response.status).toBe(200);
		const html = await response.text();
		expect(html).toContain("__CAMPUS_RUNTIME_CONFIG__");
		expect(html).toContain("https://hub.muc.wiki/account");
		expect(html).toContain("https://hub.muc.wiki/account/login");
		expect(html).toContain('"loginReturnApp":"campus"');
	});
});
