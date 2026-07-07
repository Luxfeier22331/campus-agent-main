import { z } from "zod";

import { canonicalJsonSha256Hex, formatZodIssues } from "./core.ts";

export const CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION =
	"internal_notice_consumer_admission_manifest.v1";
export const CONSUMER_ADMISSION_POLICY_VERSION = "internal_notice_consumer_admission_policy.v1";

export const CONSUMER_ADMISSION_DECISION_ADMIT = "admit";
export const CONSUMER_ADMISSION_DECISION_BLOCK = "block";
export const CONSUMER_ADMISSION_DECISION_NO_ADOPTION = "no_adoption";

export const CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION =
	"candidate_for_typed_materialization";

export const CONSUMER_ADMISSION_BODY_QUALITY_PRESENT = "body_present";
export const CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY = "title_only";
export const CONSUMER_ADMISSION_BODY_QUALITY_EMPTY = "empty_body";

export const CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED = "upsert_selected";
export const CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE = "replace_scope";

export const CONSUMER_ADMISSION_GATE_OPERATION_PROJECTION_REBUILD = "projection_rebuild";
export const CONSUMER_ADMISSION_GATE_OPERATION_READ_MODEL_REBUILD = "read_model_rebuild";
export const CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION = "typed_materialization";
export const CONSUMER_ADMISSION_GATE_OPERATION_MULTIMODAL_DRAIN = "multimodal_drain";
export const CONSUMER_ADMISSION_GATE_OPERATION_IMPORT_MATERIALIZATION = "import_materialization";

export const CONSUMER_ADMISSION_GATE_VERDICT_ALLOW = "allow";
export const CONSUMER_ADMISSION_GATE_VERDICT_BLOCK = "block";

export const CONSUMER_ADMISSION_GATE_REASON_MISSING_MANIFEST = "missing_manifest";
export const CONSUMER_ADMISSION_GATE_REASON_INVALID_MANIFEST = "invalid_manifest";
export const CONSUMER_ADMISSION_GATE_REASON_SCOPE_MISMATCH = "scope_mismatch";
export const CONSUMER_ADMISSION_GATE_REASON_ID_MISMATCH = "id_mismatch";
export const CONSUMER_ADMISSION_GATE_REASON_REPLACE_SCOPE_NOT_AUTHORIZED =
	"replace_scope_not_authorized";
export const CONSUMER_ADMISSION_GATE_REASON_TARGET_SURFACE_VIOLATION = "target_surface_violation";
export const CONSUMER_ADMISSION_GATE_REASON_THRESHOLD_BREACH = "threshold_breach";

export const NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY = "notice_level_query";
export const NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY = "procurement_notice_history";
export const NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE = "regulation_candidate";
export const NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES = "regulations/institutional_rules";
export const NOTICE_TARGET_SURFACE_SCOPED_RULES = "regulations/scoped_rules";
export const NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE = "service_status_candidate";
export const NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE = "special_service_candidate";
export const NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE = "stable_contact_candidate";
export const NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE =
	"multimodal_processing_candidate";
export const NOTICE_TARGET_SURFACE_UNSUPPORTED = "unsupported";

export const NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY = "retained_for_notice_query";
export const NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET = "ready_for_target_materialization";
export const NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING =
	"pending_multimodal_processing";
export const NOTICE_CONSUMPTION_STATUS_NO_ADOPTION = "no_adoption";

const ALLOWED_CONSUMER_ADMISSION_TARGET_SURFACES = new Set([
	NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
	NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
	NOTICE_TARGET_SURFACE_REGULATION_CANDIDATE,
	NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
	NOTICE_TARGET_SURFACE_SCOPED_RULES,
	NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
	NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
	NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
	NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
	NOTICE_TARGET_SURFACE_UNSUPPORTED,
]);

const ALLOWED_CONSUMER_ADMISSION_STATUSES = new Set([
	NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
	NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
	NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
	NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
	CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
]);

const ALLOWED_CONSUMER_ADMISSION_DECISIONS = new Set([
	CONSUMER_ADMISSION_DECISION_ADMIT,
	CONSUMER_ADMISSION_DECISION_BLOCK,
	CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
]);

const ALLOWED_CONSUMER_ADMISSION_SCOPE_WRITE_MODES = new Set([
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
	CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
]);

export interface ConsumerAdmissionDecisionRecord {
	admission_decision: string;
	admission_reason_codes: string[];
	attachment_document_count: number;
	attachment_ref_count: number;
	body_quality: string;
	consumption_status: string;
	notice_family: string;
	notice_id: string;
	owner_expectation_count: number;
	pending_multimodal_attachment_count: number;
	raw_asset_id: string;
	raw_version_id: string;
	reference_only_attachment_ref_count: number;
	site_id: string;
	source_notice_id: string;
	suggested_consumption_route: string;
	target_surface: string;
	unsupported_binary_count: number;
}

