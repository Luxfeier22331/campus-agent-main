import type {
	RawCaptureField,
	RawCapturePolicy,
	RawCapturePolicyMode,
	RawCaptureSink,
} from "../observability-config";
import {
	assertAnswerEvalFingerprintIdentityConsistent,
	normalizeOptionalAnswerEvalFingerprint,
	normalizeOptionalSinkIdentityProjection,
} from "./answer-eval-index-contract";
import { normalizeLlmIoFingerprint } from "./llm-io-fingerprint-contract";
import type {
	ReplayPacketDeletionLinkage,
	ReplayPacketIndexIngestPayload,
	ReplayPacketIndexWrite,
} from "./types";
import {
	assertAllowedKeys,
	normalizeBoolean,
	normalizeEnum,
	normalizeInteger,
	normalizeIsoTimestamp,
	normalizeKeyToken,
	normalizeNullableString,
	normalizeObjectRef,
	normalizeOptionalNonNegativeInteger,
	normalizeOptionalReplayIndexString,
	normalizeRequiredString,
	normalizeSha256Ref,
	normalizeUniqueEnumList,
	requireRecord,
	routeError,
} from "./validation";

const REPLAY_PACKET_INDEX_SCHEMA_VERSION = "llm_replay_packet_index.v1";
const REPLAY_PACKET_INDEX_FIELDS = new Set([
	"access_audit",
	"answer_eval_fingerprint",
	"approval_ref",
	"capture_policy",
	"created_at",
	"deletion_linkage",
	"encryption_key_ref",
	"evidence_replay_index",
	"expires_at",
	"llm_io_fingerprint",
	"object_checksum_sha256",
	"object_ref",
	"operator_principal",
	"packet_id",
	"request_id",
	"retention",
	"run_id",
	"schema_version",
	"sensitivity_classification",
	"sink_identity_projection",
	"trace_id",
]);
const RAW_CAPTURE_POLICY_FIELDS = new Set([
	"allowed_raw_fields",
	"allowed_sinks",
	"approval_ref",
	"audit_required",
	"capture_reason",
	"dsar_delete_linkage_required",
	"mode",
	"operator_principal",
	"request_id",
	"run_id",
	"schema_version",
	"ttl_days",
	"trace_id",
]);
const RAW_CAPTURE_POLICY_MODES = new Set<RawCapturePolicyMode>([
	"eval_case",
	"failure_triggered",
	"manual_run_capture",
	"off",
	"operator_window",
	"sampled",
]);
const RAW_CAPTURE_SINKS = new Set<RawCaptureSink>([
	"langfuse_otlp",
	"openai_agents_trace",
	"s3_replay_packet",
]);
const RAW_CAPTURE_FIELDS = new Set<RawCaptureField>([
	"output_schema",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"rendered_messages",
	"selected_evidence_packet",
	"selected_memory_context",
	"tool_calls",
	"tool_results",
]);
const DELETION_LINKAGE_FIELDS = new Set([
	"conversation_id",
	"evidence_ref_count",
	"memory_ref_count",
	"request_id",
	"subject_ref",
	"trace_id",
]);
const REPLAY_RETENTION_FIELDS = new Set([
	"created_at",
	"deletion_linkage_ref",
	"dsar_delete_linkage_required",
	"expires_at",
	"retention_class",
	"schema_version",
	"ttl_days",
]);
const REPLAY_ACCESS_AUDIT_FIELDS = new Set([
	"access_policy_ref",
	"audit_log_ref",
	"audit_required",
	"last_accessed_at",
	"schema_version",
]);
const EVIDENCE_REPLAY_INDEX_FIELDS = new Set([
	"evidence_packet_sha256",
	"evidence_profile_ref",
	"evidence_ref_count",
	"evidence_refs",
	"schema_version",
]);
const EVIDENCE_REPLAY_REF_FIELDS = new Set([
	"evidence_ref",
	"evidence_sha256",
	"source_profile_ref",
]);
const FORBIDDEN_REPLAY_PACKET_INDEX_KEY_TOKENS = [
	"authorization",
	"cookie",
	"auth_envelope",
	"jwt",
	"access_token",
	"refresh_token",
	"id_token",
	"api_key",
	"private_key",
	"memory_payload",
	"memory_raw",
	"memory_text",
	"provider_body",
	"provider_request_body",
	"provider_raw_response",
	"provider_response_body",
	"provider_stream_deltas",
	"raw_answer",
	"raw_prompt",
	"raw_response",
	"raw_secret",
	"raw_transcript",
	"rendered_messages",
	"secret",
	"selected_evidence_packet",
	"selected_memory_context",
	"tool_args",
	"tool_arguments",
	"tool_calls",
	"tool_results",
].map(normalizeKeyToken);

