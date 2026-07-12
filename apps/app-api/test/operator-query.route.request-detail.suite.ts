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
						requestedScope: "student_rules",
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
					requestedScope: "student_rules",
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

		it("returns safe ops index beside request detail when runtime observation exists", async () => {
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: createOperatorQueryServiceMock({
					getById: vi.fn().mockResolvedValue({
						opsIndex: {
							model: {
								answerEvalFingerprint: null,
								llmIoFingerprint: null,
								modelName: "gpt-test",
								modelProvider: "openai",
								promptId: "campus-primary-agent",
								promptVersion: "current",
								templateSha256: "sha256-template",
							},
							sinkLinks: {
								projectionLagMs: 250,
								traceAvailable: true,
							},
							stageTiming: {
								"agent.primary_ms": 620,
								"memory.recall_ms": 34,
							},
							sources: [
								{
									canonicalUrl: "/docs/regulations/student_rules/leave-policy",
									sourceKind: "regulation",
									sourceTitle: "学生请假管理规定",
									targetKind: "canonical_reader",
									versionId: "student-rules-current",
								},
							],
							tool: {
								failClosed: false,
								requestedTool: "knowledge_query",
								selectedTool: "knowledge_query",
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
				sources: [
					{
						canonicalUrl: "/docs/regulations/student_rules/leave-policy",
						sourceTitle: "学生请假管理规定",
					},
				],
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
