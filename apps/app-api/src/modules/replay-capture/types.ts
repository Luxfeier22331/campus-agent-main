import type {
	ToolExecutionAnswerEvalFingerprint,
	ToolExecutionLlmIoFingerprint,
} from "../integration/tool-execution-types";
import type { RawCapturePolicy } from "../observability-config";

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

export interface ReplayPacketRetention {
	created_at: string;
	deletion_linkage_ref: string;
	dsar_delete_linkage_required: true;
	expires_at: string;
	retention_class: "safe_replay_packet_index";
	schema_version: "replay_retention.v1";
	ttl_days: number;
}

export interface ReplayPacketAccessAuditPolicy {
	access_policy_ref: string;
	audit_log_ref: string;
	audit_required: true;
	last_accessed_at?: string | null;
	schema_version: "replay_access_audit.v1";
}

export interface EvidenceReplayRef {
	evidence_ref: string;
	evidence_sha256: string;
	source_profile_ref: string;
}

export interface EvidenceReplayIndex {
	evidence_packet_sha256: string;
	evidence_profile_ref: string;
	evidence_ref_count: number;
	evidence_refs: EvidenceReplayRef[];
	schema_version: "evidence_replay_index.v1";
}

export interface SinkIdentityProjection {
	projectionSha256: string;
	pseudonymizationPolicy: "pseudonymous_refs_v1";
	requestRef: string;
	runRef: string;
	schemaVersion: "sink_identity_projection.v1";
	subjectRef: string;
	traceRef: string;
}

export type ReplayPacketAccessKind = "delete" | "export" | "read" | "replay";

export interface ReplayPacketIndexIngestPayload {
	access_audit?: unknown;
	answer_eval_fingerprint?: unknown;
	approval_ref?: unknown;
	capture_policy?: unknown;
	created_at?: unknown;
	deletion_linkage?: unknown;
	encryption_key_ref?: unknown;
	evidence_replay_index?: unknown;
	expires_at?: unknown;
	llm_io_fingerprint?: unknown;
	object_checksum_sha256?: unknown;
	object_ref?: unknown;
	operator_principal?: unknown;
	packet_id?: unknown;
	request_id?: unknown;
	retention?: unknown;
	run_id?: unknown;
	schema_version?: unknown;
	sensitivity_classification?: unknown;
	sink_identity_projection?: unknown;
	trace_id?: unknown;
	[key: string]: unknown;
}

export interface ReplayPacketIndexWrite {
	accessAudit: ReplayPacketAccessAuditPolicy;
	answerEvalFingerprint: ToolExecutionAnswerEvalFingerprint | null;
	approvalRef: string | null;
	capturePolicy: RawCapturePolicy;
	createdAt: string;
	deletionLinkage: ReplayPacketDeletionLinkage;
	encryptionKeyRef: string;
	evidenceReplayIndex: EvidenceReplayIndex;
	expiresAt: string;
	llmIoFingerprint: ToolExecutionLlmIoFingerprint;
	objectChecksumSha256: string;
	objectRef: string;
	operatorPrincipal: string | null;
	packetId: string;
	requestId: string;
	retention: ReplayPacketRetention;
	runId: string;
	sensitivityClassification: string;
	sinkIdentityProjection: SinkIdentityProjection | null;
	traceId: string;
}

export interface ReplayPacketIndexRead extends ReplayPacketIndexWrite {
	deletedAt: string | null;
	deletionMarker: ReplayPacketDeletionMarker | null;
	lastAccessedAt: string | null;
}

export interface ReplayPacketAccessAuditWrite {
	accessId: string;
	accessKind: ReplayPacketAccessKind;
	actorPrincipal: string;
	occurredAt: string;
	packetId: string;
	purpose: string;
	requestId: string;
	traceId: string;
}

export interface ReplayPacketLinkageFilter {
	requestId?: string;
	subjectRef?: string;
	traceId?: string;
}

export interface ReplayCaptureStore {
	getReplayPacketIndexById(packetId: string): Promise<ReplayPacketIndexRead | null>;
	insertReplayPacketAccessAudit(input: ReplayPacketAccessAuditWrite): Promise<void>;
	listReplayPacketsByLinkage(input: {
		linkage: ReplayPacketLinkageFilter;
	}): Promise<ReplayPacketIndexRead[]>;
	markReplayPacketsDeletedByLinkage(input: {
		deletionMarker: ReplayPacketDeletionMarker;
		linkage: ReplayPacketLinkageFilter;
	}): Promise<ReplayPacketIndexRead[]>;
	touchReplayPacketLastAccessedAt(input: { accessedAt: string; packetId: string }): Promise<void>;
	upsertReplayPacketIndex(input: ReplayPacketIndexWrite): Promise<void>;
}

export interface ReplayCaptureService {
	deleteReplayPacketsByLinkage(input: {
		actorPrincipal: string;
		approvalRef?: string;
		mode: "mark_deleted";
		purpose: string;
		requestId?: string;
		subjectRef?: string;
		traceId?: string;
	}): Promise<{
		deletedPacketIds: string[];
		matchedCount: number;
		mode: "mark_deleted";
	}>;
	getReplayPacketIndex(input: {
		accessKind: Exclude<ReplayPacketAccessKind, "delete">;
		actorPrincipal: string;
		approvalRef?: string;
		packetId: string;
		purpose: string;
	}): Promise<{ packet: ReplayPacketIndexRead }>;
	ingestReplayPacketIndex(input: {
		payload: ReplayPacketIndexIngestPayload;
	}): Promise<{ accepted: 1; packetId: string }>;
}
