// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRuntimeDatabase, createRuntimeDbGetter } = vi.hoisted(() => ({
	createRuntimeDatabase: vi.fn(),
	createRuntimeDbGetter: vi.fn(() => () => createRuntimeDatabase()),
}));

vi.mock("../src/db/runtime", () => ({
	createRuntimeDatabase,
	createRuntimeDbGetter,
}));

import { replayPacketIndex } from "../src/db/schema";
import { replayPacketAccessAudit } from "../src/db/schema/replay-capture";
import type {
	ReplayPacketAccessAuditWrite,
	ReplayPacketIndexWrite,
} from "../src/modules/replay-capture";
import { createPgReplayCaptureStore } from "../src/modules/replay-capture";

describe("pg replay capture store", () => {
	beforeEach(() => {
		createRuntimeDatabase.mockReset();
		createRuntimeDbGetter.mockClear();
		createRuntimeDbGetter.mockImplementation(() => () => createRuntimeDatabase());
	});

	it("upserts replay packet index rows into observability schema", async () => {
		const onConflictDoUpdate = vi.fn();
		const values = vi.fn(() => ({ onConflictDoUpdate }));
		const insert = vi.fn(() => ({ values }));
		createRuntimeDatabase.mockResolvedValue({ insert });

		const store = createPgReplayCaptureStore({} as never);
		await store.upsertReplayPacketIndex(replayPacketIndexWrite());

		expect(insert).toHaveBeenCalledWith(replayPacketIndex);
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				answerEvalFingerprintJson: expect.objectContaining({
					schemaVersion: "answer_eval_fingerprint.v1",
					terminalOutcome: "grounded_answer",
				}),
				encryptionKeyRef: "kms:local-dev-replay",
				objectChecksumSha256:
					"sha256:4444444444444444444444444444444444444444444444444444444444444444",
				packetId: "llm_replay_packet_rag_01",
				requestId: "req_rag_01",
				sinkIdentityProjectionJson: expect.objectContaining({
					pseudonymizationPolicy: "pseudonymous_refs_v1",
					requestRef: "request:33333333333333333333333333333333",
				}),
			}),
		);
		expect(onConflictDoUpdate).toHaveBeenCalledWith({
			set: expect.objectContaining({
				answerEvalFingerprintJson: expect.objectContaining({
					toolRuntimeCombinedSha256:
						"sha256:9999999999999999999999999999999999999999999999999999999999999999",
				}),
				objectRef: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
				sinkIdentityProjectionJson: expect.objectContaining({
					traceRef: "trace:44444444444444444444444444444444",
				}),
			}),
			target: replayPacketIndex.packetId,
		});
	});

	it("reads replay packet index safe metadata by packet id", async () => {
		const limit = vi.fn().mockResolvedValue([replayPacketIndexRow()]);
		const where = vi.fn(() => ({ limit }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		createRuntimeDatabase.mockResolvedValue({ select });

		const store = createPgReplayCaptureStore({} as never);
		await expect(store.getReplayPacketIndexById("llm_replay_packet_rag_01")).resolves.toEqual(
			expect.objectContaining({
				answerEvalFingerprint: expect.objectContaining({
					schemaVersion: "answer_eval_fingerprint.v1",
					terminalOutcome: "grounded_answer",
				}),
				objectRef: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
				packetId: "llm_replay_packet_rag_01",
				requestId: "req_rag_01",
				sinkIdentityProjection: expect.objectContaining({
					requestRef: "request:33333333333333333333333333333333",
				}),
			}),
		);

		expect(select).toHaveBeenCalled();
		expect(from).toHaveBeenCalledWith(replayPacketIndex);
		expect(where).toHaveBeenCalled();
		expect(limit).toHaveBeenCalledWith(1);
	});

	it("updates last_accessed_at on replay packet index rows", async () => {
		const where = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where }));
		const update = vi.fn(() => ({ set }));
		createRuntimeDatabase.mockResolvedValue({ update });

		const store = createPgReplayCaptureStore({} as never);
		await store.touchReplayPacketLastAccessedAt({
			accessedAt: "2026-07-06T00:00:00.000Z",
			packetId: "llm_replay_packet_rag_01",
		});

		expect(update).toHaveBeenCalledWith(replayPacketIndex);
		expect(set).toHaveBeenCalledWith({
			lastAccessedAt: new Date("2026-07-06T00:00:00.000Z"),
		});
		expect(where).toHaveBeenCalled();
	});

	it("inserts replay packet access audit rows", async () => {
		const values = vi.fn().mockResolvedValue(undefined);
		const insert = vi.fn(() => ({ values }));
		createRuntimeDatabase.mockResolvedValue({ insert });

		const store = createPgReplayCaptureStore({} as never);
		await store.insertReplayPacketAccessAudit(replayPacketAccessAuditWrite());

		expect(insert).toHaveBeenCalledWith(replayPacketAccessAudit);
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				accessId: "access_01",
				accessKind: "read",
				actorPrincipal: "operator:user_01",
				packetId: "llm_replay_packet_rag_01",
			}),
		);
	});

	it("marks replay packet index rows deleted by DSAR linkage without deleting metadata", async () => {
		const selectedRows = [replayPacketIndexRow()];
		const selectWhere = vi.fn().mockResolvedValue(selectedRows);
		const selectFrom = vi.fn(() => ({ where: selectWhere }));
		const select = vi.fn(() => ({ from: selectFrom }));
		const updateWhere = vi.fn().mockResolvedValue(undefined);
		const set = vi.fn(() => ({ where: updateWhere }));
		const update = vi.fn(() => ({ set }));
		createRuntimeDatabase.mockResolvedValue({
			select,
			update,
		});

		const store = createPgReplayCaptureStore({} as never);
		await expect(
			store.markReplayPacketsDeletedByLinkage({
				deletionMarker: {
					actorPrincipal: "privacy-ops:user_01",
					deletedAt: "2026-07-06T00:00:00.000Z",
					purpose: "dsar_delete",
				},
				linkage: {
					traceId: "trace_rag_01",
				},
			}),
		).resolves.toEqual([
			expect.objectContaining({
				packetId: "llm_replay_packet_rag_01",
			}),
		]);

		expect(update).toHaveBeenCalledWith(replayPacketIndex);
		expect(set).toHaveBeenCalledWith({
			deletedAt: new Date("2026-07-06T00:00:00.000Z"),
			deletionMarkerJson: {
				actorPrincipal: "privacy-ops:user_01",
				deletedAt: "2026-07-06T00:00:00.000Z",
				purpose: "dsar_delete",
			},
		});
		expect(updateWhere).toHaveBeenCalled();
	});
});

