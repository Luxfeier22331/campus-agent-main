import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalDocumentUnitSchema from "../schemas/canonical-document-units.v1.schema.json" with {
	type: "json",
};
import releaseManifestSchema from "../schemas/ingestion-release-manifest.v2.schema.json" with {
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

export interface IngestionReleaseManifestArtifact {
	kind: string;
	uri: string;
	digest: string;
	byte_size: number;
	[key: string]: unknown;
}

export interface IngestionReleaseManifest {
	schema_version: "ingestion_release_manifest.v2";
	release_id: string;
	corpus: string;
	collection: string;
	artifacts: IngestionReleaseManifestArtifact[];
	[key: string]: unknown;
}

export interface IngestionTaskEnvelope {
	schema_version: "ingestion_task_envelope.v3";
	task_id: string;
	run_id: string;
	registry_task_id: string;
	input_ref: IngestionArtifactRef;
}

export type IngestionTaskExecutorKind = "rust_kernel" | "source_collector";

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
const releaseManifestValidator = ajv.compile(
	releaseManifestSchema,
) as ValidateFunction<IngestionReleaseManifest>;

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

export function validateIngestionReleaseManifest(value: unknown): ValidationResult {
	return validateWith(releaseManifestValidator, value);
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
