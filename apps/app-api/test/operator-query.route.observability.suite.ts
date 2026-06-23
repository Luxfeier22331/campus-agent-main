import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { OperatorQueryService } from "../src/modules/operator-query";
import { createOperatorPrincipal, env } from "./operator-query.route.test-support";

export function registerOperatorQueryObservabilitySuite(): void {
	describe("GET /api/operator/requests/:requestId/observability", () => {
		it("returns request-scoped observability detail for operator principals", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getLangfuseEvalBacklinksByTraceId: vi.fn().mockResolvedValue({
					backlinks: [
						{
							environment: "staging",
							evalRunId: "ragas-smoke:2026-06-23",
							langfuseUrl: "https://langfuse.example/project/traces/trace_01HQ",
							release: "release-2026-06-23",
							scoreName: "faithfulness",
							scoreValue: 0.91,
							traceId: "trace_01HQ",
						},
					],
				}),
				getObservabilityById: vi.fn().mockResolvedValue({
					auditSummary: {
						auditEventCount: 0,
						latestTerminalCode: "completed",
					},
					links: {
						issueFingerprint: "timeout:execution-control",
						issueLink: "https://sentry.example/issues/123",
						traceLink: "https://sentry.example/traces/trace_01HQ",
					},
					observability: {
						aclAnomalyCode: null,
						aclDecision: "allowed",
						cachedInputTokens: 0,
						candidateCount: 4,
						claimSupportSummary: {
							supportedClaims: 1,
							totalClaims: 3,
							unsupportedClaimTypes: [
								"audience_or_major_or_program_or_class_family",
								"offering_unit_or_owning_school",
							],
							unsupportedClaims: 2,
							unsupportedFields: ["audience_claims", "offering_unit_claims"],
						},
						citationCount: 2,
						citationExpected: true,
						citationMissing: false,
						durationMs: 842,
						emptyRecall: false,
						estimatedCost: {
							currency: "USD",
							microusd: 3810,
						},
						failClosed: false,
						inputTokens: 812,
						measuredAt: "2026-03-28T08:00:01.000Z",
						model: {
							name: "gpt-5.2-mini",
							provider: "openai",
						},
						outputTokens: 229,
						prompt: {
							id: "rag_answer_v1",
							runtimeDetail: null,
							runtimeState: null,
							templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
							version: "v1",
						},
						projectionLagMs: 420,
						refusalClass: null,
						retrievedSourceCount: 2,
						retrievalAdequacyReason: "sufficient",
						retrievalAdequacyVerdict: "sufficient",
						retrievalPlan: {
							planId: "curriculum:curriculum_plan:current",
							queryMode: "current",
							replanCount: 0,
							terminalState: "completed",
							stepActivities: [
								{
									candidateCount: 4,
									collection: "curriculum_plan",
									corpus: "curriculum",
									failureKind: null,
									latencyMs: 18,
									referenceCount: 4,
									status: "succeeded",
									stepId: "indexed-lookup",
									stepType: "indexed_lookup",
									topK: 8,
								},
							],
						},
						retrievalAttempted: true,
						sourceTrace: {
							retrieved: [
								{
									chunkId: "chunk-raw-1",
									collection: "curriculum_plan",
									docId: "curriculum:法学（民族实验班）本科人才培养方案",
									score: 0.94,
									sourceTitle: "法学（民族实验班）本科人才培养方案",
									canonicalSourceId: null,
									canonicalSourceTitle: null,
									sourceUnitKind: null,
									sourceUnitKey: null,
								},
							],
							supporting: [
								{
									chunkId: "chunk-support-1",
									collection: "program_semester_facts",
									docId: "program_semester_facts:law:semester-4",
									score: 0.97,
									sourceTitle: "法学（民族实验班）本科人才培养方案 第四学期课程事实",
									canonicalSourceId: "curriculum:法学（民族实验班）本科人才培养方案",
									canonicalSourceTitle: null,
									sourceUnitKind: "semester_course_list",
									sourceUnitKey: "semester-4",
								},
							],
						},
						traceAvailable: true,
					},
					request: {
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_01HQ",
						requestId: "req_01HQ",
						runId: "run_01HQ",
						requestedCapability: "knowledge",
						requestedScope: {
							collection: "student_rules",
							corpus: "regulations",
						},
						selectedCapability: "knowledge",
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "completed",
						surface: "campus_web",
						traceId: "trace_01HQ",
					},
				}),
				getOverview: vi.fn(),
				listAudit: vi.fn(),
				list: vi.fn(),
			} as unknown as OperatorQueryService;
			const principal = createOperatorPrincipal();
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(principal),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests/req_01HQ/observability"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				auditSummary: {
					auditEventCount: 0,
					latestTerminalCode: "completed",
				},
				links: {
					langfuseEvalBacklinks: [
						{
							environment: "staging",
							evalRunId: "ragas-smoke:2026-06-23",
							langfuseUrl: "https://langfuse.example/project/traces/trace_01HQ",
							release: "release-2026-06-23",
							scoreName: "faithfulness",
							scoreValue: 0.91,
							traceId: "trace_01HQ",
						},
					],
					issueFingerprint: "timeout:execution-control",
					issueLink: "https://sentry.example/issues/123",
					traceLink: "https://sentry.example/traces/trace_01HQ",
				},
				observability: {
					aclAnomalyCode: null,
					aclDecision: "allowed",
					cachedInputTokens: 0,
					candidateCount: 4,
					claimSupportSummary: {
						supportedClaims: 1,
						totalClaims: 3,
						unsupportedClaimTypes: [
							"audience_or_major_or_program_or_class_family",
							"offering_unit_or_owning_school",
						],
						unsupportedClaims: 2,
						unsupportedFields: ["audience_claims", "offering_unit_claims"],
					},
					citationCount: 2,
					citationExpected: true,
					citationMissing: false,
					durationMs: 842,
					emptyRecall: false,
					estimatedCost: {
						currency: "USD",
						microusd: 3810,
					},
					failClosed: false,
					inputTokens: 812,
					measuredAt: "2026-03-28T08:00:01.000Z",
					model: {
						name: "gpt-5.2-mini",
						provider: "openai",
					},
					outputTokens: 229,
					prompt: {
						id: "rag_answer_v1",
						runtimeDetail: null,
						runtimeState: null,
						templateSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
						version: "v1",
					},
					projectionLagMs: 420,
					refusalClass: null,
					retrievedSourceCount: 2,
					retrievalAdequacyReason: "sufficient",
					retrievalAdequacyVerdict: "sufficient",
					retrievalPlan: {
						planId: "curriculum:curriculum_plan:current",
						queryMode: "current",
						replanCount: 0,
						terminalState: "completed",
						stepActivities: [
							{
								candidateCount: 4,
								collection: "curriculum_plan",
								corpus: "curriculum",
								failureKind: null,
								latencyMs: 18,
								referenceCount: 4,
								status: "succeeded",
								stepId: "indexed-lookup",
								stepType: "indexed_lookup",
								topK: 8,
							},
						],
					},
					retrievalAttempted: true,
					sourceTrace: {
						retrieved: [
							{
								chunkId: "chunk-raw-1",
								collection: "curriculum_plan",
								docId: "curriculum:法学（民族实验班）本科人才培养方案",
								score: 0.94,
								sourceTitle: "法学（民族实验班）本科人才培养方案",
								canonicalSourceId: null,
								canonicalSourceTitle: null,
								sourceUnitKind: null,
								sourceUnitKey: null,
							},
						],
						supporting: [
							{
								chunkId: "chunk-support-1",
								collection: "program_semester_facts",
								docId: "program_semester_facts:law:semester-4",
								score: 0.97,
								sourceTitle: "法学（民族实验班）本科人才培养方案 第四学期课程事实",
								canonicalSourceId: "curriculum:法学（民族实验班）本科人才培养方案",
								canonicalSourceTitle: null,
								sourceUnitKind: "semester_course_list",
								sourceUnitKey: "semester-4",
							},
						],
					},
					traceAvailable: true,
				},
				request: {
					completedAt: "2026-03-28T08:00:01.000Z",
					conversationId: "conv_01HQ",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					requestedCapability: "knowledge",
					requestedScope: {
						collection: "student_rules",
						corpus: "regulations",
					},
					selectedCapability: "knowledge",
					startedAt: "2026-03-28T08:00:00.000Z",
					status: "completed",
					surface: "campus_web",
					traceId: "trace_01HQ",
				},
			});
			expect(service.getObservabilityById).toHaveBeenCalledWith({
				principal,
				requestId: "req_01HQ",
			});
			expect(service.getLangfuseEvalBacklinksByTraceId).toHaveBeenCalledWith({
				principal,
				traceId: "trace_01HQ",
			});
		});

		it("returns empty retrieved trace without mirroring supporting evidence", async () => {
			const service = {
				getById: vi.fn(),
				getAuditById: vi.fn(),
				getLangfuseEvalBacklinksByTraceId: vi.fn().mockResolvedValue({
					backlinks: [],
				}),
				getObservabilityById: vi.fn().mockResolvedValue({
					auditSummary: {
						auditEventCount: 0,
						latestTerminalCode: "completed",
					},
					links: {
						issueFingerprint: null,
						issueLink: null,
						traceLink: "https://sentry.example/traces/trace_02HQ",
					},
					observability: {
						aclAnomalyCode: null,
						aclDecision: "allowed",
						cachedInputTokens: 0,
						candidateCount: 2,
						claimSupportSummary: null,
						citationCount: 1,
						citationExpected: true,
						citationMissing: false,
						durationMs: 460,
						emptyRecall: true,
						estimatedCost: {
							currency: "USD",
							microusd: 1200,
						},
						failClosed: false,
						inputTokens: 320,
						measuredAt: "2026-03-28T08:00:01.000Z",
						model: {
							name: "gpt-5.2-mini",
							provider: "openai",
						},
						outputTokens: 80,
						prompt: {
							id: "rag_answer_v1",
							runtimeDetail: null,
							runtimeState: null,
							templateSha256: null,
							version: "v1",
						},
						projectionLagMs: 410,
						refusalClass: null,
						retrievedSourceCount: 0,
						retrievalAdequacyReason: "sufficient",
						retrievalAdequacyVerdict: "sufficient",
						retrievalAttempted: true,
						sourceTrace: {
							retrieved: [],
							supporting: [
								{
									chunkId: "chunk-support-1",
									collection: "program_semester_facts",
									docId: "program_semester_facts:law:semester-4",
									score: 0.97,
									sourceTitle: "法学（民族实验班）本科人才培养方案 第四学期课程事实",
									canonicalSourceId: "curriculum:法学（民族实验班）本科人才培养方案",
									canonicalSourceTitle: null,
									sourceUnitKind: "semester_course_list",
									sourceUnitKey: "semester-4",
								},
							],
						},
						traceAvailable: true,
					},
					request: {
						completedAt: "2026-03-28T08:00:01.000Z",
						conversationId: "conv_02HQ",
						requestId: "req_02HQ",
						requestedCapability: "knowledge",
						requestedScope: {
							collection: "curriculum_plan",
							corpus: "curriculum",
						},
						resolvedScope: {
							collection: "curriculum_plan",
							corpus: "curriculum",
						},
						selectedCapability: "knowledge",
						startedAt: "2026-03-28T08:00:00.000Z",
						status: "completed",
						surface: "campus_web",
						traceId: "trace_02HQ",
					},
				}),
				getOverview: vi.fn(),
				listAudit: vi.fn(),
				list: vi.fn(),
			} as unknown as OperatorQueryService;
			const app = createApp(env, {
				getPrincipal: vi.fn().mockResolvedValue(createOperatorPrincipal()),
				operatorQueryService: service,
			});

			const response = await app.fetch(
				new Request("https://app-api.internal/api/operator/requests/req_02HQ/observability"),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				observability: {
					emptyRecall: true,
					retrievedSourceCount: 0,
					retrievalAttempted: true,
					sourceTrace: {
						retrieved: [],
						supporting: [
							{
								canonicalSourceId: "curriculum:法学（民族实验班）本科人才培养方案",
								chunkId: "chunk-support-1",
								collection: "program_semester_facts",
								docId: "program_semester_facts:law:semester-4",
								sourceUnitKey: "semester-4",
							},
						],
					},
				},
			});
		});
	});
}
