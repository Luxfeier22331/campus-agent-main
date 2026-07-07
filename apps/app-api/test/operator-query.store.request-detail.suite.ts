import { beforeEach, expect, it, vi } from "vitest";

import type { OperatorRequestDetailResult } from "../src/modules/operator-query";
import type { OperatorQueryStoreSuiteContext } from "./operator-query.store.suite-context";

export function registerOperatorQueryStoreRequestDetailSuite(
	ctx: OperatorQueryStoreSuiteContext,
): void {
	const { createPgOperatorQueryStore, createRuntimeDatabase, resetOperatorQueryStoreMocks } = ctx;

	beforeEach(() => {
		resetOperatorQueryStoreMocks();
	});

	it("loads request detail with safe runtime ops index from request observability fact", async () => {
		const requestLimit = vi.fn().mockResolvedValue([
			{
				answerPreview: "图书馆开放到 22:00。",
				applicabilityScope: null,
				completedAt: new Date("2026-03-28T08:00:01.000Z"),
				conversationId: "conv_01HQ",
				diagnosticsJson: null,
				durationMs: 842,
				errorCode: null,
				entitlementGroupsJson: ["students"],
				entitlementSnapshotId: null,
				principalId: "user_01HQ",
				principalLabel: "Jane Doe",
				principalType: "campus_member",
				projectedAt: new Date("2026-03-28T08:00:02.000Z"),
				questionPreview: "图书馆开放到几点？",
				requestedTool: "knowledge_query",
				requestedScopeJson: null,
				requestId: "req_01HQ",
				resolvedScopeJson: null,
				selectedTool: "knowledge_query",
				sourceDocIdsJson: ["handbook:library-hours"],
				startedAt: new Date("2026-03-28T08:00:00.000Z"),
				status: "completed",
				surface: "campus_web",
				traceId: "trace_01HQ",
				versionQueryJson: null,
				visibilityScope: null,
			},
		]);
		const runLimit = vi.fn().mockResolvedValue([{ requestId: "req_01HQ", runId: "run_01HQ" }]);
		const opsIndexLimit = vi.fn().mockResolvedValue([
			{
				answerEvalFingerprintJson: {
					answerFingerprintSha256:
						"sha256:1212121212121212121212121212121212121212121212121212121212121212",
					branchIdentity: {
						branchKind: "tool_routed",
						promptId: "primary_agent",
						schemaVersion: "answer_branch_identity.v1",
						workflowMode: "single_step",
					},
					llmCallSite: "agent.primary",
					llmIoFingerprintSha256:
						"sha256:1313131313131313131313131313131313131313131313131313131313131313",
					outputSchemaId: "primary_agent_terminal_output.v1",
					providerProfileRevision: "primary_agent:provider_profile_primary:3",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					runtimeRelease: "execution-control@test",
					schemaVersion: "answer_eval_fingerprint.v1",
					selectedTool: "knowledge_query",
					selectedTools: ["knowledge_query"],
					stageTimingProfileSha256:
						"sha256:1414141414141414141414141414141414141414141414141414141414141414",
					terminalOutcome: "grounded_answer",
					toolRuntimeCombinedSha256:
						"sha256:1515151515151515151515151515151515151515151515151515151515151515",
					traceId: "trace_01HQ",
				},
				billableStepCount: 2,
				cachedInputTokens: 12,
				candidateCount: 8,
				collection: "student_rules",
				debugTraceRefsJson: [
					{
						sink: "langfuse",
						traceId: "trace_01HQ",
						traceRef: "lf_trace_01HQ",
						url: "https://langfuse.example/project/traces/lf_trace_01HQ",
					},
				],
				estimatedCostMicrousd: 120,
				failClosed: false,
				inputTokens: 300,
				llmIoFingerprintJson: {
					contextEnvelopeSha256:
						"sha256:1111111111111111111111111111111111111111111111111111111111111111",
					evidencePacketSha256:
						"sha256:2222222222222222222222222222222222222222222222222222222222222222",
					memorySelectionSha256:
						"sha256:3333333333333333333333333333333333333333333333333333333333333333",
					model: "gpt-test",
					modelParamsHash:
						"sha256:4444444444444444444444444444444444444444444444444444444444444444",
					outputSchemaId: "primary_agent_terminal_output.v1",
					promptId: "campus-primary-agent",
					promptTemplateSha256:
						"sha256:5555555555555555555555555555555555555555555555555555555555555555",
					promptVariablesSchemaVersion: "final_model_context.v1",
					provider: "openai",
					providerProfileRevision: "primary_agent:provider_profile_primary:3",
					renderedPromptSha256:
						"sha256:6666666666666666666666666666666666666666666666666666666666666666",
					requestId: "req_01HQ",
					runId: "run_01HQ",
					runtimeRelease: "execution-control@test",
					schemaVersion: "llm_io_fingerprint.v1",
					toolCatalogSha256:
						"sha256:7777777777777777777777777777777777777777777777777777777777777777",
					toolSchemaSha256:
						"sha256:8888888888888888888888888888888888888888888888888888888888888888",
					traceId: "trace_01HQ",
					workflowArtifactSha256:
						"sha256:9999999999999999999999999999999999999999999999999999999999999999",
				},
				modelExecutionDetail: "completed",
				modelExecutionState: "completed",
				modelName: "gpt-test",
				modelProvider: "openai",
				modelUsageSummaryJson: [],
				outputTokens: 80,
				projectionLagMs: 250,
				promptId: "campus-primary-agent",
				promptVersion: "current",
				requestedTool: "knowledge_query",
				retrievalAdequacyReason: "enough_evidence",
				retrievalAdequacyVerdict: "adequate",
				retrievalAttempted: true,
				retrievedSourceCount: 3,
				selectedTool: "knowledge_query",
				stageTimingJson: {
					"agent.primary_ms": 8_200,
					"memory.recall_ms": 34,
					"provider.queue_ms": 900,
				},
				templateSha256: "sha256-template",
				toolBusinessOutcome: "answered",
				toolFailCloseReason: null,
				toolHistoricalDowngradeReason: null,
				traceAvailable: true,
			},
		]);
		const where = vi
			.fn()
			.mockReturnValueOnce({ limit: requestLimit })
			.mockReturnValueOnce({ limit: runLimit })
			.mockReturnValueOnce({ limit: opsIndexLimit });
		const select = vi.fn(() => ({
			from: vi.fn(() => ({ where })),
		}));
		createRuntimeDatabase.mockResolvedValue({ select });

		const store = createPgOperatorQueryStore({} as never);
		const result = (await store.getById("req_01HQ")) as OperatorRequestDetailResult | null;

		if (!result) {
			throw new Error("expected request detail");
		}
		expect(result).toMatchObject({
			opsIndex: {
				debugTraceRefs: [
					{
						sink: "langfuse",
						traceRef: "lf_trace_01HQ",
					},
				],
				model: {
					answerEvalFingerprint: {
						runId: "run_01HQ",
						schemaVersion: "answer_eval_fingerprint.v1",
						terminalOutcome: "grounded_answer",
					},
					billableStepCount: 2,
					llmIoFingerprint: {
						runId: "run_01HQ",
						schemaVersion: "llm_io_fingerprint.v1",
						traceId: "trace_01HQ",
					},
					modelName: "gpt-test",
					modelProvider: "openai",
				},
				retrieval: {
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
					"agent.primary_ms": 8_200,
					"memory.recall_ms": 34,
				},
				stageTimingBudget: {
					"agent.primary_ms": {
						budgetState: "warn",
						budgetVersion: "latency-budget-v1",
						criticalMs: 14_000,
						durationMs: 8_200,
						warnMs: 7_000,
					},
					"memory.recall_ms": {
						budgetState: "within_budget",
						budgetVersion: "latency-budget-v1",
						criticalMs: 2_000,
						durationMs: 34,
						warnMs: 800,
					},
				},
				tool: {
					failClosed: false,
					requestedTool: "knowledge_query",
					selectedTool: "knowledge_query",
					toolBusinessOutcome: "answered",
				},
			},
			request: {
				requestId: "req_01HQ",
				runId: "run_01HQ",
			},
		});
		expect(JSON.stringify(result.opsIndex)).not.toMatch(
			/rawPrompt|rawAnswer|rawProvider|providerPayload|traceBody|transcript/i,
		);
		expect(JSON.stringify(result.opsIndex)).not.toContain("provider.queue_ms");
	});
}