function replayPacketIndexWrite(): ReplayPacketIndexWrite {
	return {
		accessAudit: {
			schema_version: "replay_access_audit.v1",
			audit_required: true,
			audit_log_ref: "audit://replay/llm_replay_packet_rag_01",
			access_policy_ref: "rbac://replay/restricted-operator-eval",
			last_accessed_at: null,
		},
		answerEvalFingerprint: {
			answerFingerprintSha256:
				"sha256:abababababababababababababababababababababababababababababababab",
			branchIdentity: {
				branchKind: "rag_synthesis",
				promptId: "primary_agent",
				schemaVersion: "answer_branch_identity.v1",
				workflowMode: "single_step",
			},
			evidenceReplayIndexSha256:
				"sha256:dcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdc",
			llmCallSite: "rag.synthesis",
			llmIoFingerprintSha256:
				"sha256:babababababababababababababababababababababababababababababababa",
			outputSchemaId: "rag_answer_v2",
			providerProfileRevision: "rag_synthesis:provider_profile_rag:4",
			requestId: "req_rag_01",
			runId: "run_rag_01",
			runtimeRelease: "execution-control@test",
			schemaVersion: "answer_eval_fingerprint.v1",
			selectedTool: "knowledge_query",
			selectedTools: ["knowledge_query"],
			stageTimingProfileSha256:
				"sha256:cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd",
			terminalOutcome: "grounded_answer",
			toolRuntimeCombinedSha256:
				"sha256:9999999999999999999999999999999999999999999999999999999999999999",
			traceId: "trace_rag_01",
		},
		approvalRef: "approval_rag_01",
		capturePolicy: {
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
		createdAt: "2026-07-05T00:00:00Z",
		deletionLinkage: {
			conversation_id: "conv_rag_01",
			evidence_ref_count: 1,
			memory_ref_count: 0,
			request_id: "req_rag_01",
			subject_ref: "user_hash_01",
			trace_id: "trace_rag_01",
		},
		encryptionKeyRef: "kms:local-dev-replay",
		evidenceReplayIndex: {
			schema_version: "evidence_replay_index.v1",
			evidence_packet_sha256:
				"sha256:3333333333333333333333333333333333333333333333333333333333333333",
			evidence_profile_ref: "rag_evidence_profile.v1",
			evidence_ref_count: 1,
			evidence_refs: [
				{
					evidence_ref: "evidence:rag:01",
					evidence_sha256:
						"sha256:1212121212121212121212121212121212121212121212121212121212121212",
					source_profile_ref: "source_profile:regulations:v1",
				},
			],
		},
		expiresAt: "2026-07-12T00:00:00Z",
		llmIoFingerprint: {
			contextEnvelopeSha256:
				"sha256:1111111111111111111111111111111111111111111111111111111111111111",
			evidencePacketSha256:
				"sha256:3333333333333333333333333333333333333333333333333333333333333333",
			llmCallSite: "rag.synthesis",
			memorySelectionSha256:
				"sha256:2222222222222222222222222222222222222222222222222222222222222222",
			model: "gpt-5-mini",
			modelParamsHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			modelParamsProjection: {
				paramsSchemaVersion: "openai.responses.safe_params.v1",
				paramsSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				projectedParams: {
					maxOutputTokens: 1200,
					reasoningEffort: "medium",
					responseFormat: "json_schema",
					temperature: 0.2,
					toolChoice: "none",
					topP: 1,
				},
				schemaVersion: "model_params_projection.v1",
			},
			outputSchemaId: "rag_answer_v2",
			primaryAttestation: {
				attestationKind: "primary_admitted_rag_synthesis",
				attestationSha256:
					"sha256:7777777777777777777777777777777777777777777777777777777777777777",
				attestedBy: "execution-control",
				schemaVersion: "primary_attestation.v1",
			},
			promptId: "rag_synthesis_answer",
			promptRegistryAttestation: {
				attestationSha256:
					"sha256:5555555555555555555555555555555555555555555555555555555555555555",
				outputSchemaId: "rag_answer_v2",
				promptId: "rag_synthesis_answer",
				promptRegistryVersion: "2026-07-05",
				promptTemplateSha256:
					"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				promptVariablesSchemaVersion: "rag_synthesis_packet.v1",
				schemaVersion: "prompt_registry_attestation.v1",
			},
			promptTemplateSha256:
				"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			promptVariablesSchemaVersion: "rag_synthesis_packet.v1",
			provider: "openai",
			providerProfileRevision: "rag_synthesis:provider_profile_rag:4",
			providerRequestSafeHash: {
				canonicalization: "canonical_json_redacted_v1",
				redactionPolicy: "llm_provider_request_safe_projection.v1",
				requestSha256: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
				schemaVersion: "provider_request_safe_hash.v1",
			},
			renderedPromptSha256:
				"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			requestId: "req_rag_01",
			runId: "run_rag_01",
			runtimeRelease: "execution-control@test",
			schemaVersion: "llm_io_fingerprint.v1",
			toolCatalogSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
			toolRuntimeAttestation: {
				attestedBy: "execution-control",
				combinedSha256: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
				configRefs: [
					"configs/runtime/tools.v4.json",
					"configs/runtime/tool-function-schemas.v1.json",
					"configs/runtime/workflow-artifacts.v2.json",
				],
				functionSchemaVersion: "tool-function-schemas-v1",
				schemaVersion: "tool_runtime_attestation.v1",
				toolsRegistryVersion: "2026-06-26",
				workflowArtifactRegistryVersion: "2026-05-07",
			},
			toolRuntimeFingerprint: {
				combinedSha256: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
				functionSchemaSha256:
					"sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
				functionSchemaVersion: "tool-function-schemas-v1",
				schemaVersion: "tool_runtime_fingerprint.v1",
				toolsRegistryVersion: "2026-06-26",
				toolsSchemaVersion: "tool-registry-v4",
				toolsSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
				workflowArtifactRegistryVersion: "2026-05-07",
				workflowArtifactSchemaVersion: "workflow-artifact-registry-v2",
				workflowArtifactSha256:
					"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			},
			toolSchemaSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			traceId: "trace_rag_01",
			workflowArtifactSha256:
				"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		},
		objectChecksumSha256: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
		objectRef: "s3://llm-replay/llm-replay-packets/2026/07/05/llm_replay_packet_rag_01.json",
		operatorPrincipal: "operator:user_01",
		packetId: "llm_replay_packet_rag_01",
		requestId: "req_rag_01",
		retention: {
			schema_version: "replay_retention.v1",
			retention_class: "safe_replay_packet_index",
			ttl_days: 7,
			created_at: "2026-07-05T00:00:00.000Z",
			expires_at: "2026-07-12T00:00:00.000Z",
			dsar_delete_linkage_required: true,
			deletion_linkage_ref: "deletion_linkage:llm_replay_packet_rag_01",
		},
		runId: "run_rag_01",
		sensitivityClassification: "restricted_llm_io_with_evidence",
		sinkIdentityProjection: {
			projectionSha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
			pseudonymizationPolicy: "pseudonymous_refs_v1",
			requestRef: "request:33333333333333333333333333333333",
			runRef: "run:22222222222222222222222222222222",
			schemaVersion: "sink_identity_projection.v1",
			subjectRef: "subject:11111111111111111111111111111111",
			traceRef: "trace:44444444444444444444444444444444",
		},
		traceId: "trace_rag_01",
	};
}

function replayPacketAccessAuditWrite(): ReplayPacketAccessAuditWrite {
	return {
		accessId: "access_01",
		accessKind: "read",
		actorPrincipal: "operator:user_01",
		occurredAt: "2026-07-06T00:00:00.000Z",
		packetId: "llm_replay_packet_rag_01",
		purpose: "badcase_diagnosis",
		requestId: "req_rag_01",
		traceId: "trace_rag_01",
	};
}

function replayPacketIndexRow(): typeof replayPacketIndex.$inferSelect {
	const write = replayPacketIndexWrite();
	return {
		accessAuditJson: write.accessAudit,
		approvalRef: write.approvalRef,
		capturePolicyJson: write.capturePolicy,
		createdAt: new Date(write.createdAt),
		deletedAt: null,
		deletionLinkageJson: write.deletionLinkage,
		deletionMarkerJson: null,
		encryptionKeyRef: write.encryptionKeyRef,
		evidenceReplayIndexJson: write.evidenceReplayIndex,
		expiresAt: new Date(write.expiresAt),
		lastAccessedAt: null,
		answerEvalFingerprintJson: write.answerEvalFingerprint,
		llmIoFingerprintJson: write.llmIoFingerprint,
		objectChecksumSha256: write.objectChecksumSha256,
		objectRef: write.objectRef,
		operatorPrincipal: write.operatorPrincipal,
		packetId: write.packetId,
		requestId: write.requestId,
		retentionJson: write.retention,
		runId: write.runId,
		sensitivityClassification: write.sensitivityClassification,
		sinkIdentityProjectionJson: write.sinkIdentityProjection,
		traceId: write.traceId,
	};
}
