import { expect, it } from "vitest";

import { withAccessAssertion, worker } from "./worker.test-support";

export function registerWorkerOperatorDomainsSuitePart01() {
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
					ACCESS_POLICY_AUD: "operator-console-test-audience",
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

							if (pathname === "/api/operator/runtime/health") {
								return new Response(
									JSON.stringify({
										asOf: "2026-06-16T08:00:00.000Z",
										executionRuntime: {
											blockers: {},
											checks: {
												runProjectionStore: "ready",
												temporalRuntime: "ready",
											},
											status: "ready",
										},
										runProjectionStore: {
											configured: true,
											healthy: true,
											lastError: null,
										},
										status: "ready",
										temporalRuntime: {
											configured: true,
											healthy: true,
											lastError: null,
											namespace: "campus-agent-staging",
											requiredTaskQueues: ["campus-agent.workflow"],
											taskQueueGate: "pollers_required",
											taskQueuePollers: [
												{
													healthy: true,
													name: "campus-agent.workflow",
													pollers: 1,
													type: "workflow",
												},
											],
											workerId: "staging:workflow:01",
											workflowTaskQueue: "campus-agent.workflow",
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
												selectedCapability: "knowledge",
												status: "completed",
												summary: "Knowledge request completed via knowledge.",
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

							if (pathname === "/api/operator/quality/eval-candidates") {
								return new Response(
									JSON.stringify({
										candidates: [
											{
												candidateId: "eval_candidate:req_01HR:intent_classifier_mismatch",
												causeClass: "intent_classifier_mismatch",
												intake: {
													createdAt: "2026-03-28T08:03:10.000Z",
													source: "operator_badcase",
													status: "pending_review",
													suggestedEvalFamily: "intent",
												},
												requestId: "req_01HR",
												runId: "run_01HR",
												selectedCapability: "navigation",
												summary: "intent classifier selected the wrong handoff target",
												surface: "public_chat_web",
												traceId: "trace_01HR",
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

							if (pathname === "/api/operator/intent/summary") {
								return new Response(
									JSON.stringify({
										asOf: "2026-03-28T08:00:10.000Z",
										runtime: {
											ambiguityRate: { count: 1, eligibleCount: 4, value: 0.25 },
											contextUnresolvedRate: { count: 0, eligibleCount: 4, value: 0 },
											distributions: {
												capability: [{ count: 4, value: "knowledge" }],
												classifierVersion: [{ count: 4, value: "intent-classifier@2026-04-20" }],
												launchState: [{ count: 4, value: "open" }],
												nextAction: [{ count: 4, value: "delegate" }],
												schemaVersion: [{ count: 4, value: "intent-schema-1.0.0" }],
												scopeClass: [{ count: 4, value: "in_scope" }],
												taskKind: [{ count: 4, value: "knowledge_lookup" }],
											},
											lowConfidenceRate: { count: 0, eligibleCount: 4, value: 0 },
											requestCount: 4,
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

							if (pathname === "/api/operator/evals/coverage") {
								return new Response(
									JSON.stringify({
										denominatorSurfaces: [
											"regulations/student_rules",
											"regulations/institutional_rules",
											"curriculum/curriculum_plan",
											"official_web/stable_reference",
										],
										excludedSurfaces: [
											{
												reason: "excluded from current RAG consumption denominator",
												surfaceKey: "official_web/fresh_news",
											},
										],
										generatedAt: "2026-05-21T09:00:00.000Z",
										schemaVersion: "eval_coverage_snapshot.v1",
										snapshotId: "eval_coverage:2026-05-21T090000Z",
										sourceGitHead: "git-main",
										sourceReportSchema: "rag-eval-coverage-report.v1",
										surfaces: [],
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
					OPERATOR_CONSOLE_APP_API_SHARED_SECRET: "operator-console-bridge-secret",
					OPERATOR_CONSOLE_PROTECTION_ENVELOPE: "cloudflare-access",
					OPERATOR_CONSOLE_APP_API_BASE_URL: "https://app-api.internal",
				};

				const qualitySummaryResponse = await worker.fetch(
					new Request(
						"https://operator-console.example.com/api/operator/quality/summary?window=24h&surface=public_chat_web",
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

				const runtimeHealthResponse = await worker.fetch(
					new Request("https://operator-console.example.com/api/operator/runtime/health", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(runtimeHealthResponse.status).toBe(200);
				await expect(runtimeHealthResponse.json()).resolves.toMatchObject({
					executionRuntime: {
						checks: {
							temporalRuntime: "ready",
						},
						status: "ready",
					},
					temporalRuntime: {
						namespace: "campus-agent-staging",
						workflowTaskQueue: "campus-agent.workflow",
					},
				});

				const costTimeseriesResponse = await worker.fetch(
					new Request(
						"https://operator-console.example.com/api/operator/cost/timeseries?window=24h&granularity=1h",
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
						"https://operator-console.example.com/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
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

				const evalCandidatesResponse = await worker.fetch(
					new Request(
						"https://operator-console.example.com/api/operator/quality/eval-candidates?status=open&causeClass=intent_classifier_mismatch",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(evalCandidatesResponse.status).toBe(200);
				await expect(evalCandidatesResponse.json()).resolves.toMatchObject({
					candidates: [
						{
							candidateId: "eval_candidate:req_01HR:intent_classifier_mismatch",
							intake: {
								suggestedEvalFamily: "intent",
							},
							runId: "run_01HR",
						},
					],
				});

				const intentSummaryResponse = await worker.fetch(
					new Request(
						"https://operator-console.example.com/api/operator/intent/summary?window=24h&surface=public_chat_web",
						{
							headers: {
								"cf-access-jwt-assertion": token,
							},
						},
					),
					workerEnv,
				);
				expect(intentSummaryResponse.status).toBe(200);
				await expect(intentSummaryResponse.json()).resolves.toMatchObject({
					runtime: {
						requestCount: 4,
					},
				});

				const evalCoverageResponse = await worker.fetch(
					new Request("https://operator-console.example.com/api/operator/evals/coverage", {
						headers: {
							"cf-access-jwt-assertion": token,
						},
					}),
					workerEnv,
				);
				expect(evalCoverageResponse.status).toBe(200);
				await expect(evalCoverageResponse.json()).resolves.toMatchObject({
					snapshotId: "eval_coverage:2026-05-21T090000Z",
				});

				const auditDetailResponse = await worker.fetch(
					new Request("https://operator-console.example.com/api/operator/audit/aevt_01HQ", {
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
					"https://app-api.internal/api/operator/runtime/health",
					"https://app-api.internal/api/operator/cost/timeseries?window=24h&granularity=1h",
					"https://app-api.internal/api/operator/audit?limit=10&requestId=req_01HQ&eventType=request.completed",
					"https://app-api.internal/api/operator/quality/eval-candidates?status=open&causeClass=intent_classifier_mismatch",
					"https://app-api.internal/api/operator/intent/summary?window=24h&surface=public_chat_web",
					"https://app-api.internal/api/operator/evals/coverage",
					"https://app-api.internal/api/operator/audit/aevt_01HQ",
				]);
				expect(forwardedOperatorEmails).toEqual([
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
					"ops@example.com",
				]);
			},
		);
	});
}
