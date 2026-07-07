import { index, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type {
	ToolExecutionAnswerEvalFingerprint,
	ToolExecutionLlmIoFingerprint,
} from "../../modules/integration/tool-execution-types";
import type { RawCapturePolicy } from "../../modules/observability-config";
import type {
	EvidenceReplayIndex,
	ReplayPacketAccessAuditPolicy,
	ReplayPacketRetention,
	SinkIdentityProjection,
} from "../../modules/replay-capture/types";

const observability = pgSchema("observability");

export interface ReplayPacketDeletionLinkage {
	conversation_id: string;
	evidence_ref_count?: number;
	memory_ref_count?: number;
	request_id: string;
	subject_ref: string;
	trace_id: string;
}

export interface ReplayPacketDeletionMarker {
	actorPrincipal: string;
	deletedAt: string;
	purpose: string;
}

export const replayPacketIndex = observability.table(
	"replay_packet_index",
	{
		packetId: text("packet_id").primaryKey(),
		runId: text("run_id").notNull(),
		requestId: text("request_id").notNull(),
		traceId: text("trace_id").notNull(),
		objectRef: text("object_ref").notNull(),
		objectChecksumSha256: text("object_checksum_sha256").notNull(),
		sensitivityClassification: text("sensitivity_classification").notNull(),
		capturePolicyJson: jsonb("capture_policy_json").$type<RawCapturePolicy>().notNull(),
		llmIoFingerprintJson: jsonb("llm_io_fingerprint_json")
			.$type<ToolExecutionLlmIoFingerprint>()
			.notNull(),
		answerEvalFingerprintJson: jsonb(
			"answer_eval_fingerprint_json",
		).$type<ToolExecutionAnswerEvalFingerprint | null>(),
		deletionLinkageJson: jsonb("deletion_linkage_json")
			.$type<ReplayPacketDeletionLinkage>()
			.notNull(),
		retentionJson: jsonb("retention_json").$type<ReplayPacketRetention>().notNull(),
		accessAuditJson: jsonb("access_audit_json").$type<ReplayPacketAccessAuditPolicy>().notNull(),
		evidenceReplayIndexJson: jsonb("evidence_replay_index_json")
			.$type<EvidenceReplayIndex>()
			.notNull(),
		sinkIdentityProjectionJson: jsonb(
			"sink_identity_projection_json",
		).$type<SinkIdentityProjection | null>(),
		encryptionKeyRef: text("encryption_key_ref").notNull(),
		approvalRef: text("approval_ref"),
		operatorPrincipal: text("operator_principal"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		deletionMarkerJson: jsonb("deletion_marker_json").$type<ReplayPacketDeletionMarker | null>(),
	},
	(table) => ({
		requestIdIndex: index("observability_replay_packet_request_id_idx").on(table.requestId),
		runIdIndex: index("observability_replay_packet_run_id_idx").on(table.runId),
		traceIdIndex: index("observability_replay_packet_trace_id_idx").on(table.traceId),
		expiresAtIndex: index("observability_replay_packet_expires_at_idx").on(table.expiresAt),
	}),
);

export const replayPacketAccessAudit = observability.table(
	"replay_packet_access_audit",
	{
		accessId: text("access_id").primaryKey(),
		packetId: text("packet_id").notNull(),
		requestId: text("request_id").notNull(),
		traceId: text("trace_id").notNull(),
		accessKind: text("access_kind").notNull(),
		actorPrincipal: text("actor_principal").notNull(),
		purpose: text("purpose").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
	},
	(table) => ({
		actorOccurredAtIndex: index("observability_replay_packet_access_actor_occurred_idx").on(
			table.actorPrincipal,
			table.occurredAt,
		),
		packetOccurredAtIndex: index("observability_replay_packet_access_packet_occurred_idx").on(
			table.packetId,
			table.occurredAt,
		),
		requestOccurredAtIndex: index("observability_replay_packet_access_request_occurred_idx").on(
			table.requestId,
			table.occurredAt,
		),
	}),
);
