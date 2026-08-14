import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalDocumentUnitSchema from "../schemas/canonical-document-units.v1.schema.json" with {
	type: "json",
};
import canonicalDocumentUnitV2Schema from "../schemas/canonical-document-units.v2.schema.json" with {
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
import internalPortalFileReleaseCaptureResultSchema from "../schemas/internal-portal-file-release-capture-result.v1.schema.json" with {
	type: "json",
};
import internalPortalFileReleaseSourceSchema from "../schemas/internal-portal-file-release-source.v1.schema.json" with {
	type: "json",
};
import internalPortalMetaSchema from "../schemas/internal-portal-meta.v1.schema.json" with {
	type: "json",
};
import internalPortalNoticeSourceSchema from "../schemas/internal-portal-notice-source.v2.schema.json" with {
	type: "json",
};
import internalPortalNoticeSyncStateSchema from "../schemas/internal-portal-notice-sync-state.v2.schema.json" with {
	type: "json",
};
import retrievalChunkSetV2Schema from "../schemas/retrieval-chunk-set.v2.schema.json" with {
	type: "json",
};
import retrievalChunkV2Schema from "../schemas/retrieval-chunks.v2.schema.json" with {
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

export interface CanonicalDocumentUnitV2 {
	schema_version: "canonical_document_unit.v2";
	document_scope: string;
	document_id: string;
	version_id: string;
	section_id: string;
	parent_section_id: string | null;
	ordinal: number;
	anchor: string;
	document_title: string;
	section_title: string;
	canonical_url: string;
	content: string;
	content_sha256: string;
	metadata: Record<string, unknown>;
}

export interface RetrievalChunkV2 {
	schema_version: "retrieval_chunk.v2";
	document_scope: string;
	document_id: string;
	version_id: string;
	section_id: string;
	chunk_id: string;
	ordinal: number;
	token_count: number;
	text: string;
	text_sha256: string;
	metadata: Record<string, unknown>;
}

export interface RetrievalChunkSetV2 {
	schema_version: "retrieval_chunk_set.v2";
	chunk_count: number;
	chunks: RetrievalChunkV2[];
	error_count: number;
	errors: string[];
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

export type IngestionTaskExecutorKind = "rust_kernel";

export interface InternalPortalNoticeSourceAttachment {
	notice_annex_id: string | null;
	notice_annex_name: string | null;
	notice_annex_path: string | null;
	suffix: string | null;
	type: string | null;
}

interface InternalPortalNoticeSourceBase {
	schema_version: "internal_portal_notice_source.v2";
	notice_id: number;
	notice_type: number;
	organization_id: string | null;
	notice_title: string;
	notice_release_time: string | null;
	notice_content_html: string | null;
	attachments: InternalPortalNoticeSourceAttachment[];
}

export type InternalPortalNoticeSource = InternalPortalNoticeSourceBase &
	({ is_external: false; external_url: null } | { is_external: true; external_url: string });

export interface InternalPortalNoticeSyncState {
	schema_version: "internal_portal_notice_sync_state.v2";
	head_notice_id: number | null;
	history_covered_from: string | null;
	updated_at: string;
}

export interface InternalPortalMeta {
	schema_version: "internal_portal_meta.v1";
	notice_types: Record<string, string>;
	organizations: Record<string, string>;
	updated_at: string;
}

export interface InternalPortalFileReleaseSource {
	schema_version: "internal_portal_file_release_source.v1";
	site_id: string;
	file_release_id: number;
	title: string;
	file_code: string | null;
	department: string | null;
	explanation_department: string | null;
	published_at: string | null;
	file: {
		object_key: string;
		original_filename: string;
		content_type: string;
		byte_size: number;
		digest: string;
	};
}

export interface InternalPortalFileReleaseCaptureResult {
	schema_version: "internal_portal_file_release_capture_result.v1";
	file_release_id: number;
	source_ref: IngestionArtifactRef;
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
const canonicalDocumentUnitV2Validator = ajv.compile(
	canonicalDocumentUnitV2Schema,
) as ValidateFunction<CanonicalDocumentUnitV2>;
const retrievalChunkV2Validator = ajv.compile(
	retrievalChunkV2Schema,
) as ValidateFunction<RetrievalChunkV2>;
const retrievalChunkSetV2Validator = ajv.compile(
	retrievalChunkSetV2Schema,
) as ValidateFunction<RetrievalChunkSetV2>;
const internalPortalFileReleaseCaptureResultValidator = ajv.compile(
	internalPortalFileReleaseCaptureResultSchema,
) as ValidateFunction<InternalPortalFileReleaseCaptureResult>;
const internalPortalFileReleaseSourceValidator = ajv.compile(
	internalPortalFileReleaseSourceSchema,
) as ValidateFunction<InternalPortalFileReleaseSource>;
const internalPortalNoticeSourceValidator = ajv.compile(
	internalPortalNoticeSourceSchema,
) as ValidateFunction<InternalPortalNoticeSource>;
const internalPortalNoticeSyncStateValidator = ajv.compile(
	internalPortalNoticeSyncStateSchema,
) as ValidateFunction<InternalPortalNoticeSyncState>;
const internalPortalMetaValidator = ajv.compile(
	internalPortalMetaSchema,
) as ValidateFunction<InternalPortalMeta>;

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

export function validateCanonicalDocumentUnitV2(value: unknown): ValidationResult {
	return validateWith(canonicalDocumentUnitV2Validator, value);
}

export function validateRetrievalChunkV2(value: unknown): ValidationResult {
	return validateWith(retrievalChunkV2Validator, value);
}

export function validateRetrievalChunkSetV2(value: unknown): ValidationResult {
	const result = validateWith(retrievalChunkSetV2Validator, value);
	if (!result.ok) {
		return result;
	}
	const set = value as RetrievalChunkSetV2;
	if (set.chunk_count !== set.chunks.length) {
		return { ok: false, errors: ["chunk_count must match chunks length"] };
	}
	if (set.error_count !== set.errors.length) {
		return { ok: false, errors: ["error_count must match errors length"] };
	}
	const chunkIds = new Set<string>();
	for (const chunk of set.chunks) {
		if (chunkIds.has(chunk.chunk_id)) {
			return { ok: false, errors: [`chunks contains duplicate chunk_id: ${chunk.chunk_id}`] };
		}
		chunkIds.add(chunk.chunk_id);
	}
	return { ok: true };
}

export function validateInternalPortalNoticeSource(value: unknown): ValidationResult {
	return validateWith(internalPortalNoticeSourceValidator, value);
}

export function validateInternalPortalNoticeSyncState(value: unknown): ValidationResult {
	return validateWith(internalPortalNoticeSyncStateValidator, value);
}

export function validateInternalPortalMeta(value: unknown): ValidationResult {
	return validateWith(internalPortalMetaValidator, value);
}

export function validateInternalPortalFileReleaseSource(value: unknown): ValidationResult {
	return validateWith(internalPortalFileReleaseSourceValidator, value);
}

export function validateInternalPortalFileReleaseCaptureResult(value: unknown): ValidationResult {
	return validateWith(internalPortalFileReleaseCaptureResultValidator, value);
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
