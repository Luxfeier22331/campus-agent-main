export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const TASK_ENVELOPE_VERSION = "ingestion_task_envelope.v1";
const TASK_REGISTRY_VERSION = "ingestion_task_registry.v1";

const taskKinds = new Set([
	"source_truth_materialize",
	"document_units_validate",
	"chunk_prepare",
	"release_manifest_validate",
]);

const executorKinds = new Set(["rust_kernel", "ts_control"]);

export function validateIngestionTaskEnvelope(value: unknown): ValidationResult {
	const errors: string[] = [];
	if (!isRecord(value)) {
		return { ok: false, errors: ["payload must be an object"] };
	}

	requireString(value, "schema_version", errors);
	requireString(value, "task_id", errors);
	requireString(value, "run_id", errors);
	requireString(value, "source_family", errors);
	requireString(value, "source_channel", errors);
	requireString(value, "corpus", errors);
	requireString(value, "collection", errors);
	requireString(value, "task_kind", errors);
	requireString(value, "output_contract", errors);
	requireString(value, "idempotency_key", errors);
	requireString(value, "created_by", errors);
	requireString(value, "created_at", errors);

	if (value.schema_version !== undefined && value.schema_version !== TASK_ENVELOPE_VERSION) {
		errors.push("schema_version must be ingestion_task_envelope.v1");
	}
	if (typeof value.task_kind === "string" && !taskKinds.has(value.task_kind)) {
		errors.push(`task_kind is not supported: ${value.task_kind}`);
	}
	validateArtifactRef(value.input_ref, "input_ref", errors);
	validateLeasePolicy(value.lease_policy, errors);
	validateRetryPolicy(value.retry_policy, errors);

	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateIngestionTaskRegistry(value: unknown): ValidationResult {
	const errors: string[] = [];
	if (!isRecord(value)) {
		return { ok: false, errors: ["payload must be an object"] };
	}

	requireString(value, "schema_version", errors);
	requireString(value, "source_family", errors);
	requireString(value, "corpus", errors);
	requireString(value, "collection", errors);
	if (value.schema_version !== undefined && value.schema_version !== TASK_REGISTRY_VERSION) {
		errors.push("schema_version must be ingestion_task_registry.v1");
	}
	if (!Array.isArray(value.tasks) || value.tasks.length === 0) {
		errors.push("tasks must contain at least one task");
		return errors.length === 0 ? { ok: true } : { ok: false, errors };
	}

	value.tasks.forEach((task, index) => {
		if (!isRecord(task)) {
			errors.push(`tasks[${index}] must be an object`);
			return;
		}
		requireString(task, `tasks[${index}].task_kind`, errors, "task_kind");
		requireString(task, `tasks[${index}].executor_kind`, errors, "executor_kind");
		requireString(task, `tasks[${index}].input_contract`, errors, "input_contract");
		requireString(task, `tasks[${index}].output_contract`, errors, "output_contract");
		if (typeof task.task_kind === "string" && !taskKinds.has(task.task_kind)) {
			errors.push(`tasks[${index}].task_kind is not supported: ${task.task_kind}`);
		}
		if (typeof task.executor_kind === "string" && !executorKinds.has(task.executor_kind)) {
			errors.push(`tasks[${index}].executor_kind is not supported: ${task.executor_kind}`);
		}
		if (typeof task.can_publish_alias !== "boolean") {
			errors.push(`tasks[${index}].can_publish_alias is required`);
		}
		if (task.executor_kind === "rust_kernel") {
			requireString(task, `tasks[${index}].kernel_id`, errors, "kernel_id");
		}
	});

	return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateArtifactRef(value: unknown, path: string, errors: string[]): void {
	if (!isRecord(value)) {
		errors.push(`${path} is required`);
		return;
	}
	requireString(value, `${path}.kind`, errors, "kind");
	requireString(value, `${path}.uri`, errors, "uri");
}

function validateLeasePolicy(value: unknown, errors: string[]): void {
	if (!isRecord(value)) {
		errors.push("lease_policy is required");
		return;
	}
	requirePositiveInteger(value, "lease_policy.lease_seconds", errors, "lease_seconds");
	requirePositiveInteger(value, "lease_policy.heartbeat_seconds", errors, "heartbeat_seconds");
}

function validateRetryPolicy(value: unknown, errors: string[]): void {
	if (!isRecord(value)) {
		errors.push("retry_policy is required");
		return;
	}
	requirePositiveInteger(value, "retry_policy.max_attempts", errors, "max_attempts");
}

function requireString(
	value: Record<string, unknown>,
	path: string,
	errors: string[],
	field = path,
): void {
	if (typeof value[field] !== "string" || value[field].trim() === "") {
		errors.push(`${path} is required`);
	}
}

function requirePositiveInteger(
	value: Record<string, unknown>,
	path: string,
	errors: string[],
	field: string,
): void {
	if (!Number.isInteger(value[field]) || Number(value[field]) < 1) {
		errors.push(`${path} must be a positive integer`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
