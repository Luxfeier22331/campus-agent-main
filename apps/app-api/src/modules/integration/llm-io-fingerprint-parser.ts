import type { ToolExecutionLlmIoFingerprint } from "./tool-execution-types";

const LLM_IO_FINGERPRINT_FIELDS = [
	"schema_version",
	"run_id",
	"request_id",
	"trace_id",
	"runtime_release",
	"llm_call_site",
	"provider_profile_revision",
	"provider",
	"model",
	"model_params_hash",
	"model_params_projection",
	"prompt_id",
	"prompt_registry_attestation",
	"prompt_template_sha256",
	"prompt_variables_schema_version",
	"rendered_prompt_sha256",
	"provider_request_safe_hash",
	"tool_catalog_sha256",
	"tool_runtime_fingerprint",
	"tool_runtime_attestation",
	"tool_schema_sha256",
	"workflow_artifact_sha256",
	"context_envelope_sha256",
	"memory_selection_sha256",
	"evidence_packet_sha256",
	"output_schema_id",
	"primary_attestation",
] as const;

const LLM_IO_FINGERPRINT_FIELD_SET = new Set<string>(LLM_IO_FINGERPRINT_FIELDS);
const LLM_CALL_SITES = new Set(["agent.primary"]);
const PRIMARY_ATTESTATION_KINDS = new Set(["primary_agent_call"]);
const MODEL_PARAMS_PROJECTION_FIELDS = new Set([
	"params_schema_version",
	"params_sha256",
	"projected_params",
	"schema_version",
]);
const PROJECTED_MODEL_PARAMS_FIELDS = new Set([
	"max_output_tokens",
	"reasoning_effort",
	"response_format",
	"store",
	"temperature",
	"text_verbosity",
	"tool_choice",
	"top_p",
]);
const REASONING_EFFORT_VALUES = new Set(["high", "low", "medium", "minimal", "none", "xhigh"]);
const RESPONSE_FORMAT_VALUES = new Set(["json_object", "json_schema", "text"]);
const TEXT_VERBOSITY_VALUES = new Set(["high", "low", "medium"]);
const TOOL_CHOICE_VALUES = new Set(["auto", "none", "required", "tool_name"]);
const PROMPT_REGISTRY_ATTESTATION_FIELDS = new Set([
	"attestation_sha256",
	"output_schema_id",
	"prompt_id",
	"prompt_registry_version",
	"prompt_template_sha256",
	"prompt_variables_schema_version",
	"schema_version",
]);
const PROVIDER_REQUEST_SAFE_HASH_FIELDS = new Set([
	"canonicalization",
	"redaction_policy",
	"request_sha256",
	"schema_version",
]);
const TOOL_RUNTIME_FINGERPRINT_FIELDS = new Set([
	"combined_sha256",
	"function_schema_sha256",
	"function_schema_version",
	"schema_version",
	"tools_registry_version",
	"tools_schema_version",
	"tools_sha256",
	"workflow_artifact_registry_version",
	"workflow_artifact_schema_version",
	"workflow_artifact_sha256",
]);
const TOOL_RUNTIME_ATTESTATION_FIELDS = new Set([
	"attested_by",
	"combined_sha256",
	"config_refs",
	"function_schema_version",
	"schema_version",
	"tools_registry_version",
	"workflow_artifact_registry_version",
]);
const TOOL_RUNTIME_ATTESTATION_CONFIG_REFS = [
	"configs/runtime/tools.v4.json",
	"configs/runtime/tool-function-schemas.v1.json",
	"configs/runtime/workflow-artifacts.v2.json",
] as const;
const PRIMARY_ATTESTATION_FIELDS = new Set([
	"attestation_kind",
	"attestation_sha256",
	"attested_by",
	"schema_version",
]);

const FORBIDDEN_LLM_IO_FINGERPRINT_KEY_TOKENS = [
	"raw_answer",
	"raw_prompt",
	"raw_transcript",
	"provider_body",
	"provider_request_body",
	"provider_response_body",
	"provider_stream_deltas",
	"provider_raw_response",
	"raw_response",
	"raw_secret",
	"jwt",
	"authorization",
	"cookie",
	"auth_envelope",
	"memory_payload",
	"memory_raw",
	"memory_text",
	"retrieval_backend_dump",
	"secret",
	"tool_args",
	"tool_arguments",
];

