import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalDocumentUnitSchema from "../schemas/canonical-document-units.v1.schema.json" with {
	type: "json",
};
import offlineReleaseSchema from "../schemas/ingestion-offline-release.v1.schema.json" with {
	type: "json",
};
import taskEnvelopeSchema from "../schemas/ingestion-task-envelope.v3.schema.json" with {
	type: "json",
};
import taskRegistrySchema from "../schemas/ingestion-task-registry.v3.schema.json" with {
	type: "json",
};
import taskResultSchema from "../schemas/ingestion-task-result.v1.schema.json" with {
	type: "json",
};
import internalPortalCaptureRequestsSchema from "../schemas/internal-portal-capture-requests.v2.schema.json" with {
	type: "json",
};
import internalPortalNoticeCheckpointSchema from "../schemas/internal-portal-notice-checkpoint.v1.schema.json" with {
	type: "json",
};
import internalPortalStageResultsSchema from "../schemas/internal-portal-stage-results.v1.schema.json" with {
	type: "json",
};

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export interface CanonicalDocumentUnit {
	doc_id: string;
	version_id: string;
	chunk_id: string;
	root_unit_id: string;
	text: string;
	clean_text: string;
	unit_type?: string;
	metadata: Record<string, unknown>;
	anchor: Record<string, unknown>;
	[key: string]: unknown;
}

export type IngestionArtifactRefKind = "object_store";

export interface IngestionArtifactRef {
	kind: IngestionArtifactRefKind;
	uri: string;
	digest: string;
	byte_size: number;
}

export interface IngestionTaskEnvelope {
	schema_version: "ingestion_task_envelope.v3";
	task_id: string;
	run_id: string;
	registry_task_id: string;
	input_ref: IngestionArtifactRef;
}

export type IngestionTaskExecutorKind = "rust_kernel" | "source_collector" | "typescript_kernel";

export type InternalPortalArtifactRole =
	| "attachment_refs"
	| "canonical_document_units"
	| "canonical_markdown"
	| "capture_release"
	| "capture_checkpoint"
	| "content_blocks"
	| "export_manifest"
	| "released_file"
	| "source_bundle"
	| "source_manifest";

export interface IngestionRoleArtifactRef extends IngestionArtifactRef {
	role: InternalPortalArtifactRole;
}

export type InternalPortalStageResultContract =
	| "internal_portal_file_release_capture_result.v1"
	| "internal_portal_file_release_materialization_result.v1"
	| "internal_portal_notice_capture_result.v1"
	| "internal_portal_notice_materialization_result.v1";

export interface InternalPortalStageResultManifest {
	schema_version: InternalPortalStageResultContract;
	task_id: string;
	run_id: string;
	registry_task_id: string;
	artifacts: IngestionRoleArtifactRef[];
	items?: IngestionOfflineReleaseItem[];
	summary: Record<string, IngestionTaskSummaryValue>;
}

export interface InternalPortalNoticeCheckpoint {
	notice_type: string;
	last_released_notice_id: number;
}

export interface InternalPortalNoticeCaptureCheckpoint {
	schema_version: "internal_portal_notice_checkpoint.v1";
	captured_at: string;
	previous: InternalPortalNoticeCheckpoint[];
	next: InternalPortalNoticeCheckpoint[];
}

export interface InternalPortalNoticeCaptureRequestV2 {
	schema_version: "internal_portal_notice_capture_request.v2";
	collection_mode: "reconcile" | "incremental" | "selected";
	checkpoints: InternalPortalNoticeCheckpoint[];
	overlap_pages: number;
	max_notices?: number;
	selected_notices?: Array<{
		notice_id: number;
		notice_type: string;
		notice_type_name?: string;
		notice_title?: string;
	}>;
}

export interface InternalPortalFileReleaseCaptureRequestV2 {
	schema_version: "internal_portal_file_release_capture_request.v2";
	file_release_id: number;
}

export type InternalPortalCaptureRequest =
	| InternalPortalFileReleaseCaptureRequestV2
	| InternalPortalNoticeCaptureRequestV2;

export interface IngestionOfflineReleaseItem {
	item_id: string;
	version_id: string;
	artifacts: Array<IngestionArtifactRef & { role: string }>;
}

