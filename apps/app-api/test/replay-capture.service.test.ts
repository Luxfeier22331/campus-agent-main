// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	buildReplayCaptureService,
	type ReplayPacketAccessKind,
} from "../src/modules/replay-capture";
import {
	refreshReplayPacketIndexSelfHashes,
	replayCaptureStoreMock,
	replayPacketIndexPayload,
	replayPacketIndexRead,
	toolRuntimeFingerprint,
} from "./replay-capture.test-support";

type ReplayPacketReadAccessKind = Exclude<ReplayPacketAccessKind, "delete">;

describe("replay capture service", () => {
	it("ingests safe replay packet index metadata", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });

		await expect(
			service.ingestReplayPacketIndex({ payload: replayPacketIndexPayload() }),
		).resolves.toEqual({
			accepted: 1,
			packetId: "llm_replay_packet_rag_01",
		});
		expect(store.upsertReplayPacketIndex).toHaveBeenCalledWith(
			expect.objectContaining({
				answerEvalFingerprint: expect.objectContaining({
					schemaVersion: "answer_eval_fingerprint.v1",
					terminalOutcome: "grounded_answer",
				}),
				encryptionKeyRef: "kms:local-dev-replay",
				llmIoFingerprint: expect.objectContaining({
					llmCallSite: "rag.synthesis",
					modelParamsProjection: expect.objectContaining({
						paramsSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
						projectedParams: expect.objectContaining({
							reasoningEffort: "medium",
							responseFormat: "json_schema",
							toolChoice: "none",
						}),
					}),
					primaryAttestation: expect.objectContaining({
						attestationKind: "primary_admitted_rag_synthesis",
					}),
					promptRegistryAttestation: expect.objectContaining({
						promptId: "rag_synthesis_answer",
					}),
					providerRequestSafeHash: expect.objectContaining({
						redactionPolicy: "llm_provider_request_safe_projection.v1",
					}),
					toolRuntimeAttestation: expect.objectContaining({
						configRefs: [
							"configs/runtime/tools.v4.json",
							"configs/runtime/tool-function-schemas.v1.json",
							"configs/runtime/workflow-artifacts.v2.json",
						],
					}),
				}),
				objectChecksumSha256:
					"sha256:4444444444444444444444444444444444444444444444444444444444444444",
				packetId: "llm_replay_packet_rag_01",
				requestId: "req_rag_01",
				sinkIdentityProjection: expect.objectContaining({
					pseudonymizationPolicy: "pseudonymous_refs_v1",
					requestRef: "request:33333333333333333333333333333333",
				}),
			}),
		);
	});

	it("rejects replay packet index metadata when answer fingerprint identity drifts", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.answer_eval_fingerprint as Record<string, unknown>).request_id = "req_other";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/request_id must match answer_eval_fingerprint/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when answer fingerprint points at another llm io hash", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.answer_eval_fingerprint as Record<string, unknown>).llm_io_fingerprint_sha256 =
			"sha256:babababababababababababababababababababababababababababababababa";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/llm_io_fingerprint_sha256 must match answer_eval_fingerprint/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when answer fingerprint self hash drifts", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.answer_eval_fingerprint as Record<string, unknown>).answer_fingerprint_sha256 =
			"sha256:bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/answer_fingerprint_sha256 must match answer_eval_fingerprint/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when sink projection self hash drifts", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.sink_identity_projection as Record<string, unknown>).projection_sha256 =
			"sha256:dadadadadadadadadadadadadadadadadadadadadadadadadadadadadadadada";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/projection_sha256 must match sink_identity_projection/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when answer evidence replay hash drifts", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.answer_eval_fingerprint as Record<string, unknown>).evidence_replay_index_sha256 =
			"sha256:ecececececececececececececececececececececececececececececececec";
		refreshReplayPacketIndexSelfHashes(payload);

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/evidence_replay_index_sha256 must match evidence_replay_index/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects rag synthesis replay packet index without answer evidence replay hash", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.answer_eval_fingerprint as Record<string, unknown>).evidence_replay_index_sha256 =
			null;
		refreshReplayPacketIndexSelfHashes(payload);

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/evidence_replay_index_sha256 is required/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects rag synthesis replay packet index without answer eval fingerprint", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const { answer_eval_fingerprint: _removed, ...payload } = replayPacketIndexPayload();

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/answer_eval_fingerprint is required/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects rag synthesis replay packet index without sink identity projection", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const { sink_identity_projection: _removed, ...payload } = replayPacketIndexPayload();

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/sink_identity_projection is required/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata with direct sink identity", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(payload.sink_identity_projection as Record<string, unknown>).subject_ref =
			"user:jane@example.edu.cn";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/sink_identity_projection.subject_ref/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects raw replay packet sections from the safe index route", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = {
			...replayPacketIndexPayload(),
			provider_request_body: {
				model: "gpt-5-mini",
			},
		};

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/provider_request_body is forbidden/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it.each([
		"raw_answer",
		"provider_response_body",
		"memory_payload",
		"tool_arguments",
		"secret",
	])("recursively rejects forbidden raw key %s from strict fingerprint metadata", async (key) => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		(
			payload.llm_io_fingerprint.model_params_projection as Record<string, unknown>
		).safe_nested_projection = {
			[key]: "must not be stored",
		};

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			new RegExp(`${key} is forbidden`, "i"),
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata with non-admitted capture policy", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		payload.capture_policy.audit_required = false;

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/requires audit and deletion linkage/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it.each([
		["operator_principal", "approval_ref"],
		["approval_ref", "operator_principal"],
	])("rejects replay packet index metadata with non-off policy missing %s", async (missingField, presentField) => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		delete payload.capture_policy[missingField];
		payload.capture_policy[presentField] =
			presentField === "operator_principal" ? "operator:user_01" : "approval_rag_01";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/capture_policy requires operator_principal and approval_ref/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when fingerprint identity drifts", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		payload.llm_io_fingerprint.request_id = "req_other";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/request_id must match llm_io_fingerprint/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when ttl_days and expires_at drift", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		payload.expires_at = "2026-07-30T00:00:00.000Z";
		(payload.retention as Record<string, unknown>).expires_at = "2026-07-30T00:00:00.000Z";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/expires_at must equal created_at plus ttl_days/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata without nested tool runtime fingerprint", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		const { tool_runtime_fingerprint: _removed, ...fingerprintWithoutToolRuntime } =
			payload.llm_io_fingerprint;
		payload.llm_io_fingerprint = fingerprintWithoutToolRuntime;

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/tool_runtime_fingerprint/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects replay packet index metadata when flat and nested tool hashes drift", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = replayPacketIndexPayload();
		toolRuntimeFingerprint(payload).tools_sha256 =
			"sha256:9999999999999999999999999999999999999999999999999999999999999999";

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/tool_catalog_sha256/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it("rejects malformed optional replay packet index metadata", async () => {
		const store = replayCaptureStoreMock({
			upsertReplayPacketIndex: vi.fn().mockResolvedValue(undefined),
		});
		const service = buildReplayCaptureService({ store });
		const payload = {
			...replayPacketIndexPayload(),
			approval_ref: null,
		};

		await expect(service.ingestReplayPacketIndex({ payload })).rejects.toThrow(
			/approval_ref must be a non-empty string when present/i,
		);
		expect(store.upsertReplayPacketIndex).not.toHaveBeenCalled();
	});

	it.each<ReplayPacketReadAccessKind>([
		"read",
		"export",
		"replay",
	])("returns safe replay packet metadata, updates last access, and audits %s access", async (accessKind) => {
		const now = new Date("2026-07-06T00:00:00.000Z");
		const row = replayPacketIndexRead();
		const store = replayCaptureStoreMock({
			getReplayPacketIndexById: vi.fn().mockResolvedValue(row),
			insertReplayPacketAccessAudit: vi.fn().mockResolvedValue(undefined),
			markReplayPacketsDeletedByLinkage: vi.fn(),
			touchReplayPacketLastAccessedAt: vi.fn().mockResolvedValue(undefined),
			upsertReplayPacketIndex: vi.fn(),
		});
		const service = buildReplayCaptureService({
			generateId: () => "access_01",
			now: () => now,
			store,
		});

		await expect(
			service.getReplayPacketIndex({
				accessKind,
				actorPrincipal: "operator:user_01",
				approvalRef: "approval_rag_01",
				packetId: "llm_replay_packet_rag_01",
				purpose: "badcase_diagnosis",
			}),
		).resolves.toEqual({
			packet: expect.objectContaining({
				objectRef: row.objectRef,
				packetId: row.packetId,
			}),
		});
		expect(store.touchReplayPacketLastAccessedAt).toHaveBeenCalledWith({
			accessedAt: "2026-07-06T00:00:00.000Z",
			packetId: "llm_replay_packet_rag_01",
		});
		expect(store.insertReplayPacketAccessAudit).toHaveBeenCalledWith({
			accessId: "access_01",
			accessKind,
			actorPrincipal: "operator:user_01",
			packetId: "llm_replay_packet_rag_01",
			purpose: "badcase_diagnosis",
			requestId: "req_rag_01",
			traceId: "trace_rag_01",
			occurredAt: "2026-07-06T00:00:00.000Z",
		});
	});

	it("rejects replay packet export without the matching approval reference", async () => {
		const store = replayCaptureStoreMock({
			getReplayPacketIndexById: vi.fn().mockResolvedValue(replayPacketIndexRead()),
			insertReplayPacketAccessAudit: vi.fn(),
			touchReplayPacketLastAccessedAt: vi.fn(),
		});
		const service = buildReplayCaptureService({
			now: () => new Date("2026-07-06T00:00:00.000Z"),
			store,
		});

		await expect(
			service.getReplayPacketIndex({
				accessKind: "export",
				actorPrincipal: "operator:user_01",
				packetId: "llm_replay_packet_rag_01",
				purpose: "badcase_diagnosis",
			}),
		).rejects.toThrow(/approval/i);
		expect(store.touchReplayPacketLastAccessedAt).not.toHaveBeenCalled();
		expect(store.insertReplayPacketAccessAudit).not.toHaveBeenCalled();
	});

	it("rejects replay packet access from a different operator principal", async () => {
		const store = replayCaptureStoreMock({
			getReplayPacketIndexById: vi.fn().mockResolvedValue(replayPacketIndexRead()),
			insertReplayPacketAccessAudit: vi.fn(),
			touchReplayPacketLastAccessedAt: vi.fn(),
		});
		const service = buildReplayCaptureService({
			now: () => new Date("2026-07-06T00:00:00.000Z"),
			store,
		});

		await expect(
			service.getReplayPacketIndex({
				accessKind: "read",
				actorPrincipal: "operator:other",
				approvalRef: "approval_rag_01",
				packetId: "llm_replay_packet_rag_01",
				purpose: "badcase_diagnosis",
			}),
		).rejects.toThrow(/operator principal/i);
		expect(store.touchReplayPacketLastAccessedAt).not.toHaveBeenCalled();
		expect(store.insertReplayPacketAccessAudit).not.toHaveBeenCalled();
	});

	it("rejects expired replay packet access before updating last_accessed_at", async () => {
		const store = replayCaptureStoreMock({
			getReplayPacketIndexById: vi.fn().mockResolvedValue(
				replayPacketIndexRead({
					expiresAt: "2026-07-05T23:59:59.000Z",
				}),
			),
			insertReplayPacketAccessAudit: vi.fn(),
			markReplayPacketsDeletedByLinkage: vi.fn(),
			touchReplayPacketLastAccessedAt: vi.fn(),
			upsertReplayPacketIndex: vi.fn(),
		});
		const service = buildReplayCaptureService({
			now: () => new Date("2026-07-06T00:00:00.000Z"),
			store,
		});

		await expect(
			service.getReplayPacketIndex({
				accessKind: "read",
				actorPrincipal: "operator:user_01",
				packetId: "llm_replay_packet_rag_01",
				purpose: "badcase_diagnosis",
			}),
		).rejects.toThrow(/expired/i);
		expect(store.touchReplayPacketLastAccessedAt).not.toHaveBeenCalled();
		expect(store.insertReplayPacketAccessAudit).not.toHaveBeenCalled();
	});

	it("marks replay packets deleted by DSAR linkage and writes delete audit events", async () => {
		const now = new Date("2026-07-06T00:00:00.000Z");
		const rows = [
			replayPacketIndexRead(),
			replayPacketIndexRead({
				packetId: "llm_replay_packet_rag_02",
				requestId: "req_rag_02",
			}),
		];
		const store = replayCaptureStoreMock({
			getReplayPacketIndexById: vi.fn(),
			insertReplayPacketAccessAudit: vi.fn().mockResolvedValue(undefined),
			listReplayPacketsByLinkage: vi.fn().mockResolvedValue(rows),
			markReplayPacketsDeletedByLinkage: vi.fn().mockResolvedValue(rows),
			touchReplayPacketLastAccessedAt: vi.fn(),
			upsertReplayPacketIndex: vi.fn(),
		});
		const service = buildReplayCaptureService({
			generateId: (prefix) => `${prefix}_audit`,
			now: () => now,
			store,
		});

		await expect(
			service.deleteReplayPacketsByLinkage({
				actorPrincipal: "privacy-ops:user_01",
				approvalRef: "approval_rag_01",
				mode: "mark_deleted",
				purpose: "dsar_delete",
				requestId: "req_rag_01",
				subjectRef: "user_hash_01",
			}),
		).resolves.toEqual({
			deletedPacketIds: ["llm_replay_packet_rag_01", "llm_replay_packet_rag_02"],
			matchedCount: 2,
			mode: "mark_deleted",
		});
		expect(store.listReplayPacketsByLinkage).toHaveBeenCalledWith({
			linkage: {
				requestId: "req_rag_01",
				subjectRef: "user_hash_01",
			},
		});
		expect(store.insertReplayPacketAccessAudit).toHaveBeenCalledTimes(2);
		expect(store.insertReplayPacketAccessAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				accessKind: "delete",
				packetId: "llm_replay_packet_rag_01",
				purpose: "dsar_delete",
			}),
		);
		expect(store.markReplayPacketsDeletedByLinkage).toHaveBeenCalledWith({
			deletionMarker: {
				actorPrincipal: "privacy-ops:user_01",
				deletedAt: "2026-07-06T00:00:00.000Z",
				purpose: "dsar_delete",
			},
			linkage: {
				requestId: "req_rag_01",
				subjectRef: "user_hash_01",
			},
		});
	});

	it("does not mark replay packet metadata when delete audit write fails", async () => {
		const rows = [replayPacketIndexRead()];
		const store = replayCaptureStoreMock({
			insertReplayPacketAccessAudit: vi.fn().mockRejectedValue(new Error("audit failed")),
			listReplayPacketsByLinkage: vi.fn().mockResolvedValue(rows),
			markReplayPacketsDeletedByLinkage: vi.fn(),
		});
		const service = buildReplayCaptureService({
			now: () => new Date("2026-07-06T00:00:00.000Z"),
			store,
		});

		await expect(
			service.deleteReplayPacketsByLinkage({
				actorPrincipal: "privacy-ops:user_01",
				approvalRef: "approval_rag_01",
				mode: "mark_deleted",
				purpose: "dsar_delete",
				subjectRef: "user_hash_01",
			}),
		).rejects.toThrow(/audit failed/i);
		expect(store.markReplayPacketsDeletedByLinkage).not.toHaveBeenCalled();
	});
});
