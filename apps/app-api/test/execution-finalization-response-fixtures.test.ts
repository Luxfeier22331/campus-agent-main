// @vitest-environment node

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseExecutionFinalizationResponsePayload } from "../src/modules/integration/execution-control";

const fixtureDir = resolve(
	process.cwd(),
	"../..",
	"packages/contracts/fixtures/tool_execution_contract",
);

function loadFixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(join(fixtureDir, name), "utf8")) as Record<string, unknown>;
}

function toolRuntimeFingerprintFixture(): Record<string, unknown> {
	return {
		schema_version: "tool_runtime_fingerprint.v1",
		tools_schema_version: "tool-registry-v4",
		tools_registry_version: "2026-06-26",
		tools_sha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		function_schema_version: "tool-function-schemas-v1",
		function_schema_sha256:
			"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		workflow_artifact_schema_version: "workflow-artifact-registry-v2",
		workflow_artifact_registry_version: "2026-05-07",
		workflow_artifact_sha256:
			"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		combined_sha256: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
	};
}

function llmIoFingerprintFixture(input: {
	model: string;
	outputSchemaId: string;
	promptId: string;
	promptVariablesSchemaVersion: string;
	providerProfileRevision: string;
}): Record<string, unknown> {
	return {
		schema_version: "llm_io_fingerprint.v1",
		run_id: "run_temporal_finalization",
		request_id: "req_temporal_finalization",
		trace_id: "trace-temporal-finalization",
		runtime_release: "execution-control@test",
		llm_call_site: "agent.primary",
		provider_profile_revision: input.providerProfileRevision,
		provider: "openai",
		model: input.model,
		model_params_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		model_params_projection: {
			schema_version: "model_params_projection.v1",
			params_schema_version: "openai.responses.safe_params.v1",
			params_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			projected_params: {
				max_output_tokens: 1200,
				temperature: 0.2,
				top_p: 1,
				reasoning_effort: "medium",
				response_format: "json_schema",
				tool_choice: "none",
			},
		},
		prompt_id: input.promptId,
		prompt_registry_attestation: {
			schema_version: "prompt_registry_attestation.v1",
			prompt_registry_version: "2026-07-05",
			prompt_id: input.promptId,
			prompt_template_sha256:
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			prompt_variables_schema_version: input.promptVariablesSchemaVersion,
			output_schema_id: input.outputSchemaId,
			attestation_sha256: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
		},
		prompt_template_sha256:
			"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		prompt_variables_schema_version: input.promptVariablesSchemaVersion,
		rendered_prompt_sha256:
			"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		provider_request_safe_hash: {
			schema_version: "provider_request_safe_hash.v1",
			canonicalization: "canonical_json_redacted_v1",
			redaction_policy: "llm_provider_request_safe_projection.v1",
			request_sha256: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
		},
		tool_catalog_sha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		tool_schema_sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		tool_runtime_fingerprint: toolRuntimeFingerprintFixture(),
		tool_runtime_attestation: {
			schema_version: "tool_runtime_attestation.v1",
			attested_by: "execution-control",
			config_refs: [
				"configs/runtime/tools.v4.json",
				"configs/runtime/tool-function-schemas.v1.json",
				"configs/runtime/workflow-artifacts.v2.json",
			],
			tools_registry_version: "2026-06-26",
			function_schema_version: "tool-function-schemas-v1",
			workflow_artifact_registry_version: "2026-05-07",
			combined_sha256: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
		},
		workflow_artifact_sha256:
			"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		context_envelope_sha256:
			"sha256:1111111111111111111111111111111111111111111111111111111111111111",
		memory_selection_sha256:
			"sha256:2222222222222222222222222222222222222222222222222222222222222222",
		evidence_packet_sha256:
			"sha256:3333333333333333333333333333333333333333333333333333333333333333",
		output_schema_id: input.outputSchemaId,
		primary_attestation: {
			schema_version: "primary_attestation.v1",
			attestation_kind: "primary_agent_call",
			attested_by: "apps/agent-runtime",
			attestation_sha256: "sha256:7777777777777777777777777777777777777777777777777777777777777777",
		},
	};
}

