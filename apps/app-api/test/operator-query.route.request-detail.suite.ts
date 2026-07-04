import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type { OperatorRequestDetailResult } from "../src/modules/operator-query";
import {
	createOperatorPrincipal,
	createOperatorQueryServiceMock,
	env,
} from "./operator-query.route.test-support";

export function registerOperatorQueryRequestDetailSuite(): void {
	describe("GET /api/operator/requests/:requestId", () => {
		it("returns one request projection detail", async () => {
			const service = createOperatorQueryServiceMock({
				getById: vi.fn().mockResolvedValue({
					opsIndex: null,
					request: {
						answerPreview: "图书馆开放到 22:00。",
						applicabilityScope: "undergraduate",
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_01HQ",
						durationMs: 842,
						errorCode: null,
						entitlementGroups: ["students"],
						entitlementSnapshotId: "entitlements-2026-03-29",
						principalId: "user_01HQ",
						principalLabel: "Jane Doe",
						principalType: "student",
						projectedAt: "2026-03-28T08:00:02.000Z",
						questionPreview: "图书馆开放到几点？",
						requestId: "req_01HQ",
						runId: "run_01HQ",
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
						visibilityScope: "main",
					},
				}),
			});
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests/req_01HQ"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				opsIndex: null,
				request: {
					answerPreview: "图书馆开放到 22:00。",
					applicabilityScope: "undergraduate",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					durationMs: 842,
					errorCode: null,
					entitlementGroups: ["students"],
					entitlementSnapshotId: "entitlements-2026-03-29",
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "student",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "图书馆开放到几点？",
					requestId: "req_01HQ",
					runId: "run_01HQ",
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
					visibilityScope: "main",
				},
			});
			expect(service.getById).toHaveBeenCalledWith({
				principal,
				requestId: "req_01HQ",
			});
		});

		it("maps missing projections onto the shared error envelope", async () => {
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: createOperatorQueryServiceMock({
					getById: vi.fn().mockRejectedValue(
						new AppApiRouteError({
							code: "request_not_found",
							message: "Request projection not found.",
							retryable: false,
							status: 404,
						}),
					),
				}),
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests/req_missing"),
			);

			expect(response.status).toBe(404);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "request_not_found",
					details: null,
					message: "Request projection not found.",
					requestId: null,
					retryable: false,
					traceId: null,
				},
			});
		});

		it("includes summary diagnostics in request detail when projection carries them", async () => {
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: createOperatorQueryServiceMock({
					getById: vi.fn().mockResolvedValue({
						opsIndex: null,
						request: {
							answerPreview:
								"在《示例大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
							completedAt: "2026-03-28T08:00:01.000Z",
							conversationId: "conv_01HQ",
							diagnostics: {
								clarificationReason: null,
								noAnswerReason: "resolved_policy_clause_not_found",
								policyReason: null,
								resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
								resolvedPolicyTitle: "示例大学本科学生国家奖学金评审办法",
								retrievedTitleSummary: ["示例大学本科学生国家奖学金评审办法"],
								rewrittenQuery:
									"示例大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
								scopeClass: null,
								semanticOutcome: null,
							},
							durationMs: 842,
							errorCode: null,
							principalId: "user_01HQ",
							principalLabel: "Jane Doe",
							principalType: "campus_member",
							projectedAt: "2026-03-28T08:00:02.000Z",
							questionPreview:
								"民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
							requestId: "req_01HQ",
							requestedTool: "knowledge_query",
							requestedScope: {
								collection: "student_rules",
								corpus: "regulations",
							},
							selectedTool: "knowledge_query",
							sourceDocIds: ["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"],
							startedAt: "2026-03-28T08:00:00.000Z",
							status: "no_answer",
							surface: "campus_web",
							traceId: "trace_01HQ",
						},
					}),
				}),
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests/req_01HQ"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				opsIndex: null,
				request: {
					answerPreview:
						"在《示例大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					diagnostics: {
						clarificationReason: null,
						noAnswerReason: "resolved_policy_clause_not_found",
						policyReason: null,
						resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
						resolvedPolicyTitle: "示例大学本科学生国家奖学金评审办法",
						retrievedTitleSummary: ["示例大学本科学生国家奖学金评审办法"],
						rewrittenQuery:
							"示例大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
						scopeClass: null,
						semanticOutcome: null,
					},
					durationMs: 842,
					errorCode: null,
					principalId: "user_01HQ",
					principalLabel: "Jane Doe",
					principalType: "campus_member",
					projectedAt: "2026-03-28T08:00:02.000Z",
					questionPreview: "民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
					requestId: "req_01HQ",
					requestedTool: "knowledge_query",
					requestedScope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					selectedTool: "knowledge_query",
					sourceDocIds: ["handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"],
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "no_answer",
					surface: "campus_web",
					traceId: "trace_01HQ",
				},
			});
		});

		it("returns safe ops index beside request detail when runtime observation exists", async () => {
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: createOperatorQueryServiceMock({
					getById: vi.fn().mockResolvedValue({
						opsIndex: {
							debugTraceRefs: [
								{
									sink: "langfuse",
									traceId: "trace_01HQ",
									traceRef: "lf_trace_01HQ",
									url: "https://langfuse.example/project/traces/lf_trace_01HQ",
								},
							],
							model: {
								billableStepCount: 2,
								cachedInputTokens: 12,
								estimatedCostMicrousd: 120,
								executionDetail: "completed",
								executionState: "completed",
								inputTokens: 300,
								modelName: "gpt-test",
								modelProvider: "openai",
								outputTokens: 80,
								promptId: "campus-primary-agent",
								promptVersion: "current",
								templateSha256: "sha256-template",
								usageSummary: [],
							},
							retrieval: {
								adequacyReason: "enough_evidence",
								adequacyVerdict: "adequate",
								candidateCount: 8,
								collection: "student_rules",
								retrievalAttempted: true,
								retrievedSourceCount: 3,
							},
							sinkLinks: {
								projectionLagMs: 250,
								traceAvailable: true,
							},
							stageTiming: {
								"agent.primary_ms": 620,
								"memory.recall_ms": 34,
							},
							tool: {
								failClosed: false,
								failCloseReason: null,
								historicalDowngradeReason: null,
								requestedTool: "knowledge_query",
								selectedTool: "knowledge_query",
								toolBusinessOutcome: "answered",
							},
						},
						request: {
							answerPreview: "图书馆开放到 22:00。",
							applicabilityScope: null,
							completedAt: "2026-03-28T08:00:01.000Z",
							conversationId: "conv_01HQ",
							durationMs: 842,
							errorCode: null,
							entitlementGroups: ["students"],
							entitlementSnapshotId: null,
							principalId: "user_01HQ",
							principalLabel: "Jane Doe",
							principalType: "student",
							projectedAt: "2026-03-28T08:00:02.000Z",
							questionPreview: "图书馆开放到几点？",
							requestId: "req_01HQ",
							runId: "run_01HQ",
							requestedTool: "knowledge_query",
							requestedScope: null,
							resolvedScope: null,
							selectedTool: "knowledge_query",
							sourceDocIds: ["handbook:library-hours"],
							startedAt: "2026-03-28T08:00:00.000Z",
							status: "completed",
							surface: "campus_web",
							traceId: "trace_01HQ",
							visibilityScope: null,
						},
					}),
				}),
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests/req_01HQ"),
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as OperatorRequestDetailResult;
			expect(payload.opsIndex).toMatchObject({
				model: {
					modelName: "gpt-test",
					modelProvider: "openai",
				},
				retrieval: {
					retrievalAttempted: true,
					retrievedSourceCount: 3,
				},
				sinkLinks: {
					traceAvailable: true,
				},
				stageTiming: {
					"agent.primary_ms": 620,
				},
			});
			expect(JSON.stringify(payload.opsIndex)).not.toMatch(
				/rawPrompt|rawAnswer|rawProvider|providerPayload|traceBody|transcript/i,
			);
		});
	});
}