const FORBIDDEN_REPLAY_PACKET_INDEX_KEYS = new Set(FORBIDDEN_REPLAY_PACKET_INDEX_KEY_TOKENS);

export function assertNoForbiddenReplayPacketIndexFields(value: unknown): void {
	if (Array.isArray(value)) {
		for (const item of value) {
			assertNoForbiddenReplayPacketIndexFields(item);
		}
		return;
	}
	if (!value || typeof value !== "object") {
		return;
	}
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		const normalized = normalizeKeyToken(key);
		if (
			FORBIDDEN_REPLAY_PACKET_INDEX_KEYS.has(normalized) ||
			FORBIDDEN_REPLAY_PACKET_INDEX_KEY_TOKENS.some((token) => normalized.endsWith(token))
		) {
			throw routeError({
				code: "validation_failed",
				details: { field: key },
				message: `${key} is forbidden in replay packet index metadata.`,
				status: 422,
			});
		}
		assertNoForbiddenReplayPacketIndexFields(item);
	}
}

export function normalizeReplayPacketIndexPayload(
	payload: ReplayPacketIndexIngestPayload,
): ReplayPacketIndexWrite {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw routeError({
			code: "validation_failed",
			message: "Replay packet index payload must be an object.",
			status: 422,
		});
	}
	assertNoForbiddenReplayPacketIndexFields(payload);
	if (payload.schema_version !== REPLAY_PACKET_INDEX_SCHEMA_VERSION) {
		throw routeError({
			code: "validation_failed",
			message: "Replay packet index schema_version is unsupported.",
			status: 422,
		});
	}
	assertAllowedKeys(payload, REPLAY_PACKET_INDEX_FIELDS, "replay_packet_index");

	const normalized: ReplayPacketIndexWrite = {
		accessAudit: normalizeReplayAccessAudit(payload.access_audit),
		answerEvalFingerprint: normalizeOptionalAnswerEvalFingerprint(payload.answer_eval_fingerprint),
		approvalRef: normalizeOptionalReplayIndexString(payload, "approval_ref"),
		capturePolicy: normalizeRawCapturePolicy(payload.capture_policy),
		createdAt: normalizeIsoTimestamp(payload.created_at, "created_at"),
		deletionLinkage: normalizeDeletionLinkage(payload.deletion_linkage),
		encryptionKeyRef: normalizeRequiredString(payload.encryption_key_ref, "encryption_key_ref"),
		evidenceReplayIndex: normalizeEvidenceReplayIndex(payload.evidence_replay_index),
		expiresAt: normalizeIsoTimestamp(payload.expires_at, "expires_at"),
		llmIoFingerprint: normalizeLlmIoFingerprint(payload.llm_io_fingerprint),
		objectChecksumSha256: normalizeSha256Ref(
			payload.object_checksum_sha256,
			"object_checksum_sha256",
		),
		objectRef: normalizeObjectRef(payload.object_ref),
		operatorPrincipal: normalizeOptionalReplayIndexString(payload, "operator_principal"),
		packetId: normalizeRequiredString(payload.packet_id, "packet_id"),
		requestId: normalizeRequiredString(payload.request_id, "request_id"),
		retention: normalizeReplayRetention(payload.retention),
		runId: normalizeRequiredString(payload.run_id, "run_id"),
		sensitivityClassification: normalizeRequiredString(
			payload.sensitivity_classification,
			"sensitivity_classification",
		),
		sinkIdentityProjection: normalizeOptionalSinkIdentityProjection(
			payload.sink_identity_projection,
		),
		traceId: normalizeRequiredString(payload.trace_id, "trace_id"),
	};
	assertReplayPacketIndexIdentityConsistent(normalized);
	assertReplayPacketIndexPolicyConsistent(normalized);
	assertReplayPacketIndexRequiredProjections(normalized);
	return normalized;
}

