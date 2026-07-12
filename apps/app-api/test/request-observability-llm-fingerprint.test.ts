// @vitest-environment node

import { describe, expect, it } from "vitest";

import type { ResolvedAppPrincipal } from "../src/modules/auth";
import type { ToolExecutionResponse } from "../src/modules/integration";
import { answerEvalFingerprintSha256 } from "../src/modules/integration/answer-eval-fingerprint-hash";
import { llmIoFingerprintSha256 } from "../src/modules/integration/llm-io-fingerprint-hash";
import { buildFinalizedRequestObservabilityFact } from "../src/modules/request-observability";

function createPrincipal(): ResolvedAppPrincipal {
	return {
		actor: {
			departments: [],
			principalId: "principal_01HQ",
			principalType: "student",
			roles: [],
			userId: "user_01HQ",
		},
		authorization: {
			approvalState: "not_required",
			applicabilityScope: "undergraduate",
			entitlementGroups: ["students"],
			entitlementSnapshotId: "entitlements-2026-03-29",
			ownershipScopes: [],
			principalId: "principal_01HQ",
			projectionSource: "campus_identity",
			retrievalFilter: {
				entitlementGroups: ["students"],
				policyProjectionVersion: "phase1-authorization-projection-v1",
				visibilityLevel: "public",
				visibilityScope: "main",
			},
			visibilityScope: "main",
		},
		permissions: {
			chat: true,
			operator: false,
		},
		principal: {
			displayName: "Jane Doe",
			email: "jane@example.edu.cn",
			principalId: "principal_01HQ",
			type: "student",
		},
		session: null,
	};
}

function createResponse(overrides: Partial<ToolExecutionResponse> = {}): ToolExecutionResponse {
	return {
		answerText: "当前没有足够依据回答这个问题。",
		error: null,
		followUpQuestion: "",
		observability: null,
		result: null,
		selectedTool: "knowledge_query",
		status: "no_answer",
		traceId: "trace_01HQ",
		...overrides,
		resolvedScope: overrides.resolvedScope ?? null,
		sessionUpdate: overrides.sessionUpdate ?? null,
	};
}