export interface IngestionOfflineRelease {
	schema_version: "ingestion_offline_release.v1";
	release_id: string;
	stream_id: string;
	previous_release_id: string | null;
	created_at: string;
	source: { channel: "internal_portal"; surface: "file_release" | "notice"; site_id: string };
	target: { corpus: string; collection: string };
	pipeline: {
		run_id: string;
		workflow_id: string;
		workflow_run_id: string;
		task_ids: string[];
		code_commit?: string | null;
		worker_build_id?: string | null;
		registry_digest?: string | null;
		source_config_digest?: string | null;
	};
	checkpoint: Record<string, unknown>;
	changes?: {
		added_item_ids: string[];
		updated_item_ids: string[];
		withdrawn_item_ids: string[];
	};
	items: IngestionOfflineReleaseItem[];
}

export interface IngestionTaskSourceIdentity {
	family: string;
	channel: string;
}

export interface IngestionTaskTargetIdentity {
	corpus: string;
	collection: string;
}

export interface IngestionTaskRegistryTask {
	registry_task_id: string;
	executor_kind: IngestionTaskExecutorKind;
	kernel_id?: string;
	input_contract: string;
	output_contract: string;
	source?: IngestionTaskSourceIdentity;
	target?: IngestionTaskTargetIdentity;
}

export interface IngestionTaskRegistry {
	schema_version: "ingestion_task_registry.v3";
	tasks: IngestionTaskRegistryTask[];
}

export interface IngestionTaskExecutionSnapshot {
	schema_version: "ingestion_task_execution_snapshot.v1";
	task: IngestionTaskEnvelope;
	registry_task: IngestionTaskRegistryTask;
}

export type IngestionTaskSummaryValue = string | number | boolean | null;

export interface IngestionTaskResult {
	schema_version: "ingestion_task_result.v1";
	task_id: string;
	run_id: string;
	registry_task_id: string;
	output_contract: string;
	result_ref: IngestionArtifactRef;
	summary: Record<string, IngestionTaskSummaryValue>;
}

const ajv = new Ajv2020({
	allErrors: true,
	messages: true,
	strict: true,
	strictRequired: false,
	verbose: true,
});
addFormats(ajv);

const taskEnvelopeValidator = ajv.compile(
	taskEnvelopeSchema,
) as ValidateFunction<IngestionTaskEnvelope>;
const taskRegistryValidator = ajv.compile(
	taskRegistrySchema,
) as ValidateFunction<IngestionTaskRegistry>;
const taskResultValidator = ajv.compile(taskResultSchema) as ValidateFunction<IngestionTaskResult>;
const canonicalDocumentUnitValidator = ajv.compile(
	canonicalDocumentUnitSchema,
) as ValidateFunction<CanonicalDocumentUnit>;
const offlineReleaseValidator = ajv.compile(
	offlineReleaseSchema,
) as ValidateFunction<IngestionOfflineRelease>;
const internalPortalCaptureRequestValidator = ajv.compile(
	internalPortalCaptureRequestsSchema,
) as ValidateFunction<InternalPortalCaptureRequest>;
const internalPortalNoticeCheckpointValidator = ajv.compile(
	internalPortalNoticeCheckpointSchema,
) as ValidateFunction<InternalPortalNoticeCaptureCheckpoint>;
const internalPortalStageResultValidator = ajv.compile(
	internalPortalStageResultsSchema,
) as ValidateFunction<InternalPortalStageResultManifest>;

export function validateIngestionTaskEnvelope(value: unknown): ValidationResult {
	return validateWith(taskEnvelopeValidator, value);
}

export function validateIngestionTaskRegistry(value: unknown): ValidationResult {
	return validateWith(taskRegistryValidator, value);
}

export function validateIngestionTaskResult(value: unknown): ValidationResult {
	const result = validateWith(taskResultValidator, value);
	if (!result.ok) {
		return result;
	}
	const summary = (value as IngestionTaskResult).summary;
	if (new TextEncoder().encode(JSON.stringify(summary)).byteLength > 4096) {
		return { ok: false, errors: ["summary must not exceed 4096 bytes"] };
	}
	return { ok: true };
}

export function validateCanonicalDocumentUnit(value: unknown): ValidationResult {
	return validateWith(canonicalDocumentUnitValidator, value);
}

export function validateIngestionOfflineRelease(value: unknown): ValidationResult {
	const result = validateWith(offlineReleaseValidator, value);
	if (!result.ok) {
		return result;
	}
	const release = value as IngestionOfflineRelease;
	const itemIds = new Set<string>();
	for (const item of release.items) {
		if (itemIds.has(item.item_id)) {
			return { ok: false, errors: [`items contains duplicate item_id: ${item.item_id}`] };
		}
		itemIds.add(item.item_id);
	}
	return { ok: true };
}