class LlmIoFingerprintContractError extends Error {
	constructor(message: string) {
		super(`execution finalization response contract violation: ${message}`);
		this.name = "LlmIoFingerprintContractError";
	}
}

export function parseLlmIoFingerprint(value: unknown): ToolExecutionLlmIoFingerprint | null {
	if (value === null || value === undefined) {
		return null;
	}
	const record = getRecord(value);
	if (!record || containsForbiddenLlmIoFingerprintKey(record)) {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint must be a safe object",
		);
	}
	for (const key of Object.keys(record)) {
		if (!LLM_IO_FINGERPRINT_FIELD_SET.has(key)) {
			throw new LlmIoFingerprintContractError(
				`observability.llm_io_fingerprint.${key} is not allowed`,
			);
		}
	}
	if (record.schema_version !== "llm_io_fingerprint.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.schema_version is invalid",
		);
	}
	const toolCatalogSha256 = requireSha256Ref(record, "tool_catalog_sha256");
	const toolSchemaSha256 = requireSha256Ref(record, "tool_schema_sha256");
	const workflowArtifactSha256 = requireSha256Ref(record, "workflow_artifact_sha256");
	const toolRuntimeFingerprint = parseToolRuntimeFingerprint(record.tool_runtime_fingerprint);
	const modelParamsProjection = parseModelParamsProjection(record.model_params_projection);
	const promptRegistryAttestation = parsePromptRegistryAttestation(
		record.prompt_registry_attestation,
	);
	const providerRequestSafeHash = parseProviderRequestSafeHash(record.provider_request_safe_hash);
	const toolRuntimeAttestation = parseToolRuntimeAttestation(record.tool_runtime_attestation);
	const primaryAttestation = parsePrimaryAttestation(record.primary_attestation);
	assertMatchingFingerprintHash(
		toolCatalogSha256,
		toolRuntimeFingerprint.toolsSha256,
		"tool_catalog_sha256",
		"tools_sha256",
	);
	assertMatchingFingerprintHash(
		toolSchemaSha256,
		toolRuntimeFingerprint.functionSchemaSha256,
		"tool_schema_sha256",
		"function_schema_sha256",
	);
	assertMatchingFingerprintHash(
		workflowArtifactSha256,
		toolRuntimeFingerprint.workflowArtifactSha256,
		"workflow_artifact_sha256",
		"workflow_artifact_sha256",
	);
	assertMatchingFingerprintHash(
		requireSha256Ref(record, "model_params_hash"),
		modelParamsProjection.paramsSha256,
		"model_params_hash",
		"model_params_projection.params_sha256",
	);
	assertMatchingFingerprintHash(
		toolRuntimeFingerprint.combinedSha256,
		toolRuntimeAttestation.combinedSha256,
		"tool_runtime_fingerprint.combined_sha256",
		"tool_runtime_attestation.combined_sha256",
	);
	assertMatchingString(
		toolRuntimeFingerprint.toolsRegistryVersion,
		toolRuntimeAttestation.toolsRegistryVersion,
		"tool_runtime_fingerprint.tools_registry_version",
		"tool_runtime_attestation.tools_registry_version",
	);
	assertMatchingString(
		toolRuntimeFingerprint.functionSchemaVersion,
		toolRuntimeAttestation.functionSchemaVersion,
		"tool_runtime_fingerprint.function_schema_version",
		"tool_runtime_attestation.function_schema_version",
	);
	assertMatchingString(
		toolRuntimeFingerprint.workflowArtifactRegistryVersion,
		toolRuntimeAttestation.workflowArtifactRegistryVersion,
		"tool_runtime_fingerprint.workflow_artifact_registry_version",
		"tool_runtime_attestation.workflow_artifact_registry_version",
	);
	return {
		contextEnvelopeSha256: requireSha256Ref(record, "context_envelope_sha256"),
		evidencePacketSha256: requireSha256Ref(record, "evidence_packet_sha256"),
		llmCallSite: requireEnum(
			record,
			"llm_call_site",
			LLM_CALL_SITES,
		) as ToolExecutionLlmIoFingerprint["llmCallSite"],
		memorySelectionSha256: requireSha256Ref(record, "memory_selection_sha256"),
		model: requireNonEmptyString(record, "model"),
		modelParamsHash: requireSha256Ref(record, "model_params_hash"),
		modelParamsProjection,
		outputSchemaId: requireNonEmptyString(record, "output_schema_id"),
		primaryAttestation,
		promptId: requireNonEmptyString(record, "prompt_id"),
		promptRegistryAttestation,
		promptTemplateSha256: requireSha256Ref(record, "prompt_template_sha256"),
		promptVariablesSchemaVersion: requireNonEmptyString(record, "prompt_variables_schema_version"),
		provider: requireNonEmptyString(record, "provider"),
		providerProfileRevision: requireNonEmptyString(record, "provider_profile_revision"),
		providerRequestSafeHash,
		renderedPromptSha256: requireSha256Ref(record, "rendered_prompt_sha256"),
		requestId: requireNonEmptyString(record, "request_id"),
		runId: requireNonEmptyString(record, "run_id"),
		runtimeRelease: requireNonEmptyString(record, "runtime_release"),
		schemaVersion: "llm_io_fingerprint.v1",
		toolCatalogSha256,
		toolRuntimeAttestation,
		toolRuntimeFingerprint,
		toolSchemaSha256,
		traceId: requireNonEmptyString(record, "trace_id"),
		workflowArtifactSha256,
	};
}