function createLlmIoFingerprint() {
	return {
		contextEnvelopeSha256:
			"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		evidencePacketSha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
		llmCallSite: "agent.primary" as const,
		memorySelectionSha256:
			"sha256:3333333333333333333333333333333333333333333333333333333333333333",
		model: "gpt-4.1",
		modelParamsHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
		modelParamsProjection: {
			paramsSchemaVersion: "openai.responses.safe_params.v1",
			paramsSha256: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
			projectedParams: {
				maxOutputTokens: 1200,
				reasoningEffort: "medium" as const,
				responseFormat: "json_schema" as const,
				temperature: 0.2,
				toolChoice: "auto" as const,
				topP: 1,
			},
			schemaVersion: "model_params_projection.v1" as const,
		},
		outputSchemaId: "primary_agent_terminal_output.v1",
		primaryAttestation: {
			attestationKind: "primary_agent_call" as const,
			attestationSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			attestedBy: "execution-control",
			schemaVersion: "primary_attestation.v1" as const,
		},
		promptId: "primary_agent_direct_answer",
		promptRegistryAttestation: {
			attestationSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			outputSchemaId: "primary_agent_terminal_output.v1",
			promptId: "primary_agent_direct_answer",
			promptRegistryVersion: "2026-07-05",
			promptTemplateSha256:
				"sha256:5555555555555555555555555555555555555555555555555555555555555555",
			promptVariablesSchemaVersion: "final_model_context.v1",
			schemaVersion: "prompt_registry_attestation.v1" as const,
		},
		promptTemplateSha256: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
		promptVariablesSchemaVersion: "final_model_context.v1",
		provider: "openai",
		providerProfileRevision: "primary_agent:provider_profile_primary:3",
		providerRequestSafeHash: {
			canonicalization: "canonical_json_redacted_v1" as const,
			redactionPolicy: "llm_provider_request_safe_projection.v1" as const,
			requestSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			schemaVersion: "provider_request_safe_hash.v1" as const,
		},
		renderedPromptSha256: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		runtimeRelease: "execution-control@test",
		schemaVersion: "llm_io_fingerprint.v1" as const,
		toolCatalogSha256: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
		toolRuntimeAttestation: {
			attestedBy: "execution-control",
			combinedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			configRefs: [
				"configs/runtime/tools.v4.json",
				"configs/runtime/tool-function-schemas.v1.json",
				"configs/runtime/workflow-artifacts.v2.json",
			] as [
				"configs/runtime/tools.v4.json",
				"configs/runtime/tool-function-schemas.v1.json",
				"configs/runtime/workflow-artifacts.v2.json",
			],
			functionSchemaVersion: "tool-function-schemas-v1",
			schemaVersion: "tool_runtime_attestation.v1" as const,
			toolsRegistryVersion: "2026-06-26",
			workflowArtifactRegistryVersion: "2026-05-07",
		},
		toolRuntimeFingerprint: {
			combinedSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			functionSchemaSha256:
				"sha256:8888888888888888888888888888888888888888888888888888888888888888",
			functionSchemaVersion: "tool-function-schemas-v1",
			schemaVersion: "tool_runtime_fingerprint.v1" as const,
			toolsRegistryVersion: "2026-06-26",
			toolsSchemaVersion: "tool-registry-v4",
			toolsSha256: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
			workflowArtifactRegistryVersion: "2026-05-07",
			workflowArtifactSchemaVersion: "workflow-artifact-registry-v2",
			workflowArtifactSha256:
				"sha256:9999999999999999999999999999999999999999999999999999999999999999",
		},
		toolSchemaSha256: "sha256:8888888888888888888888888888888888888888888888888888888888888888",
		traceId: "trace_01HQ",
		workflowArtifactSha256:
			"sha256:9999999999999999999999999999999999999999999999999999999999999999",
	};
}

function createAnswerEvalFingerprint() {
	const llmIoFingerprint = createLlmIoFingerprint();
	const fingerprint = {
		answerFingerprintSha256:
			"sha256:1212121212121212121212121212121212121212121212121212121212121212",
		branchIdentity: {
			branchKind: "tool_routed" as const,
			promptId: llmIoFingerprint.promptId,
			schemaVersion: "answer_branch_identity.v1" as const,
			workflowMode: "single_step",
		},
		llmCallSite: "agent.primary" as const,
		llmIoFingerprintSha256: llmIoFingerprintSha256(llmIoFingerprint),
		outputSchemaId: "primary_agent_terminal_output.v1",
		providerProfileRevision: "primary_agent:provider_profile_primary:3",
		requestId: "req_01HQ",
		runId: "run_01HQ",
		runtimeRelease: "execution-control@test",
		schemaVersion: "answer_eval_fingerprint.v1" as const,
		selectedTool: "transport_schedule_lookup",
		selectedTools: ["transport_schedule_lookup"],
		stageTimingProfileSha256:
			"sha256:1414141414141414141414141414141414141414141414141414141414141414",
		terminalOutcome: "grounded_answer",
		toolRuntimeCombinedSha256:
			"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		traceId: "trace_01HQ",
	};
	return {
		...fingerprint,
		answerFingerprintSha256: answerEvalFingerprintSha256(fingerprint),
	};
}

function createObservability(
	overrides: Partial<NonNullable<ToolExecutionResponse["observability"]>> = {},
): NonNullable<ToolExecutionResponse["observability"]> {
	return {
		agentRuntime: "openai_agents_sdk",
		selectedTools: ["knowledge_query"],
		terminalReason: "answer",
		...overrides,
	};
}

