import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerOperatorDomainsSuitePart03() {
	it("proxies official web target inventory queries to app-api operator projection", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-official-web-target-inventory.cloudflareaccess.com",
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
					ACCESS_TEAM_DOMAIN: "https://team-official-web-target-inventory.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwardedUrls.push(request.url);
							const pathname = new URL(request.url).pathname;
							if (pathname.endsWith("/muc-information-disclosure-application-process")) {
								return new Response(
									JSON.stringify({
										inventoryEntry: {
											inventoryId: "muc-information-disclosure-application-process",
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
									entries: [{ inventoryId: "muc-information-disclosure-application-process" }],
									page: { nextCursor: null },
									summary: {
										countsByReviewState: { candidate: 1 },
										inventoryVersion: "muc_public_target_inventory_v1",
										siteId: "muc_public",
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
						"https://panel.example.com/api/official-web/target-inventory?siteId=muc_public",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(listResponse.status).toBe(200);
				await expect(listResponse.json()).resolves.toEqual({
					entries: [{ inventoryId: "muc-information-disclosure-application-process" }],
					page: { nextCursor: null },
					summary: {
						countsByReviewState: { candidate: 1 },
						inventoryVersion: "muc_public_target_inventory_v1",
						siteId: "muc_public",
					},
				});

				const detailResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/official-web/target-inventory/muc-information-disclosure-application-process",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(detailResponse.status).toBe(200);
				await expect(detailResponse.json()).resolves.toEqual({
					inventoryEntry: {
						inventoryId: "muc-information-disclosure-application-process",
					},
				});
				expect(forwardedUrls).toEqual([
					"https://app-api.internal/api/operator/official-web/target-inventory?siteId=muc_public",
					"https://app-api.internal/api/operator/official-web/target-inventory/muc-information-disclosure-application-process",
				]);
			},
		);
	});

	it("does not proxy official web selected-write task operations through the panel", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-official-web-selected-write.cloudflareaccess.com",
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
					ACCESS_POLICY_AUD: "panel-operator-audience",
					ACCESS_TEAM_DOMAIN: "https://team-official-web-selected-write.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwarded.push({
								method: request.method,
								url: request.url,
							});
							return new Response("unexpected selected-write proxy", { status: 500 });
						},
					},
					PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
					PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
					PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
				};

				const approveResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/official-web/target-inventory/muc-main-homepage-contact/selected-write-gates",
						{
							body: JSON.stringify({
								decision: "approved",
								notes: "reviewed",
							}),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "POST",
						},
					),
					workerEnv,
				);
				expect(approveResponse.status).toBe(404);

				const queueResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/official-web/target-selected-write-gates/owselected_muc_main_homepage_contact_owrun_contact/execution-requests",
						{
							body: JSON.stringify({
								notes: "publish current selected-write preview",
							}),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "POST",
						},
					),
					workerEnv,
				);
				expect(queueResponse.status).toBe(404);

				const interventionResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/official-web/target-selected-write-admissions/owselected_muc_main_homepage_contact_owrun_contact/interventions",
						{
							body: JSON.stringify({
								action: "operator_block",
								notes: "source is being investigated",
							}),
							headers: {
								"cf-access-jwt-assertion": token,
								"content-type": "application/json",
							},
							method: "POST",
						},
					),
					workerEnv,
				);
				expect(interventionResponse.status).toBe(404);
				expect(forwarded).toEqual([]);
			},
		);
	});
}
