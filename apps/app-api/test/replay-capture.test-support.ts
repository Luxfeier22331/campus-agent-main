import { vi } from "vitest";

import {
	llmIoFingerprintSha256,
	sha256JsonRef,
} from "../src/modules/integration/llm-io-fingerprint-hash";
import type { ReplayCaptureStore, ReplayPacketIndexRead } from "../src/modules/replay-capture";
import { normalizeLlmIoFingerprint } from "../src/modules/replay-capture/llm-io-fingerprint-contract";

export type ReplayPacketIndexTestPayload = Record<string, unknown> & {
	capture_policy: Record<string, unknown> & {
		audit_required?: unknown;
	};
	llm_io_fingerprint: Record<string, unknown> & {
		request_id?: unknown;
		tool_runtime_fingerprint?: Record<string, unknown> & {
			tools_sha256?: unknown;
		};
	};
};

export function replayCaptureStoreMock(
	overrides: Partial<ReplayCaptureStore> = {},
): ReplayCaptureStore {
	return {
		getReplayPacketIndexById: vi.fn(),
		insertReplayPacketAccessAudit: vi.fn(),
		listReplayPacketsByLinkage: vi.fn(),
		markReplayPacketsDeletedByLinkage: vi.fn(),
		touchReplayPacketLastAccessedAt: vi.fn(),
		upsertReplayPacketIndex: vi.fn(),
		...overrides,
	};
}

export function replayPacketIndexPayload(): ReplayPacketIndexTestPayload {
	const payload = {
		schema_version: "llm_replay_packet_index.v1",
		packet_id: "llm_replay_packet_rag_01",
		run_id: "run_rag_01",
		request_id: "req_rag_01",
		trace_id: "trace_rag_01",
		object_ref: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
		object_checksum_sha256:
			"sha256:4444444444444444444444444444444444444444444444444444444444444444",
		sensitivity_classification: "restricted_llm_io_with_evidence",
		capture_policy: {
			schema_version: "raw_capture_policy.v1",
			mode: "manual_run_capture",
			capture_reason: "operator_approved_badcase_replay",
			ttl_days: 7,
			allowed_sinks: ["s3_replay_packet"],
			allowed_raw_fields: ["rendered_messages", "selected_evidence_packet"],
			operator_principal: "operator:user_01",
			approval_ref: "approval_rag_01",
			request_id: "req_rag_01",
			run_id: "run_rag_01",
			trace_id: "trace_rag_01",
			audit_required: true,
			dsar_delete_linkage_required: true,
		},
		llm_io_fingerprint: {
			schema_version: "llm_io_fingerprint.v1",
			run_id: "run_rag_01",
			request_id: "req_rag_01",
			trace_id: "trace_rag_01",
			runtime_release: "execution-control@test",
			llm_call_site: "agent.primary",
			provider_profile_revision: "primary_agent:provider_profile_primary:4",
			provider: "openai",
			model: "gpt-5-mini",
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
			prompt_id: "primary_agent",
			prompt_registry_attestation: {
				schema_version: "prompt_registry_attestation.v1",
				prompt_registry_version: "2026-07-05",
				prompt_id: "primary_agent",
				prompt_template_sha256:
					"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				prompt_variables_schema_version: "final_model_context.v1",
				output_schema_id: "primary_agent_terminal_output.v1",
				attestation_sha256:
					"sha256:5555555555555555555555555555555555555555555555555555555555555555",
			},
			prompt_template_sha256:
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			prompt_variables_schema_version: "final_model_context.v1",
			rendered_prompt_sha256:
				"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			provider_request_safe_hash: {
				schema_version: "provider_request_safe_hash.v1",
				canonicalization: "canonical_json_redacted_v1",
				redaction_policy: "llm_provider_request_safe_projection.v1",
				request_sha256: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
			},
			tool_catalog_sha256:
				"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			tool_schema_sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			tool_runtime_fingerprint: {
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
			},
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
			output_schema_id: "primary_agent_terminal_output.v1",
			primary_attestation: {
				schema_version: "primary_attestation.v1",
				attestation_kind: "primary_agent_call",
				attested_by: "apps/agent-runtime",
				attestation_sha256:
					"sha256:7777777777777777777777777777777777777777777777777777777777777777",
			},
		},
		answer_eval_fingerprint: {
			schema_version: "answer_eval_fingerprint.v1",
			answer_fingerprint_sha256:
				"sha256:abababababababababababababababababababababababababababababababab",
			run_id: "run_rag_01",
			request_id: "req_rag_01",
			trace_id: "trace_rag_01",
			runtime_release: "execution-control@test",
			llm_call_site: "agent.primary",
			llm_io_fingerprint_sha256: "",
			provider_profile_revision: "primary_agent:provider_profile_primary:4",
			output_schema_id: "primary_agent_terminal_output.v1",
			branch_identity: {
				schema_version: "answer_branch_identity.v1",
				prompt_id: "primary_agent",
				branch_kind: "tool_routed",
				workflow_mode: "single_step",
			},
			terminal_outcome: "grounded_answer",
			selected_tool: "knowledge_query",
			selected_tools: ["knowledge_query"],
			stage_timing_profile_sha256:
				"sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
			tool_runtime_combined_sha256:
				"sha256:9999999999999999999999999999999999999999999999999999999999999999",
			evidence_replay_index_sha256:
				"sha256:dcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdc",
		},
		sink_identity_projection: {
			schema_version: "sink_identity_projection.v1",
			subject_ref: "subject:11111111111111111111111111111111",
			run_ref: "run:22222222222222222222222222222222",
			request_ref: "request:33333333333333333333333333333333",
			trace_ref: "trace:44444444444444444444444444444444",
			pseudonymization_policy: "pseudonymous_refs_v1",
			projection_sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		},
		deletion_linkage: {
			subject_ref: "user_hash_01",
			conversation_id: "conv_rag_01",
			request_id: "req_rag_01",
			trace_id: "trace_rag_01",
			memory_ref_count: 0,
			evidence_ref_count: 1,
		},
		encryption_key_ref: "kms:local-dev-replay",
		approval_ref: "approval_rag_01",
		operator_principal: "operator:user_01",
		created_at: "2026-07-05T00:00:00Z",
		expires_at: "2026-07-12T00:00:00Z",
		retention: replayRetention(),
		access_audit: replayAccessAudit(),
		evidence_replay_index: evidenceReplayIndex(),
	};
	payload.answer_eval_fingerprint.llm_io_fingerprint_sha256 = llmIoFingerprintSha256(
		normalizeLlmIoFingerprint(payload.llm_io_fingerprint),
	);
	payload.answer_eval_fingerprint.evidence_replay_index_sha256 = sha256JsonRef(
		payload.evidence_replay_index,
	);
	refreshReplayPacketIndexSelfHashes(payload);
	return payload;
}