export interface InternalNoticeConsumerAdmissionManifest {
	admission_run_id: string;
	collection: string;
	corpus: string;
	created_at: string;
	decision_counts: Record<string, number>;
	decision_records: ConsumerAdmissionDecisionRecord[];
	policy_version: typeof CONSUMER_ADMISSION_POLICY_VERSION;
	schema_version: typeof CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION;
	scope_write_mode: string;
	selected_notice_ids: string[];
	selection_path: string;
	selection_sha256: string;
	selection_source: string;
	source_channel: string;
}

export interface ConsumerAdmissionGateRequest {
	maxEmptyBodyCount?: number | null;
	maxOwnerExpectationCount?: number | null;
	maxPendingMultimodalAttachmentCount?: number | null;
	maxReferenceOnlyAttachmentCount?: number | null;
	maxUnsupportedBinaryCount?: number | null;
	operation: string;
	scopeWriteMode?: string;
	selectedNoticeIds?: readonly string[];
	sourceCollection: string;
	sourceCorpus: string;
	targetSurface?: string;
}

export interface ConsumerAdmissionGateReport {
	admissionDecisionCounts: Record<string, number>;
	allowed: boolean;
	consumptionStatusCounts: Record<string, number>;
	manifestSelectedNoticeIds: string[];
	operation: string;
	reasonCodes: string[];
	selectedNoticeIds: string[];
	sourceCollection: string;
	sourceCorpus: string;
	targetSurfaceCounts: Record<string, number>;
	thresholdCounts: Record<string, number>;
	verdict: string;
}

const DecisionRecordSchema = z.object({
	admission_decision: z.string(),
	admission_reason_codes: z.array(z.string()).default([]),
	attachment_document_count: z.coerce.number().int().nonnegative().default(0),
	attachment_ref_count: z.coerce.number().int().nonnegative(),
	body_quality: z.string(),
	consumption_status: z.string(),
	notice_family: z.string(),
	notice_id: z.string(),
	owner_expectation_count: z.coerce.number().int().nonnegative(),
	pending_multimodal_attachment_count: z.coerce.number().int().nonnegative(),
	raw_asset_id: z.string(),
	raw_version_id: z.string(),
	reference_only_attachment_ref_count: z.coerce.number().int().nonnegative(),
	site_id: z.string(),
	source_notice_id: z.string().optional(),
	suggested_consumption_route: z.string(),
	target_surface: z.string(),
	unsupported_binary_count: z.coerce.number().int().nonnegative().default(0),
});

const ManifestSchema = z.object({
	admission_run_id: z.string(),
	collection: z.string(),
	corpus: z.string(),
	created_at: z.string().default(""),
	decision_counts: z.record(z.string(), z.coerce.number().int()).default({}),
	decision_records: z.array(DecisionRecordSchema),
	policy_version: z.literal(CONSUMER_ADMISSION_POLICY_VERSION),
	schema_version: z.literal(CONSUMER_ADMISSION_MANIFEST_SCHEMA_VERSION),
	scope_write_mode: z.string(),
	selected_notice_ids: z.array(z.string()),
	selection_path: z.string().default(""),
	selection_sha256: z.string(),
	selection_source: z.string(),
	source_channel: z.string(),
});

export function computeConsumerAdmissionSelectionSha256(
	selectedNoticeIds: readonly string[],
): string {
	return canonicalJsonSha256Hex({
		selected_notice_ids: normalizeNoticeIds(selectedNoticeIds),
	});
}

export function parseInternalNoticeConsumerAdmissionManifestPayload(
	payload: unknown,
): InternalNoticeConsumerAdmissionManifest {
	const manifest = normalizeManifest(payload);
	validateInternalNoticeConsumerAdmissionManifest(manifest);
	return manifest;
}

export function serializeInternalNoticeConsumerAdmissionManifest(
	manifest: InternalNoticeConsumerAdmissionManifest,
): InternalNoticeConsumerAdmissionManifest {
	const normalized = normalizeManifest(manifest);
	validateInternalNoticeConsumerAdmissionManifest(normalized);
	return {
		...normalized,
		decision_counts: decisionCounts(normalized.decision_records),
	};
}

