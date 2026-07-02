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
					new Request("https://operator-console.example.com/api/requests?status=completed", {
						headers: {
							baggage: "sentry-environment=test",
							"cf-access-jwt-assertion": token,
							"sentry-trace": "0123456789abcdef0123456789abcdef-0123456789abcdef-1",
						},
					}),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
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
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
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
				expect(forwardedInternalAuth).toBe("operator-console-bridge-secret");
				expect(forwardedBaggage).toBe("sentry-environment=test");
				expect(forwardedSentryTrace).toBe("0123456789abcdef0123456789abcdef-0123456789abcdef-1");
			},
		);
	});

	it("proxies request detail routes to app-api and keeps retired observability detail closed", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-request-detail.cloudflareaccess.com",
			},
			async (token) => {
				const forwarded: string[] = [];
				const workerEnv = {
					ACCESS_POLICY_AUD: "operator-console-test-audience",
					ACCESS_TEAM_DOMAIN: "https://team-request-detail.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwarded.push(request.url);
							return new Response(JSON.stringify({ ok: true }), {
								headers: { "content-type": "application/json; charset=utf-8" },
								status: 200,
							});
						},
					},
					OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
					OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
					OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
				};

				const detailResponse = await worker.fetch(
					new Request("https://operator-console.example.com/api/requests/req_01HQ", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(detailResponse.status).toBe(200);

				const observabilityResponse = await worker.fetch(
					new Request("https://operator-console.example.com/api/requests/req_01HQ/observability", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(observabilityResponse.status).toBe(404);
				expect(forwarded).toEqual(["https://app-api.internal/api/operator/requests/req_01HQ"]);
			},
		);
	});

	it("returns a contract-shaped dependency error when the request list app-api binding throws", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-request-throw.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/requests?limit=20", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
						ACCESS_TEAM_DOMAIN: "https://team-request-throw.cloudflareaccess.com",
						APP_API: {
							fetch: async () => {
								throw new Error("service binding failure");
							},
						},
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
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
}
