import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerDiningOpsProxySuite() {
	it("does not expose dining ops routes from the minimal launch shell", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-dining-ops.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["operator"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				const forwarded: string[] = [];
				const env = {
					ACCESS_POLICY_AUD: "operator-console-test-audience",
					ACCESS_TEAM_DOMAIN: "https://team-dining-ops.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							const url = new URL(request.url);
							forwarded.push(`${request.method} ${url.pathname}${url.search}`);
							return new Response("unexpected dining proxy", { status: 500 });
						},
					},
					OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
					OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
					OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
				};
				const removedRoutes = [
					{ method: "GET", path: "/api/ops/dining/halls?campus=haidian" },
					{ method: "GET", path: "/api/ops/dining/halls/haidian-canteen-1/floors/1f" },
					{ method: "PATCH", path: "/api/ops/dining/windows/haidian-canteen-1:1f:window-01" },
					{ method: "POST", path: "/api/ops/dining/window-assignments" },
					{
						method: "PATCH",
						path: "/api/ops/dining/window-assignments/assignment:haidian-canteen-1:1f:window-01",
					},
					{ method: "POST", path: "/api/ops/dining/menu-items" },
					{ method: "PATCH", path: "/api/ops/dining/menu-items/menu:fanqie-niunanfan:1" },
					{ method: "POST", path: "/api/ops/dining/menu-offerings" },
					{
						method: "PATCH",
						path: "/api/ops/dining/menu-offerings/offering:assignment:window-01:menu:1",
					},
					{ method: "GET", path: "/api/ops/dining/release-candidates" },
					{ method: "POST", path: "/api/ops/dining/release-candidates" },
					{ method: "GET", path: "/api/ops/dining/release-candidates/dining_release_candidate:1" },
					{
						method: "POST",
						path: "/api/ops/dining/release-candidates/dining_release_candidate:1/validate",
					},
					{
						method: "POST",
						path: "/api/ops/dining/release-candidates/dining_release_candidate:1/approve",
					},
					{
						method: "POST",
						path: "/api/ops/dining/release-candidates/dining_release_candidate:1/schedule",
					},
					{
						method: "POST",
						path: "/api/ops/dining/release-candidates/dining_release_candidate:1/publish",
					},
					{
						method: "POST",
						path: "/api/ops/dining/release-candidates/dining_release_candidate:1/cancel",
					},
					{ method: "GET", path: "/api/ops/dining/releases" },
					{ method: "GET", path: "/api/ops/dining/releases/dining_release:dev_seed" },
					{
						method: "POST",
						path: "/api/ops/dining/releases/dining_release:dev_seed/rollback",
					},
					{ method: "GET", path: "/api/ops/dining/audit-events" },
				];

				for (const route of removedRoutes) {
					const response = await worker.fetch(
						new Request(`https://operator-console.example.com${route.path}`, {
							headers: {
								"cf-access-jwt-assertion": token,
							},
							method: route.method,
						}),
						env,
					);
					expect(response.status, `${route.method} ${route.path}`).toBe(404);
				}

				for (const blocked of [
					{ method: "GET", path: "/api/ops/dining/source-observations" },
					{ method: "POST", path: "/api/ops/dining/releases" },
					{
						method: "GET",
						path: "/api/ops/dining/releases/dining_release:dev_seed/preview",
					},
					{
						method: "POST",
						path: "/api/ops/dining/releases/dining_release:dev_seed/publish",
					},
					{ method: "GET", path: "/api/federation/authorize" },
				]) {
					const response = await worker.fetch(
						new Request(`https://operator-console.example.com${blocked.path}`, {
							headers: {
								"cf-access-jwt-assertion": token,
							},
							method: blocked.method,
						}),
						env,
					);
					expect(response.status).toBe(404);
				}

				expect(forwarded).toEqual([]);
			},
		);
	});
}
