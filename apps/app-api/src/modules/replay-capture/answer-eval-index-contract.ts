import { answerEvalFingerprintSha256 } from "../integration/answer-eval-fingerprint-hash";
import { llmIoFingerprintSha256, sha256JsonRef } from "../integration/llm-io-fingerprint-hash";
import type { ReplayPacketIndexWrite } from "./types";
import {
	assertAllowedKeys,
	normalizeEnum,
	normalizeRequiredString,
	normalizeSha256Ref,
	requireRecord,
	routeError,
} from "./validation";

const ANSWER_EVAL_FINGERPRINT_FIELDS = new Set([
	"answer_fingerprint_sha256",
	"branch_identity",
	"evidence_replay_index_sha256",
	"llm_call_site",
	"llm_io_fingerprint_sha256",
	"output_schema_id",
	"provider_profile_revision",
	"request_id",
	"run_id",
	"runtime_release",
	"schema_version",
	"selected_tool",
	"selected_tools",
	"stage_timing_profile_sha256",
	"terminal_outcome",
	"tool_runtime_combined_sha256",
	"trace_id",
]);
const ANSWER_BRANCH_IDENTITY_FIELDS = new Set([
	"branch_kind",
	"prompt_id",
	"schema_version",
	"workflow_mode",
]);
const ANSWER_BRANCH_KINDS = new Set([
	"clarification",
	"direct_no_tool",
	"policy_refusal",
	"runtime_error",
	"tool_routed",
]);
const LLM_CALL_SITES = new Set(["agent.primary"]);
const SINK_IDENTITY_PROJECTION_FIELDS = new Set([
	"projection_sha256",
	"pseudonymization_policy",
	"request_ref",
	"run_ref",
	"schema_version",
	"subject_ref",
	"trace_ref",
]);

