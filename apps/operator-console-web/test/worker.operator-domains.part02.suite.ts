import { expect, it, vi } from "vitest";

import {
	createAppApi,
	createHtmlShellResponse,
	createOperatorQueryServiceMock,
	withAccessAssertion,
	worker,
} from "./worker.test-support";

export function registerWorkerOperatorDomainsSuitePart02() {
	it("smokes request queries through operator-console-web into app-api with internal caller admission", async () => {
		await withAccessAssertion(
			{
				accessTeamDomain: "https://team-smoke.cloudflareaccess.com",
			},
			async (token) => {
				const appApiEnv = {
					APP_API_NAME: "campus-agent-app-api",
					APP_API_ENVIRONMENT: "test" as const,
					BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
					EXECUTION_CONTROL_BASE_URL: "https://execution-control.internal",
					EXECUTION_CONTROL_SHARED_SECRET: "shared-secret",
					APP_API_OPERATOR_EMAIL_ALLOWLIST: "ops@example.com",
					APP_API_INTERNAL_SHARED_SECRET: "operator-console-bridge-secret",
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
									requestedTool: "knowledge_query",
									requestedScope: {
										collection: "student_rules",
										corpus: "regulations",
									},
									selectedTool: "knowledge_query",
									sourceDocIds: ["handbook:library-hours"],
									startedAt: "2026-03-28T08:00:00.000Z",
									status: "completed",
									surface: "campus_web",
									traceId: "trace_01HQ",
								},
							],
						}),
					}),
				});

				const response = await worker.fetch(
					new Request("https://operator-console.example.com/api/requests?status=completed", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					{
						ACCESS_POLICY_AUD: "operator-console-test-audience",
						ACCESS_TEAM_DOMAIN: "https://team-smoke.cloudflareaccess.com",
						APP_API: {
							fetch: async (request: Request) => appApi.fetch(request, appApiEnv),
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
