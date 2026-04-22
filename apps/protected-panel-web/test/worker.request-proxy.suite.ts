import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerRequestProxySuite() {
	it("proxies request list queries to app-api with trusted operator headers", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-requests-detail.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["panel", "ops"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				let forwardedOperatorEmail: string | null = null;
				let forwardedOperatorId: string | null = null;
				let forwardedInternalAuth: string | null = null;
				let forwardedOperatorName: string | null = null;
				let forwardedBaggage: string | null = null;
				let forwardedSentryTrace: string | null = null;
				let forwardedUrl: string | null = null;

				const response = await worker.fetch(
					new Request("https://panel.example.com/api/requests?status=completed", {
						headers: {
							baggage: "sentry-environment=test",
							"cf-access-jwt-assertion": token,
							"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-requests-detail.cloudflareaccess.com",
						APP_API: {
							fetch: async (request: Request) => {
								forwardedUrl = request.url;
								forwardedOperatorEmail = request.headers.get("x-app-operator-email");
								forwardedOperatorId = request.headers.get("x-app-operator-id");
								forwardedInternalAuth = request.headers.get("x-app-internal-auth");
								forwardedOperatorName = request.headers.get("x-app-operator-name");
								forwardedBaggage = request.headers.get("baggage");
								forwardedSentryTrace = request.headers.get("sentry-trace");

								return new Response(
									JSON.stringify({
										page: {
											nextCursor: null,
										},
										requests: [{ requestId: "req_01HQ", status: "completed" }],
									}),
									{
										headers: {
											"content-type": "application/json; charset=utf-8",
										},
										status: 200,
									},
								);
							},
						},
						PANEL_APP_NAME: "campus-agent-v2-protected-panel",
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(response.status).toBe(200);
				await expect(response.json()).resolves.toEqual({
					page: {
						nextCursor: null,
					},
					requests: [{ requestId: "req_01HQ", status: "completed" }],
				});
				expect(forwardedUrl).toBe(
					"https://app-api.internal/api/operator/requests?status=completed",
				);
				expect(forwardedOperatorEmail).toBe("ops@example.com");
				expect(forwardedOperatorId).toBe("ops@example.com");
				expect(forwardedOperatorName).toBe("Ops Team");
				expect(forwardedInternalAuth).toBe("panel-bridge-secret");
				expect(forwardedBaggage).toBe("sentry-environment=test");
				expect(forwardedSentryTrace).toBe("0123456789abcdef0123456789abcdef-0123456789abcdef-1");
			},
		);
	});

	it("proxies request detail queries to app-api and fails closed without an app-api binding", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-request-detail.cloudflareaccess.com",
			},
			async (token) => {
				const ok = await worker.fetch(
					new Request("https://panel.example.com/api/requests/req_01HQ", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-request-detail.cloudflareaccess.com",
						APP_API: {
							fetch: async () =>
								new Response(JSON.stringify({ request: { requestId: "req_01HQ" } }), {
									headers: {
										"content-type": "application/json; charset=utf-8",
									},
									status: 200,
								}),
						},
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(ok.status).toBe(200);
				await expect(ok.json()).resolves.toEqual({
					request: {
						requestId: "req_01HQ",
					},
				});

				const missingBinding = await worker.fetch(
					new Request("https://panel.example.com/api/requests/req_01HQ", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-request-detail.cloudflareaccess.com",
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(missingBinding.status).toBe(503);
				await expect(missingBinding.json()).resolves.toEqual({
					error: {
						code: "dependency_not_ready",
						message: "App API binding is not configured.",
					},
				});
			},
		);
	});

	it("returns a contract-shaped dependency error when the app-api binding throws", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-request-throw.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://panel.example.com/api/requests/req_01HQ", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-request-throw.cloudflareaccess.com",
						APP_API: {
							fetch: async () => {
								throw new Error("service binding failure");
							},
						},
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(response.status).toBe(503);
				await expect(response.json()).resolves.toEqual({
					error: {
						code: "dependency_not_ready",
						details: null,
						message: "App API upstream is unavailable.",
						requestId: null,
						retryable: true,
						traceId: null,
					},
				});
			},
		);
	});

	it("proxies request observability detail queries to the app-api observability seam", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-observability.cloudflareaccess.com",
			},
			async (token) => {
				let forwardedUrl: string | null = null;
				const response = await worker.fetch(
					new Request("https://panel.example.com/api/requests/req_01HQ/observability", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-observability.cloudflareaccess.com",
						APP_API: {
							fetch: async (request: Request) => {
								forwardedUrl = request.url;
								return new Response(
									JSON.stringify({
										request: {
											requestId: "req_01HQ",
										},
									}),
									{
										headers: {
											"content-type": "application/json; charset=utf-8",
										},
										status: 200,
									},
								);
							},
						},
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(response.status).toBe(200);
				await expect(response.json()).resolves.toEqual({
					request: {
						requestId: "req_01HQ",
					},
				});
				expect(forwardedUrl).toBe(
					"https://app-api.internal/api/operator/requests/req_01HQ/observability",
				);
			},
		);
	});
}