function parseModelParamsProjection(
	value: unknown,
): ToolExecutionLlmIoFingerprint["modelParamsProjection"] {
	const record = requireRecord(value, "model_params_projection");
	assertAllowedNestedKeys(
		record,
		MODEL_PARAMS_PROJECTION_FIELDS,
		"observability.llm_io_fingerprint.model_params_projection",
	);
	if (record.schema_version !== "model_params_projection.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.model_params_projection.schema_version is invalid",
		);
	}
	return {
		paramsSchemaVersion: requireNestedString(
			record,
			"model_params_projection.params_schema_version",
		),
		paramsSha256: requireNestedSha256(record, "model_params_projection.params_sha256"),
		projectedParams: parseProjectedModelParams(record.projected_params),
		schemaVersion: "model_params_projection.v1",
	};
}

function parseProjectedModelParams(
	value: unknown,
): ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"] {
	const record = requireRecord(value, "model_params_projection.projected_params");
	assertAllowedNestedKeys(
		record,
		PROJECTED_MODEL_PARAMS_FIELDS,
		"observability.llm_io_fingerprint.model_params_projection.projected_params",
	);
	return {
		maxOutputTokens: optionalPositiveInteger(
			record.max_output_tokens,
			"model_params_projection.projected_params.max_output_tokens",
		),
		reasoningEffort: optionalEnum(
			record.reasoning_effort,
			REASONING_EFFORT_VALUES,
			"model_params_projection.projected_params.reasoning_effort",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["reasoningEffort"],
		responseFormat: optionalEnum(
			record.response_format,
			RESPONSE_FORMAT_VALUES,
			"model_params_projection.projected_params.response_format",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["responseFormat"],
		store: optionalBoolean(record.store, "model_params_projection.projected_params.store"),
		temperature: optionalNumberInRange(
			record.temperature,
			0,
			2,
			"model_params_projection.projected_params.temperature",
		),
		textVerbosity: optionalEnum(
			record.text_verbosity,
			TEXT_VERBOSITY_VALUES,
			"model_params_projection.projected_params.text_verbosity",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["textVerbosity"],
		toolChoice: optionalEnum(
			record.tool_choice,
			TOOL_CHOICE_VALUES,
			"model_params_projection.projected_params.tool_choice",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["toolChoice"],
		topP: optionalNumberInRange(
			record.top_p,
			0,
			1,
			"model_params_projection.projected_params.top_p",
		),
	};
}

function parsePromptRegistryAttestation(
	value: unknown,
): ToolExecutionLlmIoFingerprint["promptRegistryAttestation"] {
	const record = requireRecord(value, "prompt_registry_attestation");
	assertAllowedNestedKeys(
		record,
		PROMPT_REGISTRY_ATTESTATION_FIELDS,
		"observability.llm_io_fingerprint.prompt_registry_attestation",
	);
	if (record.schema_version !== "prompt_registry_attestation.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.prompt_registry_attestation.schema_version is invalid",
		);
	}
	return {
		attestationSha256: requireNestedSha256(
			record,
			"prompt_registry_attestation.attestation_sha256",
		),
		outputSchemaId: requireNestedString(record, "prompt_registry_attestation.output_schema_id"),
		promptId: requireNestedString(record, "prompt_registry_attestation.prompt_id"),
		promptRegistryVersion: requireNestedString(
			record,
			"prompt_registry_attestation.prompt_registry_version",
		),
		promptTemplateSha256: requireNestedSha256(
			record,
			"prompt_registry_attestation.prompt_template_sha256",
		),
		promptVariablesSchemaVersion: requireNestedString(
			record,
			"prompt_registry_attestation.prompt_variables_schema_version",
		),
		schemaVersion: "prompt_registry_attestation.v1",
	};
}

function parseProviderRequestSafeHash(
	value: unknown,
): ToolExecutionLlmIoFingerprint["providerRequestSafeHash"] {
	const record = requireRecord(value, "provider_request_safe_hash");
	assertAllowedNestedKeys(
		record,
		PROVIDER_REQUEST_SAFE_HASH_FIELDS,
		"observability.llm_io_fingerprint.provider_request_safe_hash",
	);
	if (record.schema_version !== "provider_request_safe_hash.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.provider_request_safe_hash.schema_version is invalid",
		);
	}
	if (record.canonicalization !== "canonical_json_redacted_v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.provider_request_safe_hash.canonicalization is invalid",
		);
	}
	if (record.redaction_policy !== "llm_provider_request_safe_projection.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.provider_request_safe_hash.redaction_policy is invalid",
		);
	}
	return {
		canonicalization: "canonical_json_redacted_v1",
		redactionPolicy: "llm_provider_request_safe_projection.v1",
		requestSha256: requireNestedSha256(record, "provider_request_safe_hash.request_sha256"),
		schemaVersion: "provider_request_safe_hash.v1",
	};
}