function normalizeRawCapturePolicy(value: unknown): RawCapturePolicy {
	const record = requireRecord(value, "capture_policy");
	assertAllowedKeys(record, RAW_CAPTURE_POLICY_FIELDS, "capture_policy");
	if (record.schema_version !== "raw_capture_policy.v1") {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy.schema_version is unsupported.",
			status: 422,
		});
	}
	const mode = normalizeEnum(record.mode, RAW_CAPTURE_POLICY_MODES, "capture_policy.mode");
	const policy: RawCapturePolicy = {
		allowed_raw_fields: normalizeUniqueEnumList(
			record.allowed_raw_fields,
			RAW_CAPTURE_FIELDS,
			"capture_policy.allowed_raw_fields",
		),
		allowed_sinks: normalizeUniqueEnumList(
			record.allowed_sinks,
			RAW_CAPTURE_SINKS,
			"capture_policy.allowed_sinks",
		),
		approval_ref: normalizeOptionalNullableString(
			record.approval_ref,
			"capture_policy.approval_ref",
		),
		audit_required: normalizeBoolean(record.audit_required, "capture_policy.audit_required"),
		capture_reason: normalizeRequiredString(record.capture_reason, "capture_policy.capture_reason"),
		dsar_delete_linkage_required: normalizeBoolean(
			record.dsar_delete_linkage_required,
			"capture_policy.dsar_delete_linkage_required",
		),
		mode,
		operator_principal: normalizeOptionalNullableString(
			record.operator_principal,
			"capture_policy.operator_principal",
		),
		request_id: normalizeOptionalNullableString(record.request_id, "capture_policy.request_id"),
		run_id: normalizeOptionalNullableString(record.run_id, "capture_policy.run_id"),
		schema_version: "raw_capture_policy.v1",
		ttl_days: normalizeInteger(record.ttl_days, "capture_policy.ttl_days"),
		trace_id: normalizeOptionalNullableString(record.trace_id, "capture_policy.trace_id"),
	};
	validateRawCapturePolicy(policy);
	return policy;
}

function normalizeOptionalNullableString(value: unknown, field: string): string | null {
	if (value === undefined) {
		return null;
	}
	return normalizeNullableString(value, field);
}

function normalizeDeletionLinkage(value: unknown): ReplayPacketDeletionLinkage {
	const record = requireRecord(value, "deletion_linkage");
	assertAllowedKeys(record, DELETION_LINKAGE_FIELDS, "deletion_linkage");
	return {
		conversation_id: normalizeRequiredString(
			record.conversation_id,
			"deletion_linkage.conversation_id",
		),
		evidence_ref_count: normalizeOptionalNonNegativeInteger(
			record.evidence_ref_count,
			"deletion_linkage.evidence_ref_count",
		),
		memory_ref_count: normalizeOptionalNonNegativeInteger(
			record.memory_ref_count,
			"deletion_linkage.memory_ref_count",
		),
		request_id: normalizeRequiredString(record.request_id, "deletion_linkage.request_id"),
		subject_ref: normalizeRequiredString(record.subject_ref, "deletion_linkage.subject_ref"),
		trace_id: normalizeRequiredString(record.trace_id, "deletion_linkage.trace_id"),
	};
}