export function refreshReplayPacketIndexSelfHashes(payload: ReplayPacketIndexTestPayload): void {
	const answer = payload.answer_eval_fingerprint as Record<string, unknown>;
	const { answer_fingerprint_sha256: _answerHash, ...answerBody } = answer;
	answer.answer_fingerprint_sha256 = sha256JsonRef(answerBody);

	const sink = payload.sink_identity_projection as Record<string, unknown>;
	const { projection_sha256: _projectionHash, ...sinkBody } = sink;
	sink.projection_sha256 = sha256JsonRef(sinkBody);
}

function replayRetention() {
	return {
		schema_version: "replay_retention.v1",
		retention_class: "safe_replay_packet_index",
		ttl_days: 7,
		created_at: "2026-07-05T00:00:00.000Z",
		expires_at: "2026-07-12T00:00:00.000Z",
		dsar_delete_linkage_required: true,
		deletion_linkage_ref: "deletion_linkage:llm_replay_packet_rag_01",
	};
}

function replayAccessAudit() {
	return {
		schema_version: "replay_access_audit.v1",
		audit_required: true,
		audit_log_ref: "audit://replay/llm_replay_packet_rag_01",
		access_policy_ref: "rbac://replay/restricted-operator-eval",
		last_accessed_at: null,
	};
}

function evidenceReplayIndex() {
	return {
		schema_version: "evidence_replay_index.v1",
		evidence_packet_sha256:
			"sha256:3333333333333333333333333333333333333333333333333333333333333333",
		evidence_profile_ref: "rag_evidence_profile.v1",
		evidence_ref_count: 1,
		evidence_refs: [
			{
				evidence_ref: "evidence:rag:01",
				evidence_sha256: "sha256:1212121212121212121212121212121212121212121212121212121212121212",
				source_profile_ref: "source_profile:regulations:v1",
			},
		],
	};
}

export function toolRuntimeFingerprint(
	payload: ReplayPacketIndexTestPayload,
): Record<string, unknown> {
	const value = payload.llm_io_fingerprint.tool_runtime_fingerprint;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("test fixture must include tool_runtime_fingerprint");
	}
	return value;
}

export function replayPacketIndexRead(
	overrides: Partial<ReplayPacketIndexRead> = {},
): ReplayPacketIndexRead {
	return {
		accessAudit: replayAccessAudit() as never,
		approvalRef: "approval_rag_01",
		capturePolicy: replayPacketIndexPayload().capture_policy as never,
		createdAt: "2026-07-05T00:00:00.000Z",
		deletedAt: null,
		deletionLinkage: {
			conversation_id: "conv_rag_01",
			evidence_ref_count: 1,
			memory_ref_count: 0,
			request_id: overrides.requestId ?? "req_rag_01",
			subject_ref: "user_hash_01",
			trace_id: overrides.traceId ?? "trace_rag_01",
		},
		deletionMarker: null,
		encryptionKeyRef: "kms:local-dev-replay",
		evidenceReplayIndex: evidenceReplayIndex() as never,
		expiresAt: "2026-07-12T00:00:00.000Z",
		lastAccessedAt: null,
		llmIoFingerprint: replayPacketIndexPayload().llm_io_fingerprint as never,
		answerEvalFingerprint: replayPacketIndexPayload().answer_eval_fingerprint as never,
		objectChecksumSha256: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
		objectRef: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
		operatorPrincipal: "operator:user_01",
		packetId: "llm_replay_packet_rag_01",
		requestId: "req_rag_01",
		retention: replayRetention() as never,
		runId: "run_rag_01",
		sensitivityClassification: "restricted_llm_io_with_evidence",
		sinkIdentityProjection: replayPacketIndexPayload().sink_identity_projection as never,
		traceId: "trace_rag_01",
		...overrides,
	};
}