function buildFact(observability: NonNullable<ToolExecutionResponse["observability"]>) {
	return buildFinalizedRequestObservabilityFact({
		completedAt: "2026-04-12T08:00:01.000Z",
		conversationId: "conv_01HQ",
		durationMs: 420,
		errorCode: null,
		principal: createPrincipal(),
		requestId: "req_01HQ",
		requestedTool: null,
		requestedScope: null,
		resolvedScope: null,
		response: createResponse({ observability }),
		startedAt: "2026-04-12T08:00:00.000Z",
		status: "completed",
		surface: "campus_web",
		traceId: "trace_01HQ",
		runId: "run_01HQ",
	});
}

describe("request observability llm io fingerprint", () => {
	it("projects llm io fingerprint as safe observability metadata", () => {
		const llmIoFingerprint = createLlmIoFingerprint();
		const fact = buildFact(createObservability({ llmIoFingerprint }));

		expect(fact).toMatchObject({
			llmIoFingerprint,
			modelName: "gpt-4.1",
			modelProvider: "openai",
			promptId: "primary_agent_direct_answer",
			templateSha256: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
		});
		expect(JSON.stringify(fact.llmIoFingerprint)).not.toContain("provider_request_body");
		expect(JSON.stringify(fact.llmIoFingerprint)).not.toContain("raw_prompt");
	});

	it("projects answer eval fingerprint as safe observability metadata", () => {
		const llmIoFingerprint = createLlmIoFingerprint();
		const answerEvalFingerprint = createAnswerEvalFingerprint();
		const fact = buildFact(createObservability({ answerEvalFingerprint, llmIoFingerprint }));

		expect(fact.answerEvalFingerprint).toEqual(answerEvalFingerprint);
		expect(JSON.stringify(fact.answerEvalFingerprint)).not.toContain("raw_answer");
		expect(JSON.stringify(fact.answerEvalFingerprint)).not.toContain("provider_request_body");
	});

	it("rejects answer eval and llm io fingerprint drift before persistence", () => {
		const answerEvalFingerprint = {
			...createAnswerEvalFingerprint(),
			toolRuntimeCombinedSha256:
				"sha256:1515151515151515151515151515151515151515151515151515151515151515",
		};

		expect(() =>
			buildFact(
				createObservability({
					answerEvalFingerprint,
					llmIoFingerprint: createLlmIoFingerprint(),
				}),
			),
		).toThrow(/answer_eval_fingerprint\.tool_runtime_combined_sha256/);
	});

	it("rejects answer eval self hash drift before persistence", () => {
		const answerEvalFingerprint = {
			...createAnswerEvalFingerprint(),
			answerFingerprintSha256:
				"sha256:1616161616161616161616161616161616161616161616161616161616161616",
		};

		expect(() =>
			buildFact(
				createObservability({
					answerEvalFingerprint,
					llmIoFingerprint: createLlmIoFingerprint(),
				}),
			),
		).toThrow(/answer_eval_fingerprint\.answer_fingerprint_sha256/);
	});

	it("rejects llm io fingerprint drift from the finalized request", () => {
		const llmIoFingerprint = {
			...createLlmIoFingerprint(),
			requestId: "req_other",
		};

		expect(() => buildFact(createObservability({ llmIoFingerprint }))).toThrow(
			/llm_io_fingerprint\.request_id/,
		);
	});

	it("rejects answer eval that points at a different llm io fingerprint hash", () => {
		const answerEvalFingerprint = {
			...createAnswerEvalFingerprint(),
			llmIoFingerprintSha256:
				"sha256:1313131313131313131313131313131313131313131313131313131313131313",
		};

		expect(() =>
			buildFact(
				createObservability({
					answerEvalFingerprint,
					llmIoFingerprint: createLlmIoFingerprint(),
				}),
			),
		).toThrow(/answer_eval_fingerprint\.llm_io_fingerprint_sha256/);
	});

	it("rejects answer eval without llm io fingerprint", () => {
		expect(() =>
			buildFact(
				createObservability({
					answerEvalFingerprint: createAnswerEvalFingerprint(),
				}),
			),
		).toThrowError(
			expect.objectContaining({
				code: "validation_failed",
				status: 422,
			}),
		);
	});
});