export function normalizeOptionalAnswerEvalFingerprint(
	value: unknown,
): ReplayPacketIndexWrite["answerEvalFingerprint"] {
	if (value === null || value === undefined) {
		return null;
	}
	const record = requireRecord(value, "answer_eval_fingerprint");
	assertAllowedKeys(record, ANSWER_EVAL_FINGERPRINT_FIELDS, "answer_eval_fingerprint");
	if (record.schema_version !== "answer_eval_fingerprint.v1") {
		throw routeError({
			code: "validation_failed",
			message: "answer_eval_fingerprint.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		answerFingerprintSha256: normalizeSha256Ref(
			record.answer_fingerprint_sha256,
			"answer_eval_fingerprint.answer_fingerprint_sha256",
		),
		branchIdentity: normalizeAnswerBranchIdentity(record.branch_identity),
		evidenceReplayIndexSha256:
			record.evidence_replay_index_sha256 === null ||
			record.evidence_replay_index_sha256 === undefined
				? null
				: normalizeSha256Ref(
						record.evidence_replay_index_sha256,
						"answer_eval_fingerprint.evidence_replay_index_sha256",
					),
		llmCallSite: normalizeEnum(
			record.llm_call_site,
			LLM_CALL_SITES,
			"answer_eval_fingerprint.llm_call_site",
		) as NonNullable<ReplayPacketIndexWrite["answerEvalFingerprint"]>["llmCallSite"],
		llmIoFingerprintSha256: normalizeSha256Ref(
			record.llm_io_fingerprint_sha256,
			"answer_eval_fingerprint.llm_io_fingerprint_sha256",
		),
		outputSchemaId: normalizeRequiredString(
			record.output_schema_id,
			"answer_eval_fingerprint.output_schema_id",
		),
		providerProfileRevision: normalizeRequiredString(
			record.provider_profile_revision,
			"answer_eval_fingerprint.provider_profile_revision",
		),
		requestId: normalizeRequiredString(record.request_id, "answer_eval_fingerprint.request_id"),
		runId: normalizeRequiredString(record.run_id, "answer_eval_fingerprint.run_id"),
		runtimeRelease: normalizeRequiredString(
			record.runtime_release,
			"answer_eval_fingerprint.runtime_release",
		),
		schemaVersion: "answer_eval_fingerprint.v1",
		selectedTool:
			record.selected_tool === null
				? null
				: normalizeRequiredString(record.selected_tool, "answer_eval_fingerprint.selected_tool"),
		selectedTools: normalizeUniqueStringList(
			record.selected_tools,
			"answer_eval_fingerprint.selected_tools",
		),
		stageTimingProfileSha256: normalizeSha256Ref(
			record.stage_timing_profile_sha256,
			"answer_eval_fingerprint.stage_timing_profile_sha256",
		),
		terminalOutcome: normalizeRequiredString(
			record.terminal_outcome,
			"answer_eval_fingerprint.terminal_outcome",
		),
		toolRuntimeCombinedSha256: normalizeSha256Ref(
			record.tool_runtime_combined_sha256,
			"answer_eval_fingerprint.tool_runtime_combined_sha256",
		),
		traceId: normalizeRequiredString(record.trace_id, "answer_eval_fingerprint.trace_id"),
	};
}

function normalizeAnswerBranchIdentity(
	value: unknown,
): NonNullable<ReplayPacketIndexWrite["answerEvalFingerprint"]>["branchIdentity"] {
	const record = requireRecord(value, "answer_eval_fingerprint.branch_identity");
	assertAllowedKeys(
		record,
		ANSWER_BRANCH_IDENTITY_FIELDS,
		"answer_eval_fingerprint.branch_identity",
	);
	if (record.schema_version !== "answer_branch_identity.v1") {
		throw routeError({
			code: "validation_failed",
			message: "answer_eval_fingerprint.branch_identity.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		branchKind: normalizeEnum(
			record.branch_kind,
			ANSWER_BRANCH_KINDS,
			"answer_eval_fingerprint.branch_identity.branch_kind",
		) as NonNullable<
			ReplayPacketIndexWrite["answerEvalFingerprint"]
		>["branchIdentity"]["branchKind"],
		promptId: normalizeRequiredString(
			record.prompt_id,
			"answer_eval_fingerprint.branch_identity.prompt_id",
		),
		schemaVersion: "answer_branch_identity.v1",
		workflowMode: normalizeRequiredString(
			record.workflow_mode,
			"answer_eval_fingerprint.branch_identity.workflow_mode",
		),
	};
}

export function normalizeOptionalSinkIdentityProjection(
	value: unknown,
): ReplayPacketIndexWrite["sinkIdentityProjection"] {
	if (value === null || value === undefined) {
		return null;
	}
	const record = requireRecord(value, "sink_identity_projection");
	assertAllowedKeys(record, SINK_IDENTITY_PROJECTION_FIELDS, "sink_identity_projection");
	if (record.schema_version !== "sink_identity_projection.v1") {
		throw routeError({
			code: "validation_failed",
			message: "sink_identity_projection.schema_version is unsupported.",
			status: 422,
		});
	}
	if (record.pseudonymization_policy !== "pseudonymous_refs_v1") {
		throw routeError({
			code: "validation_failed",
			message: "sink_identity_projection.pseudonymization_policy is unsupported.",
			status: 422,
		});
	}
	return {
		projectionSha256: normalizeSha256Ref(
			record.projection_sha256,
			"sink_identity_projection.projection_sha256",
		),
		pseudonymizationPolicy: "pseudonymous_refs_v1",
		requestRef: normalizePseudonymousRef(
			record.request_ref,
			"sink_identity_projection.request_ref",
			"request",
		),
		runRef: normalizePseudonymousRef(record.run_ref, "sink_identity_projection.run_ref", "run"),
		schemaVersion: "sink_identity_projection.v1",
		subjectRef: normalizePseudonymousRef(
			record.subject_ref,
			"sink_identity_projection.subject_ref",
			"subject",
		),
		traceRef: normalizePseudonymousRef(
			record.trace_ref,
			"sink_identity_projection.trace_ref",
			"trace",
		),
	};
}

export function assertAnswerEvalFingerprintIdentityConsistent(input: ReplayPacketIndexWrite): void {
	const sink = input.sinkIdentityProjection;
	if (sink && sink.projectionSha256 !== sinkIdentityProjectionSha256(sink)) {
		throw routeError({
			code: "validation_failed",
			message: "projection_sha256 must match sink_identity_projection.",
			status: 422,
		});
	}
	const fingerprint = input.answerEvalFingerprint;
	if (!fingerprint) {
		return;
	}
	const checks = [
		{
			actual: fingerprint.llmIoFingerprintSha256,
			expected: llmIoFingerprintSha256(input.llmIoFingerprint),
			field: "llm_io_fingerprint_sha256",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.runId,
			expected: input.runId,
			field: "run_id",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.requestId,
			expected: input.requestId,
			field: "request_id",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.traceId,
			expected: input.traceId,
			field: "trace_id",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.runtimeRelease,
			expected: input.llmIoFingerprint.runtimeRelease,
			field: "runtime_release",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.llmCallSite,
			expected: input.llmIoFingerprint.llmCallSite,
			field: "llm_call_site",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.providerProfileRevision,
			expected: input.llmIoFingerprint.providerProfileRevision,
			field: "provider_profile_revision",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.outputSchemaId,
			expected: input.llmIoFingerprint.outputSchemaId,
			field: "output_schema_id",
			target: "answer_eval_fingerprint",
		},
		{
			actual: fingerprint.branchIdentity.promptId,
			expected: input.llmIoFingerprint.promptId,
			field: "branch_identity.prompt_id",
			target: "llm_io_fingerprint.prompt_id",
		},
		{
			actual: fingerprint.toolRuntimeCombinedSha256,
			expected: input.llmIoFingerprint.toolRuntimeFingerprint.combinedSha256,
			field: "tool_runtime_combined_sha256",
			target: "answer_eval_fingerprint",
		},
	];
	for (const check of checks) {
		if (check.actual !== check.expected) {
			throw routeError({
				code: "validation_failed",
				message: `answer_eval_fingerprint.${check.field} must match ${check.target}.`,
				status: 422,
			});
		}
	}
	if (fingerprint.answerFingerprintSha256 !== answerEvalFingerprintSha256(fingerprint)) {
		throw routeError({
			code: "validation_failed",
			message: "answer_fingerprint_sha256 must match answer_eval_fingerprint.",
			status: 422,
		});
	}
	if (
		fingerprint.evidenceReplayIndexSha256 &&
		fingerprint.evidenceReplayIndexSha256 !== sha256JsonRef(input.evidenceReplayIndex)
	) {
		throw routeError({
			code: "validation_failed",
			message: "evidence_replay_index_sha256 must match evidence_replay_index.",
			status: 422,
		});
	}
}

function sinkIdentityProjectionSha256(
	sink: NonNullable<ReplayPacketIndexWrite["sinkIdentityProjection"]>,
): string {
	const body = toContractSinkIdentityProjection(sink);
	delete body.projection_sha256;
	return sha256JsonRef(body);
}

function toContractSinkIdentityProjection(
	sink: NonNullable<ReplayPacketIndexWrite["sinkIdentityProjection"]>,
): Record<string, unknown> & { projection_sha256?: string } {
	return {
		projection_sha256: sink.projectionSha256,
		pseudonymization_policy: sink.pseudonymizationPolicy,
		request_ref: sink.requestRef,
		run_ref: sink.runRef,
		schema_version: sink.schemaVersion,
		subject_ref: sink.subjectRef,
		trace_ref: sink.traceRef,
	};
}

function normalizePseudonymousRef(value: unknown, field: string, prefix: string): string {
	const ref = normalizeRequiredString(value, field);
	if (!new RegExp(`^${prefix}:[a-f0-9]{32,64}$`).test(ref)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be a ${prefix} pseudonymous ref.`,
			status: 422,
		});
	}
	return ref;
}

function normalizeUniqueStringList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must be an array.`,
			status: 422,
		});
	}
	const items = value.map((item, index) => normalizeRequiredString(item, `${field}.${index}`));
	if (new Set(items).size !== items.length) {
		throw routeError({
			code: "validation_failed",
			details: { field },
			message: `${field} must not contain duplicates.`,
			status: 422,
		});
	}
	return items;
}
