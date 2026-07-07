import { expect, it } from "vitest";

import { createHtmlShellResponse, withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerShellAssetsSuite() {
	it("serves the protected app shell from static assets after operator admission and bridge readiness", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-operator-console-shell.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/requests", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
						ACCESS_TEAM_DOMAIN: "https://team-operator-console-shell.cloudflareaccess.com",
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						ASSETS: {
							fetch: async () => createHtmlShellResponse(),
						},
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(response.status).toBe(200);
				expect(response.headers.get("content-type")).toContain("text/html");
				await expect(response.text()).resolves.toContain('<div id="root"></div>');
			},
		);
	});

	it("fails closed when the protected shell bridge is not configured", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-operator-console-bridge.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/requests", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
						ACCESS_TEAM_DOMAIN: "https://team-operator-console-bridge.cloudflareaccess.com",
						ASSETS: {
							fetch: async () => createHtmlShellResponse(),
						},
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
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

	it("fails closed when protected shell admission is not configured", async () => {
		const response = await worker.fetch(new Request("https://operator-console.example.com/"), {
			ASSETS: {
				fetch: async () => createHtmlShellResponse(),
			},
			OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
		});

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

	it("fails closed when frontend assets are not configured for the protected shell", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-operator-console-assets.cloudflareaccess.com",
			},
			async (token) => {
				const response = await worker.fetch(
					new Request("https://operator-console.example.com/", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
						ACCESS_TEAM_DOMAIN: "https://team-operator-console-assets.cloudflareaccess.com",
						APP_API: {
							fetch: async () => new Response(null, { status: 204 }),
						},
						OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
						OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
						OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(response.status).toBe(503);
				await expect(response.json()).resolves.toEqual({
					error: {
						code: "frontend_assets_not_ready",
						message: "Operator Console frontend assets are not configured.",
					},
				});
			},
		);
	});
}