function assertReplayPacketIndexRequiredProjections(input: ReplayPacketIndexWrite): void {
	if (!input.answerEvalFingerprint) {
		throw routeError({
			code: "validation_failed",
			message: "answer_eval_fingerprint is required for replay packet index.",
			status: 422,
		});
	}
	if (!input.answerEvalFingerprint.evidenceReplayIndexSha256) {
		throw routeError({
			code: "validation_failed",
			message:
				"answer_eval_fingerprint.evidence_replay_index_sha256 is required for replay packet index.",
			status: 422,
		});
	}
	if (!input.sinkIdentityProjection) {
		throw routeError({
			code: "validation_failed",
			message: "sink_identity_projection is required for replay packet index.",
			status: 422,
		});
	}
}

function normalizeReplayRetention(value: unknown): ReplayPacketIndexWrite["retention"] {
	const record = requireRecord(value, "retention");
	assertAllowedKeys(record, REPLAY_RETENTION_FIELDS, "retention");
	if (record.schema_version !== "replay_retention.v1") {
		throw routeError({
			code: "validation_failed",
			message: "retention.schema_version is unsupported.",
			status: 422,
		});
	}
	if (record.retention_class !== "safe_replay_packet_index") {
		throw routeError({
			code: "validation_failed",
			message: "retention.retention_class must be safe_replay_packet_index.",
			status: 422,
		});
	}
	if (record.dsar_delete_linkage_required !== true) {
		throw routeError({
			code: "validation_failed",
			message: "retention.dsar_delete_linkage_required must be true.",
			status: 422,
		});
	}
	return {
		created_at: normalizeIsoTimestamp(record.created_at, "retention.created_at"),
		deletion_linkage_ref: normalizeRequiredString(
			record.deletion_linkage_ref,
			"retention.deletion_linkage_ref",
		),
		dsar_delete_linkage_required: true,
		expires_at: normalizeIsoTimestamp(record.expires_at, "retention.expires_at"),
		retention_class: "safe_replay_packet_index",
		schema_version: "replay_retention.v1",
		ttl_days: normalizeInteger(record.ttl_days, "retention.ttl_days"),
	};
}

function normalizeReplayAccessAudit(value: unknown): ReplayPacketIndexWrite["accessAudit"] {
	const record = requireRecord(value, "access_audit");
	assertAllowedKeys(record, REPLAY_ACCESS_AUDIT_FIELDS, "access_audit");
	if (record.schema_version !== "replay_access_audit.v1") {
		throw routeError({
			code: "validation_failed",
			message: "access_audit.schema_version is unsupported.",
			status: 422,
		});
	}
	if (record.audit_required !== true) {
		throw routeError({
			code: "validation_failed",
			message: "access_audit.audit_required must be true.",
			status: 422,
		});
	}
	return {
		access_policy_ref: normalizeRequiredString(
			record.access_policy_ref,
			"access_audit.access_policy_ref",
		),
		audit_log_ref: normalizeRequiredString(record.audit_log_ref, "access_audit.audit_log_ref"),
		audit_required: true,
		last_accessed_at:
			record.last_accessed_at === null || record.last_accessed_at === undefined
				? null
				: normalizeIsoTimestamp(record.last_accessed_at, "access_audit.last_accessed_at"),
		schema_version: "replay_access_audit.v1",
	};
}

