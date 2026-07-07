import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import canonicalDocumentUnitSchema from "../schemas/canonical-document-units.v1.schema.json" with {
	type: "json",
};
import releaseManifestSchema from "../schemas/ingestion-release-manifest.v1.schema.json" with {
	type: "json",
};
import taskEnvelopeSchema from "../schemas/ingestion-task-envelope.v2.schema.json" with {
	type: "json",
};
import taskRegistrySchema from "../schemas/ingestion-task-registry.v2.schema.json" with {
	type: "json",
};

export type {
	OfficialWebFetchDisposition,
	OfficialWebIngestionDispatchStatus,
	OfficialWebIngestionExecutionStatus,
	OfficialWebPageChangeStatus,
	OfficialWebRunIntent,
	OfficialWebRunStatus,
	OfficialWebTerminalRunStatus,
} from "./official-web-lifecycle.ts";

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

export type IngestionArtifactRefKind = "object_store" | "local_file" | "postgres_row" | "inline";

export interface IngestionArtifactRef {
	kind: IngestionArtifactRefKind;
	uri: string;
	digest?: string;
}

export interface IngestionReleaseManifestArtifact {
	kind: string;
	uri: string;
	digest: string;
	[key: string]: unknown;
}

export interface IngestionReleaseManifest {
	schema_version: "ingestion_release_manifest.v1";
	release_id: string;
	corpus: string;
	collection: string;
	artifacts: IngestionReleaseManifestArtifact[];
	[key: string]: unknown;
}

export type IngestionTaskKind =
	| "source_truth_materialize"
	| "document_units_validate"
	| "chunk_prepare"
	| "release_manifest_validate";

export interface IngestionTaskEnvelope {
	schema_version: "ingestion_task_envelope.v2";
	task_id: string;
	run_id: string;
	source_family: string;
	source_channel: string;
	corpus: string;
	collection: string;
	registry_task_id: string;
	task_kind: IngestionTaskKind;
	input_ref: IngestionArtifactRef;
	input_contract: string;
	output_contract: string;
	idempotency_key: string;
	created_by: string;
	created_at: string;
}

export type IngestionTaskExecutorKind = "rust_kernel" | "ts_control";

export interface IngestionTaskRegistryTask {
	registry_task_id: string;
	task_kind: IngestionTaskKind;
	executor_kind: IngestionTaskExecutorKind;
	kernel_id?: string;
	input_contract: string;
	output_contract: string;
}

export interface IngestionTaskRegistry {
	schema_version: "ingestion_task_registry.v2";
	source_family: string;
	corpus: string;
	collection: string;
	tasks: IngestionTaskRegistryTask[];
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