function parseToolRuntimeFingerprint(
	value: unknown,
): ToolExecutionLlmIoFingerprint["toolRuntimeFingerprint"] {
	const record = getRecord(value);
	if (!record || containsForbiddenLlmIoFingerprintKey(record)) {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.tool_runtime_fingerprint must be a safe object",
		);
	}
	for (const key of Object.keys(record)) {
		if (!TOOL_RUNTIME_FINGERPRINT_FIELDS.has(key)) {
			throw new LlmIoFingerprintContractError(
				`observability.llm_io_fingerprint.tool_runtime_fingerprint.${key} is not allowed`,
			);
		}
	}
	if (record.schema_version !== "tool_runtime_fingerprint.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.tool_runtime_fingerprint.schema_version is invalid",
		);
	}
	const requireToolRuntimeString = (field: string): string => {
		const value = normalizeNullableString(record[field]);
		if (!value) {
			throw new LlmIoFingerprintContractError(
				`observability.llm_io_fingerprint.tool_runtime_fingerprint.${field} is required`,
			);
		}
		return value;
	};
	const requireToolRuntimeSha256 = (field: string): string => {
		const value = requireToolRuntimeString(field);
		if (!isSha256Ref(value)) {
			throw new LlmIoFingerprintContractError(
				`observability.llm_io_fingerprint.tool_runtime_fingerprint.${field} must be a sha256 reference`,
			);
		}
		return value;
	};
	return {
		combinedSha256: requireToolRuntimeSha256("combined_sha256"),
		functionSchemaSha256: requireToolRuntimeSha256("function_schema_sha256"),
		functionSchemaVersion: requireToolRuntimeString("function_schema_version"),
		schemaVersion: "tool_runtime_fingerprint.v1",
		toolsRegistryVersion: requireToolRuntimeString("tools_registry_version"),
		toolsSchemaVersion: requireToolRuntimeString("tools_schema_version"),
		toolsSha256: requireToolRuntimeSha256("tools_sha256"),
		workflowArtifactRegistryVersion: requireToolRuntimeString("workflow_artifact_registry_version"),
		workflowArtifactSchemaVersion: requireToolRuntimeString("workflow_artifact_schema_version"),
		workflowArtifactSha256: requireToolRuntimeSha256("workflow_artifact_sha256"),
	};
}

