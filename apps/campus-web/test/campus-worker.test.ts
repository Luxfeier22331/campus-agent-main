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
			"/api/me/overview",
			"/api/me/identity",
			"/api/me/access",
			"/api/me/preferences",
			"/api/auth/sign-in/email",
			"/api/auth/sign-up/email",
			"/api/auth/sign-out",
			"/api/auth/get-session",
			"/api/auth/request-password-reset",
			"/api/auth/reset-password",
			"/api/federation/authorize",
			"/api/federation/token",
			"/api/federation/userinfo",
			"/api/federation/jwks",
			"/api/federation/logout",
			"/api/chat/conversations",
			"/api/chat/conversations/conv_1",
			"/api/chat/conversations/conv_1/messages/msg_1/feedback",
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

		const rejected = await worker.fetch(new Request("https://campus.muc.wiki/api/ops/dining"), env);
		expect(rejected.status).toBe(404);
		expect(seen).toEqual(allowed);
	});

	it("serves registered browser routes through the shell", async () => {
		const env = createEnv();
		for (const path of [
			"/",
			"/c/conv_1",
			"/docs/student_rules",
			"/map",
			"/dining",
			"/feedback",
			"/account",
			"/account/login",
			"/account/register",
			"/account/forgot-password",
			"/account/reset-password",
			"/account/federation/consent",
			"/account/federation/error",
		]) {
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
		expect(html).toContain("__CAMPUS_AUTH_CONFIG__");
		expect(html).toContain("https://campus.muc.wiki/account");
		expect(html).toContain("https://campus.muc.wiki/account/login");
		expect(html).not.toContain("loginReturnApp");
	});
});