function normalizeEvidenceReplayIndex(
	value: unknown,
): ReplayPacketIndexWrite["evidenceReplayIndex"] {
	const record = requireRecord(value, "evidence_replay_index");
	assertAllowedKeys(record, EVIDENCE_REPLAY_INDEX_FIELDS, "evidence_replay_index");
	if (record.schema_version !== "evidence_replay_index.v1") {
		throw routeError({
			code: "validation_failed",
			message: "evidence_replay_index.schema_version is unsupported.",
			status: 422,
		});
	}
	const evidenceRefs = normalizeEvidenceRefs(record.evidence_refs);
	const evidenceRefCount = normalizeOptionalNonNegativeInteger(
		record.evidence_ref_count,
		"evidence_replay_index.evidence_ref_count",
	);
	if (evidenceRefCount === undefined) {
		throw routeError({
			code: "validation_failed",
			message: "evidence_replay_index.evidence_ref_count is required.",
			status: 422,
		});
	}
	if (evidenceRefs.length !== evidenceRefCount) {
		throw routeError({
			code: "validation_failed",
			message: "evidence_replay_index.evidence_ref_count must match evidence_refs length.",
			status: 422,
		});
	}
	return {
		evidence_packet_sha256: normalizeSha256Ref(
			record.evidence_packet_sha256,
			"evidence_replay_index.evidence_packet_sha256",
		),
		evidence_profile_ref: normalizeRequiredString(
			record.evidence_profile_ref,
			"evidence_replay_index.evidence_profile_ref",
		),
		evidence_ref_count: evidenceRefCount,
		evidence_refs: evidenceRefs,
		schema_version: "evidence_replay_index.v1",
	};
}

function normalizeEvidenceRefs(
	value: unknown,
): ReplayPacketIndexWrite["evidenceReplayIndex"]["evidence_refs"] {
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			message: "evidence_replay_index.evidence_refs must be an array.",
			status: 422,
		});
	}
	return value.map((item, index) => {
		const field = `evidence_replay_index.evidence_refs.${index}`;
		const record = requireRecord(item, field);
		assertAllowedKeys(record, EVIDENCE_REPLAY_REF_FIELDS, field);
		return {
			evidence_ref: normalizeRequiredString(record.evidence_ref, `${field}.evidence_ref`),
			evidence_sha256: normalizeSha256Ref(record.evidence_sha256, `${field}.evidence_sha256`),
			source_profile_ref: normalizeRequiredString(
				record.source_profile_ref,
				`${field}.source_profile_ref`,
			),
		};
	});
}

function validateRawCapturePolicy(policy: RawCapturePolicy): void {
	if (policy.mode === "off") {
		if (
			policy.ttl_days !== 0 ||
			policy.allowed_sinks.length > 0 ||
			policy.allowed_raw_fields.length > 0 ||
			policy.operator_principal !== null ||
			policy.approval_ref !== null ||
			policy.request_id !== null ||
			policy.run_id !== null ||
			policy.trace_id !== null ||
			policy.audit_required ||
			policy.dsar_delete_linkage_required
		) {
			throw routeError({
				code: "validation_failed",
				message: "capture_policy mode off must not admit raw capture.",
				status: 422,
			});
		}
		return;
	}
	if (policy.ttl_days <= 0) {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy.ttl_days must be positive when mode is not off.",
			status: 422,
		});
	}
	if (policy.allowed_sinks.length === 0) {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy.allowed_sinks must not be empty when mode is not off.",
			status: 422,
		});
	}
	if (policy.allowed_raw_fields.length === 0) {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy.allowed_raw_fields must not be empty when mode is not off.",
			status: 422,
		});
	}
	if (!(policy.operator_principal && policy.approval_ref)) {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy requires operator_principal and approval_ref when mode is not off.",
			status: 422,
		});
	}
	if (!(policy.audit_required && policy.dsar_delete_linkage_required)) {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy requires audit and deletion linkage when mode is not off.",
			status: 422,
		});
	}
	if (!(policy.request_id && policy.run_id && policy.trace_id)) {
		throw routeError({
			code: "validation_failed",
			message: "capture_policy requires request_id, run_id, and trace_id when mode is not off.",
			status: 422,
		});
	}
}