function parseToolRuntimeAttestation(
	value: unknown,
): ToolExecutionLlmIoFingerprint["toolRuntimeAttestation"] {
	const record = requireRecord(value, "tool_runtime_attestation");
	assertAllowedNestedKeys(
		record,
		TOOL_RUNTIME_ATTESTATION_FIELDS,
		"observability.llm_io_fingerprint.tool_runtime_attestation",
	);
	if (record.schema_version !== "tool_runtime_attestation.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.tool_runtime_attestation.schema_version is invalid",
		);
	}
	return {
		attestedBy: requireNestedString(record, "tool_runtime_attestation.attested_by"),
		combinedSha256: requireNestedSha256(record, "tool_runtime_attestation.combined_sha256"),
		configRefs: parseToolRuntimeConfigRefs(record.config_refs),
		functionSchemaVersion: requireNestedString(
			record,
			"tool_runtime_attestation.function_schema_version",
		),
		schemaVersion: "tool_runtime_attestation.v1",
		toolsRegistryVersion: requireNestedString(
			record,
			"tool_runtime_attestation.tools_registry_version",
		),
		workflowArtifactRegistryVersion: requireNestedString(
			record,
			"tool_runtime_attestation.workflow_artifact_registry_version",
		),
	};
}

function parseToolRuntimeConfigRefs(
	value: unknown,
): ToolExecutionLlmIoFingerprint["toolRuntimeAttestation"]["configRefs"] {
	if (!Array.isArray(value) || value.length !== TOOL_RUNTIME_ATTESTATION_CONFIG_REFS.length) {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.tool_runtime_attestation.config_refs is invalid",
		);
	}
	const values = value.map((item) => normalizeNullableString(item));
	for (const ref of TOOL_RUNTIME_ATTESTATION_CONFIG_REFS) {
		if (!values.includes(ref)) {
			throw new LlmIoFingerprintContractError(
				"observability.llm_io_fingerprint.tool_runtime_attestation.config_refs is invalid",
			);
		}
	}
	if (new Set(values).size !== values.length) {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.tool_runtime_attestation.config_refs is invalid",
		);
	}
	return [...TOOL_RUNTIME_ATTESTATION_CONFIG_REFS];
}

function parsePrimaryAttestation(
	value: unknown,
): ToolExecutionLlmIoFingerprint["primaryAttestation"] {
	const record = requireRecord(value, "primary_attestation");
	assertAllowedNestedKeys(
		record,
		PRIMARY_ATTESTATION_FIELDS,
		"observability.llm_io_fingerprint.primary_attestation",
	);
	if (record.schema_version !== "primary_attestation.v1") {
		throw new LlmIoFingerprintContractError(
			"observability.llm_io_fingerprint.primary_attestation.schema_version is invalid",
		);
	}
	return {
		attestationKind: requireEnum(
			record,
			"primary_attestation.attestation_kind",
			PRIMARY_ATTESTATION_KINDS,
		) as ToolExecutionLlmIoFingerprint["primaryAttestation"]["attestationKind"],
		attestationSha256: requireNestedSha256(record, "primary_attestation.attestation_sha256"),
		attestedBy: requireNestedString(record, "primary_attestation.attested_by"),
		schemaVersion: "primary_attestation.v1",
	};
}

