import { expect, it, vi } from "vitest";

import {
	createAppApi,
	createHtmlShellResponse,
	createOperatorQueryServiceMock,
	withAccessAssertion,
	worker,
} from "./worker.test-support";

export function registerWorkerOperatorDomainsSuitePart02() {
	it("smokes request queries through protected-panel-web into app-api with internal caller admission", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-smoke.cloudflareaccess.com",
			},
			async (token) => {
				const appApiEnv = {
					APP_API_NAME: "campus-agent-app-api",
					APP_API_ENVIRONMENT: "test" as const,
					BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
					PUBLIC_CHAT_WEB_ORIGIN: "https://chat.example.com",
					SUPERVISOR_API_BASE_URL: "https://supervisor.internal",
					SUPERVISOR_API_SHARED_SECRET: "shared-secret",
					APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
					APP_API_INTERNAL_SHARED_SECRET: "panel-bridge-secret",
					APP_API_DB: {
						connectionString: "postgres://postgres:secret@example.com:5432/campus_agent",
					},
				};
				const appApi = createAppApi(appApiEnv, {
					operatorQueryService: createOperatorQueryServiceMock({
						list: vi.fn().mockResolvedValue({
							page: {
								nextCursor: null,
							},
							requests: [
								{
									answerPreview: "图书馆开放到 22:00。",
									completedAt: "2026-03-28T08:00:01.000Z",
									conversationId: "conv_01HQ",
									durationMs: 812,
									errorCode: null,
									principalId: "user_01HQ",
									principalLabel: "Jane Doe",
									principalType: "campus_member",
									projectedAt: "2026-03-28T08:00:02.000Z",
									questionPreview: "图书馆开放到几点？",
									requestId: "req_01HQ",
									requestedCapability: "knowledge",
									requestedScope: {
										collection: "student_rules",
										corpus: "regulations",
									},
									selectedTarget: "rag-agent",
									sourceDocIds: ["handbook:library-hours"],
									startedAt: "2026-03-28T08:00:00.000Z",
									status: "completed",
									surface: "public_chat_web",
									traceId: "trace_01HQ",
								},
							],
						}),
					}),
				});

				const response = await worker.fetch(
					new Request("https://panel.example.com/api/requests?status=completed", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-smoke.cloudflareaccess.com",
						APP_API: {
							fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
						},
						ASSETS: {
							fetch: async () => createHtmlShellResponse(),
						},
						PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
						PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
						PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
					},
				);

				expect(response.status).toBe(200);
				expect(response.headers.get("cache-control")).toBe("no-store");
				await expect(response.json()).resolves.toMatchObject({
					requests: [
						{
							requestId: "req_01HQ",
							status: "completed",
						},
					],
				});
			},
		);
	});

	it("proxies official web site queries to app-api with the same trusted operator bridge", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-official-web-sites.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["panel", "ops"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				let forwardedUrl: string | null = null;

				const response = await worker.fetch(
					new Request("https://panel.example.com/api/official-web/sites", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "panel-operator-audience",
						ACCESS_TEAM_DOMAIN: "https://team-official-web-sites.cloudflareaccess.com",
						APP_API: {
							fetch: async (request: Request) => {
								forwardedUrl = request.url;

								return new Response(
									JSON.stringify({
										sites: [{ siteId: "www_muc_edu_cn" }],
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
					sites: [{ siteId: "www_muc_edu_cn" }],
				});
				expect(forwardedUrl).toBe("https://app-api.internal/api/operator/official-web/sites");
			},
		);
	});

	it("proxies official web target job queries to app-api with the same trusted operator bridge", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-official-web-targets.cloudflareaccess.com",
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
					ACCESS_TEAM_DOMAIN: "https://team-official-web-targets.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							forwardedUrls.push(request.url);
							const pathname = new URL(request.url).pathname;
							if (pathname.endsWith("/owtarget_muc_public_contact")) {
								return new Response(
									JSON.stringify({
										targetJob: {
											job: {
												id: "owtarget_muc_public_contact",
												targetId: "campus-services-contact-directory",
											},
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
									jobs: [{ id: "owtarget_muc_public_contact" }],
									page: { nextCursor: null },
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
					new Request("https://panel.example.com/api/official-web/target-jobs?siteId=muc_public", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(listResponse.status).toBe(200);
				await expect(listResponse.json()).resolves.toEqual({
					jobs: [{ id: "owtarget_muc_public_contact" }],
					page: { nextCursor: null },
				});

				const detailResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/official-web/target-jobs/owtarget_muc_public_contact",
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
					targetJob: {
						job: {
							id: "owtarget_muc_public_contact",
							targetId: "campus-services-contact-directory",
						},
					},
				});
				expect(forwardedUrls).toEqual([
					"https://app-api.internal/api/operator/official-web/target-jobs?siteId=muc_public",
					"https://app-api.internal/api/operator/official-web/target-jobs/owtarget_muc_public_contact",
				]);
			},
		);
	});
}