function answerEvalFingerprintFixture(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		schema_version: "answer_eval_fingerprint.v1",
		answer_fingerprint_sha256:
			"sha256:1212121212121212121212121212121212121212121212121212121212121212",
		run_id: "run_temporal_finalization",
		request_id: "req_temporal_finalization",
		trace_id: "trace-temporal-finalization",
		runtime_release: "execution-control@test",
		llm_call_site: "agent.primary",
		llm_io_fingerprint_sha256:
			"sha256:1313131313131313131313131313131313131313131313131313131313131313",
		provider_profile_revision: "primary_agent:provider_profile_primary:3",
		output_schema_id: "primary_agent_terminal_output.v1",
		branch_identity: {
			schema_version: "answer_branch_identity.v1",
			prompt_id: "primary_agent",
			branch_kind: "tool_routed",
			workflow_mode: "single_step",
		},
		terminal_outcome: "grounded_answer",
		selected_tool: "transport_schedule_lookup",
		selected_tools: ["transport_schedule_lookup"],
		stage_timing_profile_sha256:
			"sha256:1414141414141414141414141414141414141414141414141414141414141414",
		tool_runtime_combined_sha256:
			"sha256:1515151515151515151515151515151515151515151515151515151515151515",
		...overrides,
	};
}

describe("execution finalization canonical response fixtures", () => {
	it("parses resolved scope and typed session updates from finalization", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.resolved_scope = "curriculum";
		payload.session_update = {
			upsert_slots: [
				{
					confirmed: true,
					name: "curriculum_program",
					value: "历史学强基计划",
				},
			],
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			resolvedScope: "curriculum",
			sessionUpdate: {
				upsertSlots: [
					{
						confirmed: true,
						name: "curriculum_program",
						value: "历史学强基计划",
					},
				],
			},
		});
	});

	it("parses canonical terminal state fixtures", () => {
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_completed_delegate.valid.json"),
			),
		).toMatchObject({
			selectedTool: "knowledge_query",
			status: "completed",
			traceId: "trace-contract-completed",
			workflowTraceSummary: {
				directVsDelegateBranch: "tool",
				firstDecisionActor: "primary_agent",
				selectedTool: "knowledge_query",
				selectedTools: ["knowledge_query"],
				terminalReason: "answer",
			},
		});
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_temporal_finalization.valid.json"),
			),
		).toMatchObject({
			answerText: "示例奖学金按照现行评审办法执行。",
			error: null,
			selectedTool: "knowledge_query",
			status: "completed",
			traceId: "trace-temporal-finalization",
			workflowTraceSummary: {
				selectedTool: "knowledge_query",
				selectedTools: ["knowledge_query"],
			},
		});
		expect(
			parseExecutionFinalizationResponsePayload(
				loadFixture("response_cancelled_null_target.valid.json"),
			),
		).toMatchObject({
			error: {
				code: "execution_cancelled",
				retryable: false,
			},
			selectedTool: null,
			status: "cancelled",
			traceId: "trace-contract-cancelled",
		});
		expect(
			parseExecutionFinalizationResponsePayload(loadFixture("response_timeout.valid.json")),
		).toMatchObject({
			error: {
				code: "execution_timeout",
				retryable: true,
			},
			selectedTool: null,
			status: "error",
		});
	});

	it("rejects non-canonical response fixtures instead of accepting camelCase fallback", () => {
		for (const fixtureName of [
			"response_camel_case.invalid.json",
			"response_extra_field.invalid.json",
		]) {
			expect(() => parseExecutionFinalizationResponsePayload(loadFixture(fixtureName))).toThrow(
				/execution finalization response contract/i,
			);
		}
	});

	it("rejects retired custom observability projections", () => {
		for (const retiredField of [
			"prompt_trace",
			"replay_packet_ref",
			"semantic_outcome",
			"usage_summary",
		]) {
			const payload = loadFixture("response_temporal_finalization.valid.json");
			payload.observability = {
				...(payload.observability as Record<string, unknown>),
				[retiredField]: {},
			};

			expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
				new RegExp(`observability\\.${retiredField} is not allowed`, "i"),
			);
		}
	});

	it("parses safe llm io fingerprint from finalization observability", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			llm_io_fingerprint: llmIoFingerprintFixture({
				model: "gpt-4.1",
				outputSchemaId: "primary_agent_terminal_output.v1",
				promptId: "primary_agent_direct_answer",
				promptVariablesSchemaVersion: "final_model_context.v1",
				providerProfileRevision: "primary_agent:provider_profile_primary:3",
			}),
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			observability: {
				llmIoFingerprint: {
					schemaVersion: "llm_io_fingerprint.v1",
					runId: "run_temporal_finalization",
					requestId: "req_temporal_finalization",
					traceId: "trace-temporal-finalization",
					provider: "openai",
					model: "gpt-4.1",
					promptId: "primary_agent_direct_answer",
					toolRuntimeFingerprint: {
						schemaVersion: "tool_runtime_fingerprint.v1",
						toolsSchemaVersion: "tool-registry-v4",
					},
				},
			},
		});
	});

	it("parses answer eval fingerprint from safe finalization observability", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			answer_eval_fingerprint: answerEvalFingerprintFixture(),
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			observability: {
				answerEvalFingerprint: {
					branchIdentity: {
						branchKind: "tool_routed",
						promptId: "primary_agent",
						workflowMode: "single_step",
					},
					llmCallSite: "agent.primary",
					requestId: "req_temporal_finalization",
					runId: "run_temporal_finalization",
					selectedTool: "transport_schedule_lookup",
					selectedTools: ["transport_schedule_lookup"],
					terminalOutcome: "grounded_answer",
				},
			},
		});
	});

	it("rejects answer eval fingerprint raw answer leakage", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			answer_eval_fingerprint: answerEvalFingerprintFixture({
				raw_answer: "学生应按规定办理请假手续。",
			}),
		};

		expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
			/execution finalization response contract/i,
		);
	});

	it("rejects replay packet ref inside answer eval fingerprint", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			answer_eval_fingerprint: answerEvalFingerprintFixture({
				replay_packet_ref: {
					packet_id: "llm_replay_packet_01",
					object_ref: "s3://llm-replay/packet.json",
					object_checksum_sha256:
						"sha256:4444444444444444444444444444444444444444444444444444444444444444",
				},
			}),
		};

		expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
			/execution finalization response contract/i,
		);
	});

	it("rejects safe llm io fingerprint without nested tool runtime fingerprint", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		const fingerprint = llmIoFingerprintFixture({
			model: "gpt-4.1",
			outputSchemaId: "primary_agent_terminal_output.v1",
			promptId: "primary_agent_direct_answer",
			promptVariablesSchemaVersion: "final_model_context.v1",
			providerProfileRevision: "primary_agent:provider_profile_primary:3",
		});
		delete fingerprint.tool_runtime_fingerprint;
		payload.observability = {
			...(payload.observability as Record<string, unknown>),
			llm_io_fingerprint: fingerprint,
		};

		expect(() => parseExecutionFinalizationResponsePayload(payload)).toThrow(
			/tool_runtime_fingerprint/i,
		);
	});

	it("parses controlled debug trace refs and stage timing without raw trace bodies", () => {
		const payload = loadFixture("response_temporal_finalization.valid.json");
		payload.debug_trace_refs = [
			{
				sink: "langfuse_otlp",
				trace_id: "trace-temporal-finalization",
				trace_ref: "langfuse://trace-temporal-finalization",
				url: "https://langfuse.example/project/demo/traces/trace-temporal-finalization",
			},
		];
		payload.stage_timing = {
			"agent.runtime_ms": 321,
			"agent.first_delta_ms": 120,
		};

		expect(parseExecutionFinalizationResponsePayload(payload)).toMatchObject({
			debugTraceRefs: [
				{
					sink: "langfuse_otlp",
					traceId: "trace-temporal-finalization",
					traceRef: "langfuse://trace-temporal-finalization",
					url: "https://langfuse.example/project/demo/traces/trace-temporal-finalization",
				},
			],
			stageTiming: {
				"agent.runtime_ms": 321,
				"agent.first_delta_ms": 120,
			},
		});
	});

	it("rejects non-canonical debug trace refs and stage timing fields", () => {
		const invalidStageTiming = loadFixture("response_temporal_finalization.valid.json");
		invalidStageTiming.stage_timing = {
			agent_runtime_duration_ms: 321,
		};
		expect(() => parseExecutionFinalizationResponsePayload(invalidStageTiming)).toThrow(
			/execution finalization response contract/i,
		);

		const invalidDebugTraceRef = loadFixture("response_temporal_finalization.valid.json");
		invalidDebugTraceRef.debug_trace_refs = [
			{
				sink: "raw_sdk_trace",
				trace_ref: "trace://raw-sdk",
			},
		];
		expect(() => parseExecutionFinalizationResponsePayload(invalidDebugTraceRef)).toThrow(
			/execution finalization response contract/i,
		);
	});
});