export function validateInternalPortalCaptureRequest(value: unknown): ValidationResult {
	return validateWith(internalPortalCaptureRequestValidator, value);
}

export function validateInternalPortalNoticeCheckpoint(value: unknown): ValidationResult {
	const result = validateWith(internalPortalNoticeCheckpointValidator, value);
	if (!result.ok) {
		return result;
	}
	const checkpoint = value as InternalPortalNoticeCaptureCheckpoint;
	for (const [label, entries] of [
		["previous", checkpoint.previous],
		["next", checkpoint.next],
	] as const) {
		const types = new Set<string>();
		for (const entry of entries) {
			if (types.has(entry.notice_type)) {
				return {
					ok: false,
					errors: [`${label} contains duplicate notice_type: ${entry.notice_type}`],
				};
			}
			types.add(entry.notice_type);
		}
	}
	return { ok: true };
}

export function validateInternalPortalStageResult(value: unknown): ValidationResult {
	const result = validateWith(internalPortalStageResultValidator, value);
	if (!result.ok) {
		return result;
	}
	const manifest = value as InternalPortalStageResultManifest;
	const identities = new Set<string>();
	for (const artifact of manifest.artifacts) {
		const identity = `${artifact.role}:${artifact.uri}`;
		if (identities.has(identity)) {
			return { ok: false, errors: [`artifacts contains duplicate role and URI: ${identity}`] };
		}
		identities.add(identity);
	}
	const itemIds = new Set<string>();
	for (const item of manifest.items ?? []) {
		if (itemIds.has(item.item_id)) {
			return { ok: false, errors: [`items contains duplicate item_id: ${item.item_id}`] };
		}
		itemIds.add(item.item_id);
		const itemArtifacts = new Set<string>();
		for (const artifact of item.artifacts) {
			const identity = `${artifact.role}:${artifact.uri}`;
			if (itemArtifacts.has(identity)) {
				return {
					ok: false,
					errors: [`item ${item.item_id} contains duplicate role and URI: ${identity}`],
				};
			}
			itemArtifacts.add(identity);
		}
	}
	return { ok: true };
}

export function validateCanonicalDocumentUnitsJsonl(input: string): ValidationResult {
	const errors: string[] = [];
	for (const [index, line] of input.split(/\r?\n/u).entries()) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch (error) {
			errors.push(
				`line ${index + 1} invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			continue;
		}
		const result = validateCanonicalDocumentUnit(parsed);
		if (!result.ok) {
			errors.push(...result.errors.map((message) => `line ${index + 1} ${message}`));
		}
	}
	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateWith(validator: ValidateFunction, value: unknown): ValidationResult {
	if (validator(value)) {
		return { ok: true };
	}
	return {
		ok: false,
		errors: formatAjvErrors(validator.errors ?? []),
	};
}

function formatAjvErrors(errors: ErrorObject[]): string[] {
	return errors.map(formatAjvError);
}

function formatAjvError(error: ErrorObject): string {
	const path = error.instancePath ? jsonPointerToPath(error.instancePath) : "payload";
	if (error.keyword === "required") {
		const missingProperty = String(error.params.missingProperty ?? "");
		return `${joinPath(path, missingProperty)} is required`;
	}
	if (error.keyword === "additionalProperties") {
		const additionalProperty = String(error.params.additionalProperty ?? "");
		return `${joinPath(path, additionalProperty)} is not allowed`;
	}
	if (error.keyword === "enum") {
		return `${path} is not supported: ${String(error.data)}`;
	}
	if (error.keyword === "const") {
		return `${path} must be ${String(error.params.allowedValue)}`;
	}
	if (error.keyword === "format") {
		return `${path} must match ${String(error.params.format)} format`;
	}
	if (error.keyword === "minLength") {
		return `${path} must be non-empty`;
	}
	if (error.keyword === "minItems") {
		return `${path} must contain at least ${String(error.params.limit)} item`;
	}
	return `${path} ${error.message ?? "is invalid"}`;
}

function jsonPointerToPath(pointer: string): string {
	const segments = pointer
		.split("/")
		.slice(1)
		.map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
	if (segments.length === 0) {
		return "payload";
	}
	return segments.reduce((path, segment) => {
		if (/^\d+$/u.test(segment)) {
			return `${path}[${segment}]`;
		}
		return path === "payload" ? segment : `${path}.${segment}`;
	}, "payload");
}

function joinPath(path: string, field: string): string {
	return path === "payload" ? field : `${path}.${field}`;
}
