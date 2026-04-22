import { expect, it, vi } from "vitest";

import {
	createAppApi,
	createHtmlShellResponse,
	createOperatorQueryServiceMock,
	withAccessAssertion,
	worker,
} from "./worker.test-support";

export function registerWorkerOperatorDomainsSuite() {
	it("proxies operator aggregate namespaces to app-api with the same trusted operator bridge", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-operator-aggregates.cloudflareaccess.com",
				claims: {
					email: "ops@example.com",
					groups: ["panel", "ops"],
					name: "Ops Team",
					sub: "operator-001",
				},
			},
			async (token) => {
				const forwardedUrls: string[] = [];
				const forwardedOperatorEmails: string[] = [];

				const workerEnv = {
					ACCESS_POLICY_AUD: "panel-operator-audience",
					ACCESS_TEAM_DOMAIN: "https://team-operator-aggregates.cloudflareaccess.com",
					APP_API: {
						fetch: async (request: Request) => {
							const forwardedUrl = request.url;
							forwardedUrls.push(forwardedUrl);
							forwardedOperatorEmails.push(request.headers.get("x-app-operator-email") ?? "");

							const pathname = new URL(forwardedUrl).pathname;
							if (pathname === "/api/operator/quality/summary") {
								return new Response(
									JSON.stringify({
										asOf: "2026-03-28T08:00:10.000Z",
										runtime: {
											citationMissRate: { count: 1, eligibleCount: 4, value: 0.25 },
											emptyRecallRate: { count: 0, eligibleCount: 4, value: 0 },
											requestCount: 4,
											refusalDistribution: {
												approvalRequired: 0,
												needsClarification: 0,
												noAnswer: 0,
												rejected: 0,
											},
										},
										sampledGrades: null,
										window: {
											from: "2026-03-27T08:00:10.000Z",
											granularity: "1h",
											to: "2026-03-28T08:00:10.000Z",
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

							if (pathname === "/api/operator/cost/timeseries") {
								return new Response(
									JSON.stringify({
										asOf: "2026-03-28T08:00:10.000Z",
										series: [
											{
												bucketEnd: "2026-03-28T08:00:00.000Z",
												bucketStart: "2026-03-28T07:00:00.000Z",
												cachedInputTokens: 0,
												estimatedCostMicrousd: 3810,
												inputTokens: 812,
												outputTokens: 229,
											},
										],
										window: {
											from: "2026-03-27T08:00:10.000Z",
											granularity: "1h",
											to: "2026-03-28T08:00:10.000Z",
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

							if (pathname === "/api/operator/audit") {
								return new Response(
									JSON.stringify({
										events: [
											{
												auditEventId: "aevt_01HQ",
												eventType: "request.completed",
												occurredAt: "2026-03-28T08:00:01.000Z",
												principalType: "campus_member",
												requestId: "req_01HQ",
												selectedTarget: "rag-agent",
												status: "completed",
												summary: "Knowledge request completed via rag-agent.",
												surface: "public_chat_web",
												traceId: "trace_01HQ",
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
							}

							if (pathname === "/api/operator/audit/aevt_01HQ") {
								return new Response(
									JSON.stringify({
										event: {
											auditEventId: "aevt_01HQ",
											requestId: "req_01HQ",
										},
										links: {
											issueFingerprint: "projection-missing",
											issueLink: "https://sentry.example/issues/789",
											traceLink: "https://sentry.example/traces/trace_01HQ",
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

							throw new Error(`Unexpected proxied operator path: ${pathname}`);
						},
					},
					PANEL_APP_API_SHARED_SECRET: "panel-bridge-secret",
					PANEL_PROTECTION_ENVELOPE: "cloudflare-access",
					PANEL_RUNTIME_API_BASE_URL: "https://app-api.internal",
				};

				const qualitySummaryResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/operator/quality/summary?window=24h&surface=public_chat_web",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(qualitySummaryResponse.status).toBe(200);
				await expect(qualitySummaryResponse.json()).resolves.toMatchObject({
					runtime: {
						requestCount: 4,
					},
				});

				const costTimeseriesResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/operator/cost/timeseries?window=24h&granularity=1h",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(costTimeseriesResponse.status).toBe(200);
				await expect(costTimeseriesResponse.json()).resolves.toMatchObject({
					series: [
						{
							estimatedCostMicrousd: 3810,
							inputTokens: 812,
							outputTokens: 229,
						},
					],
				});

				const auditListResponse = await worker.fetch(
					new Request(
						"https://panel.example.com/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(auditListResponse.status).toBe(200);
				await expect(auditListResponse.json()).resolves.toMatchObject({
					events: [
						{
							auditEventId: "aevt_01HQ",
							eventType: "request.completed",
						},
					],
				});

				const auditDetailResponse = await worker.fetch(
					new Request("https://panel.example.com/api/operator/audit/aevt_01HQ", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(auditDetailResponse.status).toBe(200);
				await expect(auditDetailResponse.json()).resolves.toMatchObject({
					event: {
						auditEventId: "aevt_01HQ",
					},
				});

				expect(forwardedUrls).toEqual([
					"https://app-api.internal/api/operator/quality/summary?window=24h&surface=public_chat_web",
					"https://app-api.internal/api/operator/cost/timeseries?window=24h&granularity=1h",
					"https://app-api.internal/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
					"https://app-api.internal/api/operator/audit/aevt_01HQ",
				]);
				expect(forwardedOperatorEmails).toEqual([
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
				]);
			},
		);
	});

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
}