export function validateInternalNoticeConsumerAdmissionManifest(
	manifest: InternalNoticeConsumerAdmissionManifest,
): void {
	const normalized = normalizeManifest(manifest);
	for (const [fieldName, value] of [
		["admission_run_id", normalized.admission_run_id],
		["source_channel", normalized.source_channel],
		["corpus", normalized.corpus],
		["collection", normalized.collection],
		["selection_source", normalized.selection_source],
		["selection_sha256", normalized.selection_sha256],
	] as const) {
		if (!value) {
			throw new Error(`consumer admission manifest ${fieldName} is required`);
		}
	}
	if (!ALLOWED_CONSUMER_ADMISSION_SCOPE_WRITE_MODES.has(normalized.scope_write_mode)) {
		throw new Error(
			`unsupported consumer admission manifest scope_write_mode: ${normalized.scope_write_mode}`,
		);
	}
	const expectedSha256 = computeConsumerAdmissionSelectionSha256(normalized.selected_notice_ids);
	if (normalized.selection_sha256 !== expectedSha256) {
		throw new Error("consumer admission manifest selection_sha256 mismatch");
	}
	const recordIds = normalized.decision_records.map((record) => record.notice_id);
	if (recordIds.length !== new Set(recordIds).size) {
		throw new Error("duplicate decision notice_id in consumer admission manifest");
	}
	if (!setsEqual(new Set(recordIds), new Set(normalized.selected_notice_ids))) {
		throw new Error("consumer admission manifest selected_notice_ids mismatch decisions");
	}
	for (const record of normalized.decision_records) {
		validateDecisionRecord(record);
	}
}

export function normalizeManifest(payload: unknown): InternalNoticeConsumerAdmissionManifest {
	const parsed = ManifestSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(
			`consumer admission manifest is invalid: ${formatZodIssues(parsed.error.issues, "manifest").join("; ")}`,
		);
	}
	return {
		...parsed.data,
		admission_run_id: trimText(parsed.data.admission_run_id),
		collection: trimText(parsed.data.collection),
		corpus: trimText(parsed.data.corpus),
		created_at: trimText(parsed.data.created_at),
		decision_counts: Object.fromEntries(
			Object.entries(parsed.data.decision_counts).map(([key, value]) => [String(key), value]),
		),
		decision_records: parsed.data.decision_records
			.map(normalizeDecisionRecord)
			.sort((left, right) => left.notice_id.localeCompare(right.notice_id)),
		scope_write_mode: trimText(parsed.data.scope_write_mode),
		selected_notice_ids: normalizeNoticeIds(parsed.data.selected_notice_ids),
		selection_path: trimText(parsed.data.selection_path),
		selection_sha256: trimText(parsed.data.selection_sha256).toLowerCase(),
		selection_source: trimText(parsed.data.selection_source),
		source_channel: trimText(parsed.data.source_channel),
	};
}

export function decisionCounts(
	records: readonly ConsumerAdmissionDecisionRecord[],
): Record<string, number> {
	return countBy(
		records.flatMap((record) => [
			record.admission_decision,
			record.target_surface,
			record.consumption_status,
		]),
	);
}

export function countBy(values: readonly string[]): Record<string, number> {
	const counts = new Map<string, number>();
	for (const value of values.map((item) => item.trim()).filter(Boolean)) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return Object.fromEntries(
		[...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
	);
}

export function normalizeNoticeIds(values: readonly string[]): string[] {
	return normalizeTextValues(values).sort();
}

export function normalizeTextValues(values: readonly unknown[]): string[] {
	return [
		...new Set(
			values.map((value) => trimText(value)).filter((value): value is string => Boolean(value)),
		),
	];
}

export function trimText(value: unknown): string {
	return String(value ?? "").trim();
}

export function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function normalizeDecisionRecord(
	record: z.infer<typeof DecisionRecordSchema>,
): ConsumerAdmissionDecisionRecord {
	const noticeId = trimText(record.notice_id);
	return {
		...record,
		admission_decision: trimText(record.admission_decision),
		admission_reason_codes: normalizeTextValues(record.admission_reason_codes),
		body_quality: trimText(record.body_quality),
		consumption_status: trimText(record.consumption_status),
		notice_family: trimText(record.notice_family),
		notice_id: noticeId,
		raw_asset_id: trimText(record.raw_asset_id),
		raw_version_id: trimText(record.raw_version_id),
		site_id: trimText(record.site_id),
		source_notice_id: trimText(record.source_notice_id ?? noticeId),
		suggested_consumption_route: trimText(record.suggested_consumption_route),
		target_surface: trimText(record.target_surface),
	};
}

function validateDecisionRecord(record: ConsumerAdmissionDecisionRecord): void {
	if (!record.notice_id) {
		throw new Error("consumer admission decision notice_id is required");
	}
	if (!ALLOWED_CONSUMER_ADMISSION_TARGET_SURFACES.has(record.target_surface)) {
		throw new Error(`unsupported consumer admission target_surface: ${record.target_surface}`);
	}
	if (!ALLOWED_CONSUMER_ADMISSION_STATUSES.has(record.consumption_status)) {
		throw new Error(
			`unsupported consumer admission consumption_status: ${record.consumption_status}`,
		);
	}
	if (!ALLOWED_CONSUMER_ADMISSION_DECISIONS.has(record.admission_decision)) {
		throw new Error(
			`unsupported consumer admission admission_decision: ${record.admission_decision}`,
		);
	}
	if (record.admission_reason_codes.length === 0) {
		throw new Error("consumer admission decision admission_reason_codes is required");
	}
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
	return left.size === right.size && [...left].every((value) => right.has(value));
}
