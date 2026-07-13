import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerOperatorDomainsSuitePart02() {
	it("does not proxy non-minimal operator domains", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-retired-ops.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["panel", "ops"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				const forwarded: string[] = [];
				const workerEnv = {
					ACCESS_POLICY_AUD: "operator-console-test-audience",
					ACCESS_TEAM_DOMAIN: "https://team-retired-ops.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwarded.push(request.url);
							return new Response("unexpected proxy", { status: 500 });
						},
					},
					OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
					OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
					OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
				};

				for (const path of [
					"/api/requests",
					"/api/requests/req_01HQ",
					"/api/operator/overview",
					"/api/operator/runtime/health",
					"/api/official-web/sites",
					"/api/official-web/sites/www_muc_edu_cn",
					"/api/official-web/runs?siteId=muc_public",
					"/api/official-web/runs/owrun_contact",
					"/api/official-web/target-jobs",
					"/api/official-web/target-inventory",
					"/api/official-web/release-tasks",
					"/api/operator/audit",
					"/api/operator/audit/audit_01HQ",
					"/api/authenticated-notices/processing",
					"/api/authenticated-notices/run-processing",
					"/api/operator/quality/summary",
					"/api/operator/cost/timeseries",
					"/api/operator/intent/summary",
					"/api/operator/safety/summary",
				]) {
					const response = await worker.fetch(
						new Request(`https://operator-console.example.com${path}`, {
							headers: { "cf-access-jwt-assertion": token },
						}),
						workerEnv,
					);
					expect(response.status, path).toBe(404);
				}
				expect(forwarded).toEqual([]);
			},
		);
	});
}
