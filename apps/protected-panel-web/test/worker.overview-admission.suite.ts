import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerOverviewAdmissionSuite() {
	it("fails closed when protected overview admission is not configured", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/api/overview"), {
			PANEL_APP_NAME: "campus-agent-v2-protected-panel",
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
				message: "Protected panel admission is not configured.",
			},
		});
	});

	it("rejects protected overview requests without access jwt when cloudflare access is required", async () => {
		const response = await worker.fetch(new Request("https://panel.example.com/api/overview"), {
			PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
			PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
			ACCESS_TEAM_DOMAIN: "https://team-overview-token.cloudflareaccess.com",
			ACCESS_POLICY_AUD: "panel-operator-audience",
		});

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
					new Request("https://panel.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						PANEL_APP_NAME: "campus-agent-v2-protected-panel",
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-requests-list.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "panel-operator-audience",
					},
				);

				expect(response.status).toBe(200);
				await expect(response.json()).resolves.toEqual({
					status: "ok",
					app_name: "campus-agent-v2-protected-panel",
					surface: "protected-panel-web",
					runtime: "cloudflare-worker",
					protected_hostname: "panel.example.com",
					protection_envelope: "cloudflare-access",
					runtime_api_base_url: "https://app-api.internal",
					panel_domains: {
						overview: "ready",
						requests: "ready",
						official_web: "ready",
						jobs: "blocked",
						operations: "deferred",
						audit: "ready",
					},
					operator_context: {
						display_name: null,
						email: "ops@example.com",
						groups: [],
						operator_id: "ops@example.com",
						principal_class: "human",
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
					new Request("https://panel.example.com/api/overview", {
						headers: {
							cookie: `CF_AppSession=session-id; theme=light; CF_Authorization=${token}`,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						PANEL_APP_NAME: "campus-agent-v2-protected-panel",
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-cookie.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "panel-operator-audience",
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
					new Request("https://panel.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						PANEL_APP_NAME: "campus-agent-v2-protected-panel",
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-empty-identity.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "panel-operator-audience",
					},
				);

				expect(response.status).toBe(401);
				await expect(response.text()).resolves.toBe("Invalid Access JWT.");
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
					new Request("https://panel.example.com/api/overview", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						PANEL_APP_NAME: "campus-agent-v2-protected-panel",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
						ACCESS_TEAM_DOMAIN: "https://team-overview-bridge.cloudflareaccess.com",
						ACCESS_POLICY_AUD: "panel-operator-audience",
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
