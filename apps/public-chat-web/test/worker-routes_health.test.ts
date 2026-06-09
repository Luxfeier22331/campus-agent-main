import { describe, expect, it } from "vitest";

import worker from "../src/index";
import {
	EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS,
	readPublicChatSecurityHeaders,
} from "./worker-shell-fixtures";

describe("public chat web worker routes and readiness", () => {
	it("redirects chat-local auth browser routes to the campus account shell", async () => {
		const response = await worker.fetch(
			new Request("https://chat.example.com/login?return_to=%2Fchat%2Fconv_01HQ"),
			{
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("ok", { status: 200 }),
				},
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://campus.muc.wiki/account/login");
		expect(readPublicChatSecurityHeaders(response)).toEqual(EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS);
	});

	it("preserves reset-password token when redirecting chat-local auth routes to the campus account shell", async () => {
		const response = await worker.fetch(
			new Request("https://chat.example.com/reset-password?token=reset_token_01HQ"),
			{
				APP_API_BASE_URL: "https://app-api.internal",
				ASSETS: {
					fetch: async () => new Response("ok", { status: 200 }),
				},
				AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://campus.muc.wiki/account/reset-password?token=reset_token_01HQ",
		);
		expect(readPublicChatSecurityHeaders(response)).toEqual(EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS);
	});

	it("serves healthz and readyz from the worker shell", async () => {
		const health = await worker.fetch(new Request("https://chat.example.com/healthz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
							dependencies: {
								auth: "ready",
								database: "ready",
								officialWebHandoff: "not_configured",
								operatorBridge: "configured",
								publicChatOrigin: "configured",
								supervisorApi: "ready",
							},
							preflight: {
								campusServicesProductPath: {
									status: "ready",
									capabilityGate: "open",
									projectionSource: "postgres",
									checks: {
										contactDirectoryProjection: "ready",
										contactDirectoryReadModel: "ready",
										serviceGuideProjection: "ready",
										serviceGuideReadModel: "ready",
										serviceStatusProjection: "ready",
										serviceStatusReadModel: "ready",
										structuredQueryRuntime: "ready",
										transportSchedule: "ready",
										transportScheduleReadModel: "ready",
									},
									blockers: {},
								},
							},
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			AUTH_SHELL_ORIGIN: "https://campus.example.com",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});
		const ready = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
							dependencies: {
								auth: "ready",
								database: "ready",
								officialWebHandoff: "not_configured",
								operatorBridge: "configured",
								publicChatOrigin: "configured",
								supervisorApi: "ready",
							},
							preflight: {
								campusServicesProductPath: {
									status: "ready",
									capabilityGate: "open",
									projectionSource: "postgres",
									checks: {
										contactDirectoryProjection: "ready",
										contactDirectoryReadModel: "ready",
										serviceGuideProjection: "ready",
										serviceGuideReadModel: "ready",
										serviceStatusProjection: "ready",
										serviceStatusReadModel: "ready",
										structuredQueryRuntime: "ready",
										transportSchedule: "ready",
										transportScheduleReadModel: "ready",
									},
									blockers: {},
								},
							},
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			AUTH_SHELL_ORIGIN: "https://campus.example.com",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(health.status).toBe(200);
		expect(health.headers.get("cache-control")).toBe("no-store");
		expect(readPublicChatSecurityHeaders(health)).toEqual(EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS);
		await expect(health.json()).resolves.toEqual({
			status: "ok",
			app_name: "campus-agent-public-chat-web",
			surface: "public-chat-web",
			runtime: "cloudflare-worker",
		});

		expect(ready.status).toBe(200);
		expect(ready.headers.get("cache-control")).toBe("no-store");
		expect(readPublicChatSecurityHeaders(ready)).toEqual(EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS);
		await expect(ready.json()).resolves.toEqual({
			status: "ready",
			app_api_base_url: "https://app-api.internal",
			dependencies: {
				appApiBinding: "configured",
				appApiRuntime: "ready",
				assets: "configured",
			},
			preflight: {
				campusServicesProductPath: {
					status: "ready",
					capabilityGate: "open",
					projectionSource: "postgres",
					checks: {
						contactDirectoryProjection: "ready",
						contactDirectoryReadModel: "ready",
						serviceGuideProjection: "ready",
						serviceGuideReadModel: "ready",
						serviceStatusProjection: "ready",
						serviceStatusReadModel: "ready",
						structuredQueryRuntime: "ready",
						transportSchedule: "ready",
						transportScheduleReadModel: "ready",
					},
					blockers: {},
				},
			},
			public_hostname: "chat.example.com",
			runtime: "cloudflare-worker",
		});
	});

	it("fails readyz closed when runtime dependencies are missing", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			PUBLIC_CHAT_APP_NAME: "campus-agent-public-chat-web",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: [
						"APP_API binding",
						"ASSETS binding",
						"APP_API_BASE_URL",
						"PUBLIC_CHAT_HOSTNAME",
						"AUTH_SHELL_ORIGIN",
					],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("fails auth compatibility routes closed when account shell origin is missing", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/login"), {
			APP_API_BASE_URL: "https://app-api.internal",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: ["AUTH_SHELL_ORIGIN"],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("fails readyz closed when the app-api runtime is not ready", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							error: {
								code: "dependency_not_ready",
								message: "Runtime dependencies are not ready.",
							},
						}),
						{
							status: 503,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			AUTH_SHELL_ORIGIN: "https://campus.example.com",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					appApiRuntime: "app-api readyz returned 503",
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("publishes app-api campus services product-path preflight blockers on readyz", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
							dependencies: {
								auth: "ready",
								database: "ready",
								officialWebHandoff: "not_configured",
								operatorBridge: "configured",
								publicChatOrigin: "configured",
								supervisorApi: "ready",
							},
							preflight: {
								campusServicesProductPath: {
									status: "blocked",
									capabilityGate: "open",
									projectionSource: "postgres",
									checks: {
										contactDirectoryProjection: "ready",
										contactDirectoryReadModel: "ready",
										serviceGuideProjection: "not_ready",
										serviceGuideReadModel: "ready",
										serviceStatusProjection: "ready",
										serviceStatusReadModel: "ready",
										structuredQueryRuntime: "ready",
										transportSchedule: "ready",
										transportScheduleReadModel: "ready",
									},
									blockers: {
										serviceGuideProjection: "service_guide_projection_ready is false",
									},
								},
							},
						}),
						{
							headers: {
								"content-type": "application/json",
							},
							status: 200,
						},
					),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			AUTH_SHELL_ORIGIN: "https://campus.example.com",
			ASSETS: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "ready",
			preflight: {
				campusServicesProductPath: {
					status: "blocked",
					blockers: {
						serviceGuideProjection: "service_guide_projection_ready is false",
					},
				},
			},
		});
	});

	it("redirects the removed preview path back to canonical /chat", async () => {
		const response = await worker.fetch(
			new Request("https://chat.example.com/chat/replatform-preview?from=legacy"),
			{
				APP_API: {
					fetch: async () => new Response(null, { status: 204 }),
				},
				ASSETS: {
					fetch: async () => new Response("should not hit assets", { status: 500 }),
				},
				APP_API_BASE_URL: "https://app-api.internal",
				PUBLIC_CHAT_HOSTNAME: "chat.example.com",
			},
		);

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("https://chat.example.com/chat?from=legacy");
	});

	it("serves the public chat app shell when frontend assets and app-api bridge are configured", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(readPublicChatSecurityHeaders(response)).toEqual(EXPECTED_PUBLIC_CHAT_SECURITY_HEADERS);
		const html = await response.text();
		expect(html).toContain('<div id="root"></div>');
		expect(html).not.toContain("__PUBLIC_CHAT_AUTH_CONFIG__");
	});

	it("fails closed when app-api binding is not configured for the public shell", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	});

	it("fails closed when app-api base url is not configured for the public shell", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			ASSETS: {
				fetch: async () =>
					new Response('<!doctype html><html><body><div id="root"></div></body></html>', {
						headers: {
							"content-type": "text/html; charset=utf-8",
						},
						status: 200,
					}),
			},
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				message: "App API binding is not configured.",
			},
		});
	});

	it("fails closed when frontend assets are not configured for the public shell", async () => {
		const response = await worker.fetch(new Request("https://chat.example.com/"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			APP_API_BASE_URL: "https://app-api.internal",
			PUBLIC_CHAT_HOSTNAME: "chat.example.com",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "frontend_assets_not_ready",
				message: "Public chat frontend assets are not configured.",
			},
		});
	});
});