function assertReplayPacketIndexIdentityConsistent(input: ReplayPacketIndexWrite): void {
	const checks = [
		{
			actual: input.llmIoFingerprint.runId,
			expected: input.runId,
			field: "run_id",
			target: "llm_io_fingerprint",
		},
		{
			actual: input.llmIoFingerprint.requestId,
			expected: input.requestId,
			field: "request_id",
			target: "llm_io_fingerprint",
		},
		{
			actual: input.llmIoFingerprint.traceId,
			expected: input.traceId,
			field: "trace_id",
			target: "llm_io_fingerprint",
		},
		{
			actual: input.deletionLinkage.request_id,
			expected: input.requestId,
			field: "request_id",
			target: "deletion_linkage",
		},
		{
			actual: input.deletionLinkage.trace_id,
			expected: input.traceId,
			field: "trace_id",
			target: "deletion_linkage",
		},
		{
			actual: input.capturePolicy.run_id,
			expected: input.runId,
			field: "run_id",
			target: "capture_policy",
		},
		{
			actual: input.capturePolicy.request_id,
			expected: input.requestId,
			field: "request_id",
			target: "capture_policy",
		},
		{
			actual: input.capturePolicy.trace_id,
			expected: input.traceId,
			field: "trace_id",
			target: "capture_policy",
		},
	];
	for (const check of checks) {
		if (check.actual !== check.expected) {
			throw routeError({
				code: "validation_failed",
				message: `${check.field} must match ${check.target}.${check.field}.`,
				status: 422,
			});
		}
	}
	assertAnswerEvalFingerprintIdentityConsistent(input);
}

function assertReplayPacketIndexPolicyConsistent(input: ReplayPacketIndexWrite): void {
	if (input.retention.created_at !== input.createdAt) {
		throw routeError({
			code: "validation_failed",
			message: "retention.created_at must match created_at.",
			status: 422,
		});
	}
	if (input.retention.expires_at !== input.expiresAt) {
		throw routeError({
			code: "validation_failed",
			message: "retention.expires_at must match expires_at.",
			status: 422,
		});
	}
	if (input.retention.ttl_days !== input.capturePolicy.ttl_days) {
		throw routeError({
			code: "validation_failed",
			message: "retention.ttl_days must match capture_policy.ttl_days.",
			status: 422,
		});
	}
	assertReplayRetentionExpiryMatchesTTL(input.createdAt, input.expiresAt, input.retention.ttl_days);
	if (
		input.retention.dsar_delete_linkage_required !==
		input.capturePolicy.dsar_delete_linkage_required
	) {
		throw routeError({
			code: "validation_failed",
			message: "retention.dsar_delete_linkage_required must match capture_policy.",
			status: 422,
		});
	}
	if (input.accessAudit.audit_required !== input.capturePolicy.audit_required) {
		throw routeError({
			code: "validation_failed",
			message: "access_audit.audit_required must match capture_policy.audit_required.",
			status: 422,
		});
	}
	if (
		input.evidenceReplayIndex.evidence_packet_sha256 !== input.llmIoFingerprint.evidencePacketSha256
	) {
		throw routeError({
			code: "validation_failed",
			message: "evidence_replay_index.evidence_packet_sha256 must match llm_io_fingerprint.",
			status: 422,
		});
	}
}

function assertReplayRetentionExpiryMatchesTTL(
	createdAt: string,
	expiresAt: string,
	ttlDays: number,
): void {
	const created = new Date(createdAt);
	const expires = new Date(expiresAt);
	if (Number.isNaN(created.getTime()) || Number.isNaN(expires.getTime())) {
		throw routeError({
			code: "validation_failed",
			message: "retention created_at/expires_at must be valid timestamps.",
			status: 422,
		});
	}
	if (expires.getTime() <= created.getTime()) {
		throw routeError({
			code: "validation_failed",
			message: "retention.expires_at must be later than retention.created_at.",
			status: 422,
		});
	}
	const expectedExpires = new Date(created.getTime() + ttlDays * 24 * 60 * 60 * 1000);
	if (expires.toISOString() !== expectedExpires.toISOString()) {
		throw routeError({
			code: "validation_failed",
			message: "retention.expires_at must equal created_at plus ttl_days.",
			status: 422,
		});
	}
}
