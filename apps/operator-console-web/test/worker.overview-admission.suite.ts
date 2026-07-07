import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerOverviewAdmissionSuite() {
	it("fails closed when protected overview admission is not configured", async () => {
		const response = await worker.fetch(
			new Request("https://operator-console.example.com/api/overview"),
			{
				OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
				OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
			},
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "dependency_not_ready",
				details: {
					missing: [
						"OPERATOR_CONSOLE_PROTECTION_ENVELOPE=cloudflare-access",
						"ACCESS_TEAM_DOMAIN",
						"ACCESS_POLICY_AUD",
					],
				},
				message: "Operator Console admission is not configured.",
			},
		});
	});

	it("rejects protected overview requests without access jwt when cloudflare access is required", async () => {
		const response = await worker.fetch(
			new Request("https://operator-console.example.com/api/overview"),
			{
				OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
				OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
				ACCESS_TEAM_DOMAIN: "https://team-overview-token.cloudflareaccess.com",
				ACCESS_POLICY_AUD: "operator-console-test-audience",
			},
		);

		expect(response.status).toBe(401);
		await expect(response.text()).resolves.toBe("Missing Access JWT.");
	});

	it("allows protected overview requests with a valid access jwt and exposes minimal operator context", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-requests-list.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-requests-list.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "operator-console-test-audience",
					},
				);

				expect(response.status).toBe(200);
				await expect(response.json()).resolves.toEqual({
					status: "ok",
					app_name: "campus-agent-v2-operator-console",
					surface: "operator-console-web",
					runtime: "cloudflare-worker",
					protected_hostname: "operator-console.example.com",
					protection_envelope: "cloudflare-access",
					runtime_api_base_url: "https://app-api.internal",
					operator_context: {
						display_name: null,
						email: "ops@example.com",
						groups: [],
						operator_id: "ops@example.com",
						principal_class: "human",
						service_id: null,
						subject: "operator-001",
					},
				});
			},
		);
	});

	it("accepts a valid CF_Authorization cookie as an equivalent signed access assertion", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-overview-cookie.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/overview", {
						headers: {
							cookie: `CF_AppSession=session-id; theme=light; CF_Authorization=${token}`,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-cookie.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "operator-console-test-audience",
					},
				);

				expect(response.status).toBe(200);
				await expect(response.json()).resolves.toMatchObject({
					operator_context: {
						email: "ops@example.com",
						operator_id: "ops@example.com",
						subject: "operator-001",
					},
				});
			},
		);
	});

	it("rejects signed access assertions that do not carry a stable operator identity", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-overview-empty-identity.cloudflareaccess.com",
				claims: {
					email: "   ",
					sub: "   ",
				},
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-empty-identity.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "operator-console-test-audience",
					},
				);

				expect(response.status).toBe(401);
				await expect(response.text()).resolves.toBe("Invalid Access JWT.");
			},
		);
	});

	it("rejects access service tokens unless explicitly admitted as machine operators", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-overview-service-token-deny.cloudflareaccess.com",
				claims: {
					common_name: "operator-console-staging-smoke.access",
					sub: "",
					type: "app",
				},
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-service-token-deny.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "operator-console-test-audience",
					},
				);

				expect(response.status).toBe(401);
				await expect(response.text()).resolves.toBe("Invalid Access JWT.");
			},
		);
	});

	it("maps explicitly allowed access service tokens to machine operator context", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-overview-service-token.cloudflareaccess.com",
				claims: {
					common_name: "operator-console-staging-smoke.access",
					sub: "",
					type: "app",
				},
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						OPERATOR_CONSOLE_ACCESS_SERVICE_TOKEN_OPERATOR_ALLOWLIST:
							"operator-console-staging-smoke",
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-service-token.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "operator-console-test-audience",
					},
				);

				expect(response.status).toBe(200);
				await expect(response.json()).resolves.toMatchObject({
					operator_context: {
						display_name: "operator-console-staging-smoke",
						email: null,
						operator_id: "operator-console-staging-smoke",
						principal_class: "service",
						service_id: "operator-console-staging-smoke",
						subject: "operator-console-staging-smoke",
					},
				});
			},
		);
	});

	it("fails closed when protected overview bridge is not configured", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-overview-bridge.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						OPERATOR_CONSOLE_APP_NAME: "campus-agent-v2-operator-console",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-bridge.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "operator-console-test-audience",
					},
				);

				expect(response.status).toBe(503);
				await expect(response.json()).resolves.toEqual({
					error: {
						code: "dependency_not_ready",
						message: "App API binding is not configured.",
					},
				});
			},
		);
	});
}
