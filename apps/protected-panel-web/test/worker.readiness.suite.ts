import { expect, it } from "vitest";

import { createHtmlShellResponse, worker } from "./worker.test-support";

export function registerWorkerReadinessSuite() {
	it("serves healthz and readyz from the worker shell", async () => {
		const appApiBinding = {
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
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					},
				),
		};

		const workerEnv = {
			ACCESS_POLICY_AUD: "panel-readyz-audience",
			ACCESS_TEAM_DOMAIN: "https://team-readyz.cloudflareaccess.com",
			APP_API: appApiBinding,
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			PANEL_APP_NAME: "campus-agent-v2-protected-panel",
			PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
		};

		const health = await worker.fetch(new Request("https://panel.example.com/healthz"), workerEnv);
		const ready = await worker.fetch(new Request("https://panel.example.com/readyz"), workerEnv);

		expect(health.status).toBe(200);
		expect(health.headers.get("cache-control")).toBe("no-store");
		await expect(health.json()).resolves.toEqual({
			status: "ok",
			app_name: "campus-agent-v2-protected-panel",
			surface: "protected-panel-web",
			runtime: "cloudflare-worker",
		});

		expect(ready.status).toBe(200);
		expect(ready.headers.get("cache-control")).toBe("no-store");
		await expect(ready.json()).resolves.toEqual({
			status: "ready",
			dependencies: {
				accessOriginAdmission: "configured",
				appApiBinding: "configured",
				appApiRuntime: "ready",
				assets: "configured",
				operatorBridge: "configured",
			},
			runtime_api_base_url: "https://app-api.internal",
			protected_hostname: "panel.example.com",
			protection_envelope: "cloudflare-access",
			runtime: "cloudflare-worker",
		});
	});

	it("fails readyz closed when protected runtime dependencies are missing", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/readyz"), {
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: [
						"APP_API binding",
						"ASSETS binding",
						"PANEL_RUNTIME_API_BASE_URL",
						"PANEL_APP_API_SHARED_SECRET",
						"ACCESS_TEAM_DOMAIN",
						"ACCESS_POLICY_AUD",
					],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("fails readyz closed when cloudflare access admission is not configured", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/readyz"), {
			APP_API: {
				fetch: async () => new Response(null, { status: 204 }),
			},
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: [
						"PANEL_PROTECTION_ENVELOPE=cloudflare-access",
						"ACCESS_TEAM_DOMAIN",
						"ACCESS_POLICY_AUD",
					],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("fails readyz closed when staging still uses placeholder access values", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/readyz"), {
			APP_API: {
				fetch: async () => new Response("ok", { status: 200 }),
			},
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
			ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
			ACCESS_POLICY_AUD: "panel-audience",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: ["ACCESS_TEAM_DOMAIN", "ACCESS_POLICY_AUD"],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("fails readyz closed when the access team domain is a non-loopback http issuer", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
			ACCESS_TEAM_DOMAIN: "http://team-readyz.cloudflareaccess.com",
			ACCESS_POLICY_AUD: "panel-readyz-audience",
		});

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: ["ACCESS_TEAM_DOMAIN"],
				},
				message: "Runtime configuration is incomplete.",
			},
		});
	});

	it("keeps the loopback local access smoke issuer available for authenticated dev smoke", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/readyz"), {
			APP_API: {
				fetch: async () =>
					new Response(
						JSON.stringify({
							status: "ready",
						}),
						{
							status: 200,
							headers: {
								"content-type": "application/json",
							},
						},
					),
			},
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
			ACCESS_TEAM_DOMAIN: "http://127.0.0.1:27062",
			ACCESS_POLICY_AUD: "panel-local-smoke",
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			status: "ready",
			dependencies: {
				accessOriginAdmission: "configured",
			},
		});
	});

	it("fails readyz closed when the shared app-api runtime is not ready", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/readyz"), {
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
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
			ACCESS_TEAM_DOMAIN: "https://team-readyz.cloudflareaccess.com",
			ACCESS_POLICY_AUD: "panel-readyz-audience",
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
}