function requireNonEmptyString(
	record: Record<string, unknown>,
	field: (typeof LLM_IO_FINGERPRINT_FIELDS)[number],
): string {
	const value = normalizeNullableString(record[field]);
	if (!value) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} is required`,
		);
	}
	return value;
}

function requireNestedString(record: Record<string, unknown>, field: string): string {
	const key = field.split(".").at(-1) ?? field;
	const value = normalizeNullableString(record[key]);
	if (!value) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} is required`,
		);
	}
	return value;
}

function requireNestedSha256(record: Record<string, unknown>, field: string): string {
	const value = requireNestedString(record, field);
	if (!isSha256Ref(value)) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} must be a sha256 reference`,
		);
	}
	return value;
}

function requireSha256Ref(
	record: Record<string, unknown>,
	field: (typeof LLM_IO_FINGERPRINT_FIELDS)[number],
): string {
	const value = requireNonEmptyString(record, field);
	if (!isSha256Ref(value)) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} must be a sha256 reference`,
		);
	}
	return value;
}

function requireEnum<T extends string>(
	record: Record<string, unknown>,
	field: string,
	allowed: ReadonlySet<T>,
): T {
	const key = field.split(".").at(-1) ?? field;
	const value = normalizeNullableString(record[key]);
	if (!(value && allowed.has(value as T))) {
		throw new LlmIoFingerprintContractError(`observability.llm_io_fingerprint.${field} is invalid`);
	}
	return value as T;
}

function optionalEnum<T extends string>(
	value: unknown,
	allowed: ReadonlySet<T>,
	field: string,
): T | null {
	if (value === null || value === undefined) {
		return null;
	}
	const normalized = normalizeNullableString(value);
	if (!(normalized && allowed.has(normalized as T))) {
		throw new LlmIoFingerprintContractError(`observability.llm_io_fingerprint.${field} is invalid`);
	}
	return normalized as T;
}

function optionalBoolean(value: unknown, field: string): boolean | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "boolean") {
		throw new LlmIoFingerprintContractError(`observability.llm_io_fingerprint.${field} is invalid`);
	}
	return value;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (!Number.isInteger(value) || Number(value) < 1) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} must be a positive integer`,
		);
	}
	return Number(value);
}

function optionalNumberInRange(
	value: unknown,
	min: number,
	max: number,
	field: string,
): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value !== "number" || value < min || value > max) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} is out of range`,
		);
	}
	return value;
}

function assertMatchingFingerprintHash(
	flatValue: string,
	nestedValue: string,
	flatField: string,
	nestedField: string,
): void {
	if (flatValue !== nestedValue) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${flatField} must match tool_runtime_fingerprint.${nestedField}`,
		);
	}
}

function assertMatchingString(
	flatValue: string,
	nestedValue: string,
	flatField: string,
	nestedField: string,
): void {
	if (flatValue !== nestedValue) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${flatField} must match ${nestedField}`,
		);
	}
}

function assertAllowedNestedKeys(
	record: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	context: string,
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			throw new LlmIoFingerprintContractError(`${context}.${key} is not allowed`);
		}
	}
}

function containsForbiddenLlmIoFingerprintKey(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some((item) => containsForbiddenLlmIoFingerprintKey(item));
	}
	const record = getRecord(value);
	if (!record) {
		return false;
	}
	return Object.entries(record).some(([key, item]) => {
		const normalizedKey = normalizeKeyToken(key);
		return (
			FORBIDDEN_LLM_IO_FINGERPRINT_KEY_TOKENS.some((token) =>
				normalizedKey.includes(normalizeKeyToken(token)),
			) || containsForbiddenLlmIoFingerprintKey(item)
		);
	});
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
	const record = getRecord(value);
	if (!record || containsForbiddenLlmIoFingerprintKey(record)) {
		throw new LlmIoFingerprintContractError(
			`observability.llm_io_fingerprint.${field} must be a safe object`,
		);
	}
	return record;
}

function getRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function isSha256Ref(value: string): boolean {
	const hash = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
	return /^[a-f0-9]{64}$/.test(hash);
}

function normalizeKeyToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}
