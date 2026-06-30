import { describe, expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

describe("operator provider-config proxy", () => {
	it("proxies provider configuration commands to app-api operator routes", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-provider-config.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["panel", "ops"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				const forwarded: Array<{ method: string; url: string }> = [];
				const workerEnv = {
					ACCESS_POLICY_AUD: "operator-console-test-audience",
					ACCESS_TEAM_DOMAIN: "https://team-provider-config.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwarded.push({ method: request.method, url: request.url });
							return new Response(JSON.stringify({ ok: true }), {
								headers: { "content-type": "application/json; charset=utf-8" },
								status: 200,
							});
						},
					},
					OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
					OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
					OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
				};

				const requests = [
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/connections",
						{
							headers: { "cf-access-jwt-assertion": token },
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/connections",
						{
							body: JSON.stringify({ features: ["prompt"] }),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "POST",
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/connections/provider_connection_1",
						{
							body: JSON.stringify({ baseUrl: "https://provider.example/v1" }),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "PATCH",
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/profiles",
						{
							headers: { "cf-access-jwt-assertion": token },
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/profiles",
						{
							body: JSON.stringify({ kind: "prompt" }),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "POST",
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/profiles/provider_profile_1",
						{
							body: JSON.stringify({ model: "gpt-test" }),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "PATCH",
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/profiles/provider_profile_1/validate",
						{
							headers: { "cf-access-jwt-assertion": token },
							method: "POST",
						},
					),
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/profiles/provider_profile_1/activate",
						{
							headers: { "cf-access-jwt-assertion": token },
							method: "POST",
						},
					),
				];

				for (const request of requests) {
					const response = await worker.fetch(request, workerEnv);
					expect(response.status, await response.text()).toBe(200);
				}

				expect(forwarded).toEqual([
					{
						method: "GET",
						url: "https://app-api.internal/api/operator/provider-config/connections",
					},
					{
						method: "POST",
						url: "https://app-api.internal/api/operator/provider-config/connections",
					},
					{
						method: "PATCH",
						url: "https://app-api.internal/api/operator/provider-config/connections/provider_connection_1",
					},
					{
						method: "GET",
						url: "https://app-api.internal/api/operator/provider-config/profiles",
					},
					{
						method: "POST",
						url: "https://app-api.internal/api/operator/provider-config/profiles",
					},
					{
						method: "PATCH",
						url: "https://app-api.internal/api/operator/provider-config/profiles/provider_profile_1",
					},
					{
						method: "POST",
						url: "https://app-api.internal/api/operator/provider-config/profiles/provider_profile_1/validate",
					},
					{
						method: "POST",
						url: "https://app-api.internal/api/operator/provider-config/profiles/provider_profile_1/activate",
					},
				]);
			},
		);
	});

	it("proxies provider configuration commands from an admitted access service token", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-provider-config-service-token.cloudflareaccess.com",
				claims: {
					common_name: "operator-console-staging-smoke.access",
					sub: "",
					type: "app",
				},
			},
			async (token) => {
				const forwardedHeaders: Record<string, string | null> = {};
				const response = await worker.fetch(
					new Request(
						"https://operator-console.example.com/api/operator/provider-config/profiles",
						{
							headers: { "cf-access-jwt-assertion": token },
						},
					),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
						ACCESS_TEAM_DOMAIN: "https://team-provider-config-service-token.cloudflareaccess.com",
						APP_API: {
							fetch: async (request: Request) => {
								for (const name of [
									"x-app-internal-auth",
									"x-app-operator-email",
									"x-app-operator-id",
									"x-app-operator-name",
									"x-app-operator-service-id",
								]) {
									forwardedHeaders[name] = request.headers.get(name);
								}
								return new Response(JSON.stringify({ profiles: [] }), {
									headers: { "content-type": "application/json; charset=utf-8" },
									status: 200,
								});
							},
						},
						OPERATOR_CONSOLE_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST:
							"operator-console-staging-smoke",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
					},
				);

				expect(response.status, await response.text()).toBe(200);
				expect(forwardedHeaders).toEqual({
					"x-app-internal-auth": "operator-console-bridge-secret",
					"x-app-operator-email": "operator-console-staging-smoke",
					"x-app-operator-id": "operator-console-staging-smoke",
					"x-app-operator-name": "operator-console-staging-smoke",
					"x-app-operator-service-id": "operator-console-staging-smoke",
				});
			},
		);
	});
});
