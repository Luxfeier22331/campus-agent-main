import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerOperatorDomainsSuitePart04() {
	it("proxies authenticated notice processing queries to app-api operator projection", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-auth-notice-processing.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["panel", "ops"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				const forwardedUrls: string[] = [];

				const workerEnv = {
					ACCESS_POLICY_AUD: "panel-operator-audience",
					ACCESS_TEAM_DOMAIN: "https://team-auth-notice-processing.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwardedUrls.push(request.url);
							const pathname = new URL(request.url).pathname;
							if (pathname.endsWith("/run-processing/run-20260428")) {
								return new Response(
									JSON.stringify({
										run: {
											collectorRunToken: "20260428T181953007Z",
											lifecycleStatus: "mixed_terminal",
										},
									}),
									{
										headers: {
											"content-type": "application/json; charset=utf-8",
										},
										status: 200,
									},
								);
							}
							if (pathname.endsWith("/355867")) {
								return new Response(
									JSON.stringify({
										notice: {
											noticeId: "355867",
											lifecycleStatus: "tool_ready",
										},
									}),
									{
										headers: {
											"content-type": "application/json; charset=utf-8",
										},
										status: 200,
									},
								);
							}
							return new Response(
								JSON.stringify({
									notices: [
										{
											noticeId: "355867",
											lifecycleStatus: "tool_ready",
										},
									],
									page: {
										nextCursor: null,
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
				};

				const listResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/authenticated-notices/processing?noticeId=355867",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(listResponse.status).toBe(200);

				const runListResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/authenticated-notices/run-processing?collectorRunToken=20260428T181953007Z",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(runListResponse.status).toBe(200);

				const detailResponse = await worker.fetch(
					new Request("https://panel.example.com/api/authenticated-notices/processing/355867", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(detailResponse.status).toBe(200);

				const runDetailResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/authenticated-notices/run-processing/run-20260428",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(runDetailResponse.status).toBe(200);

				expect(forwardedUrls).toEqual([
					"https://app-api.internal/api/operator/authenticated-notices/processing?noticeId=355867",
					"https://app-api.internal/api/operator/authenticated-notices/run-processing?collectorRunToken=20260428T181953007Z",
					"https://app-api.internal/api/operator/authenticated-notices/processing/355867",
					"https://app-api.internal/api/operator/authenticated-notices/run-processing/run-20260428",
				]);
			},
		);
	});
}
