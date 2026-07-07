import type { ToolExecutionLlmIoFingerprint } from "../integration/tool-execution-types";
import {
	assertAllowedKeys,
	normalizeEnum,
	normalizeOptionalBoolean,
	normalizeOptionalEnum,
	normalizeOptionalNumberInRange,
	normalizeOptionalPositiveInteger,
	normalizeRequiredString,
	normalizeSha256Ref,
	requireRecord,
	routeError,
} from "./validation";

const LLM_IO_FINGERPRINT_FIELDS = new Set([
	"context_envelope_sha256",
	"evidence_packet_sha256",
	"llm_call_site",
	"memory_selection_sha256",
	"model",
	"model_params_hash",
	"model_params_projection",
	"output_schema_id",
	"primary_attestation",
	"prompt_id",
	"prompt_registry_attestation",
	"prompt_template_sha256",
	"prompt_variables_schema_version",
	"provider",
	"provider_profile_revision",
	"provider_request_safe_hash",
	"rendered_prompt_sha256",
	"request_id",
	"run_id",
	"runtime_release",
	"schema_version",
	"tool_catalog_sha256",
	"tool_runtime_attestation",
	"tool_runtime_fingerprint",
	"tool_schema_sha256",
	"trace_id",
	"workflow_artifact_sha256",
]);
const LLM_CALL_SITES = new Set(["agent.primary", "rag.synthesis"]);
const PRIMARY_ATTESTATION_KINDS = new Set(["primary_admitted_rag_synthesis", "primary_agent_call"]);
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

export function normalizeLlmIoFingerprint(value: unknown): ToolExecutionLlmIoFingerprint {
	const record = requireRecord(value, "llm_io_fingerprint");
	assertAllowedKeys(record, LLM_IO_FINGERPRINT_FIELDS, "llm_io_fingerprint");
	if (record.schema_version !== "llm_io_fingerprint.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.schema_version is unsupported.",
			status: 422,
		});
	}
	const toolCatalogSha256 = normalizeSha256Ref(
		record.tool_catalog_sha256,
		"llm_io_fingerprint.tool_catalog_sha256",
	);
	const toolSchemaSha256 = normalizeSha256Ref(
		record.tool_schema_sha256,
		"llm_io_fingerprint.tool_schema_sha256",
	);
	const workflowArtifactSha256 = normalizeSha256Ref(
		record.workflow_artifact_sha256,
		"llm_io_fingerprint.workflow_artifact_sha256",
	);
	const toolRuntimeFingerprint = normalizeToolRuntimeFingerprint(record.tool_runtime_fingerprint);
	const modelParamsProjection = normalizeModelParamsProjection(record.model_params_projection);
	const promptRegistryAttestation = normalizePromptRegistryAttestation(
		record.prompt_registry_attestation,
	);
	const providerRequestSafeHash = normalizeProviderRequestSafeHash(
		record.provider_request_safe_hash,
	);
	const toolRuntimeAttestation = normalizeToolRuntimeAttestation(record.tool_runtime_attestation);
	const primaryAttestation = normalizePrimaryAttestation(record.primary_attestation);
	assertMatchingLlmFingerprintHash(
		toolCatalogSha256,
		toolRuntimeFingerprint.toolsSha256,
		"tool_catalog_sha256",
		"tools_sha256",
	);
	assertMatchingLlmFingerprintHash(
		toolSchemaSha256,
		toolRuntimeFingerprint.functionSchemaSha256,
		"tool_schema_sha256",
		"function_schema_sha256",
	);
	assertMatchingLlmFingerprintHash(
		workflowArtifactSha256,
		toolRuntimeFingerprint.workflowArtifactSha256,
		"workflow_artifact_sha256",
		"workflow_artifact_sha256",
	);
	assertMatchingLlmFingerprintHash(
		normalizeSha256Ref(record.model_params_hash, "llm_io_fingerprint.model_params_hash"),
		modelParamsProjection.paramsSha256,
		"model_params_hash",
		"model_params_projection.params_sha256",
	);
	assertMatchingLlmFingerprintHash(
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
		contextEnvelopeSha256: normalizeSha256Ref(
			record.context_envelope_sha256,
			"llm_io_fingerprint.context_envelope_sha256",
		),
		evidencePacketSha256: normalizeSha256Ref(
			record.evidence_packet_sha256,
			"llm_io_fingerprint.evidence_packet_sha256",
		),
		llmCallSite: normalizeEnum(
			record.llm_call_site,
			LLM_CALL_SITES,
			"llm_io_fingerprint.llm_call_site",
		) as ToolExecutionLlmIoFingerprint["llmCallSite"],
		memorySelectionSha256: normalizeSha256Ref(
			record.memory_selection_sha256,
			"llm_io_fingerprint.memory_selection_sha256",
		),
		model: normalizeRequiredString(record.model, "llm_io_fingerprint.model"),
		modelParamsHash: normalizeSha256Ref(
			record.model_params_hash,
			"llm_io_fingerprint.model_params_hash",
		),
		modelParamsProjection,
		outputSchemaId: normalizeRequiredString(
			record.output_schema_id,
			"llm_io_fingerprint.output_schema_id",
		),
		primaryAttestation,
		promptId: normalizeRequiredString(record.prompt_id, "llm_io_fingerprint.prompt_id"),
		promptRegistryAttestation,
		promptTemplateSha256: normalizeSha256Ref(
			record.prompt_template_sha256,
			"llm_io_fingerprint.prompt_template_sha256",
		),
		promptVariablesSchemaVersion: normalizeRequiredString(
			record.prompt_variables_schema_version,
			"llm_io_fingerprint.prompt_variables_schema_version",
		),
		provider: normalizeRequiredString(record.provider, "llm_io_fingerprint.provider"),
		providerProfileRevision: normalizeRequiredString(
			record.provider_profile_revision,
			"llm_io_fingerprint.provider_profile_revision",
		),
		providerRequestSafeHash,
		renderedPromptSha256: normalizeSha256Ref(
			record.rendered_prompt_sha256,
			"llm_io_fingerprint.rendered_prompt_sha256",
		),
		requestId: normalizeRequiredString(record.request_id, "llm_io_fingerprint.request_id"),
		runId: normalizeRequiredString(record.run_id, "llm_io_fingerprint.run_id"),
		runtimeRelease: normalizeRequiredString(
			record.runtime_release,
			"llm_io_fingerprint.runtime_release",
		),
		schemaVersion: "llm_io_fingerprint.v1",
		toolCatalogSha256,
		toolRuntimeAttestation,
		toolRuntimeFingerprint,
		toolSchemaSha256,
		traceId: normalizeRequiredString(record.trace_id, "llm_io_fingerprint.trace_id"),
		workflowArtifactSha256,
	};
}

function normalizeModelParamsProjection(
	value: unknown,
): ToolExecutionLlmIoFingerprint["modelParamsProjection"] {
	const record = requireRecord(value, "llm_io_fingerprint.model_params_projection");
	assertAllowedKeys(
		record,
		MODEL_PARAMS_PROJECTION_FIELDS,
		"llm_io_fingerprint.model_params_projection",
	);
	if (record.schema_version !== "model_params_projection.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.model_params_projection.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		paramsSchemaVersion: normalizeRequiredString(
			record.params_schema_version,
			"llm_io_fingerprint.model_params_projection.params_schema_version",
		),
		paramsSha256: normalizeSha256Ref(
			record.params_sha256,
			"llm_io_fingerprint.model_params_projection.params_sha256",
		),
		projectedParams: normalizeProjectedModelParams(record.projected_params),
		schemaVersion: "model_params_projection.v1",
	};
}

function normalizeProjectedModelParams(
	value: unknown,
): ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"] {
	const record = requireRecord(
		value,
		"llm_io_fingerprint.model_params_projection.projected_params",
	);
	assertAllowedKeys(
		record,
		PROJECTED_MODEL_PARAMS_FIELDS,
		"llm_io_fingerprint.model_params_projection.projected_params",
	);
	return {
		maxOutputTokens: normalizeOptionalPositiveInteger(
			record.max_output_tokens,
			"llm_io_fingerprint.model_params_projection.projected_params.max_output_tokens",
		),
		reasoningEffort: normalizeOptionalEnum(
			record.reasoning_effort,
			REASONING_EFFORT_VALUES,
			"llm_io_fingerprint.model_params_projection.projected_params.reasoning_effort",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["reasoningEffort"],
		responseFormat: normalizeOptionalEnum(
			record.response_format,
			RESPONSE_FORMAT_VALUES,
			"llm_io_fingerprint.model_params_projection.projected_params.response_format",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["responseFormat"],
		store: normalizeOptionalBoolean(
			record.store,
			"llm_io_fingerprint.model_params_projection.projected_params.store",
		),
		temperature: normalizeOptionalNumberInRange(
			record.temperature,
			0,
			2,
			"llm_io_fingerprint.model_params_projection.projected_params.temperature",
		),
		textVerbosity: normalizeOptionalEnum(
			record.text_verbosity,
			TEXT_VERBOSITY_VALUES,
			"llm_io_fingerprint.model_params_projection.projected_params.text_verbosity",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["textVerbosity"],
		toolChoice: normalizeOptionalEnum(
			record.tool_choice,
			TOOL_CHOICE_VALUES,
			"llm_io_fingerprint.model_params_projection.projected_params.tool_choice",
		) as ToolExecutionLlmIoFingerprint["modelParamsProjection"]["projectedParams"]["toolChoice"],
		topP: normalizeOptionalNumberInRange(
			record.top_p,
			0,
			1,
			"llm_io_fingerprint.model_params_projection.projected_params.top_p",
		),
	};
}

function normalizePromptRegistryAttestation(
	value: unknown,
): ToolExecutionLlmIoFingerprint["promptRegistryAttestation"] {
	const record = requireRecord(value, "llm_io_fingerprint.prompt_registry_attestation");
	assertAllowedKeys(
		record,
		PROMPT_REGISTRY_ATTESTATION_FIELDS,
		"llm_io_fingerprint.prompt_registry_attestation",
	);
	if (record.schema_version !== "prompt_registry_attestation.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.prompt_registry_attestation.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		attestationSha256: normalizeSha256Ref(
			record.attestation_sha256,
			"llm_io_fingerprint.prompt_registry_attestation.attestation_sha256",
		),
		outputSchemaId: normalizeRequiredString(
			record.output_schema_id,
			"llm_io_fingerprint.prompt_registry_attestation.output_schema_id",
		),
		promptId: normalizeRequiredString(
			record.prompt_id,
			"llm_io_fingerprint.prompt_registry_attestation.prompt_id",
		),
		promptRegistryVersion: normalizeRequiredString(
			record.prompt_registry_version,
			"llm_io_fingerprint.prompt_registry_attestation.prompt_registry_version",
		),
		promptTemplateSha256: normalizeSha256Ref(
			record.prompt_template_sha256,
			"llm_io_fingerprint.prompt_registry_attestation.prompt_template_sha256",
		),
		promptVariablesSchemaVersion: normalizeRequiredString(
			record.prompt_variables_schema_version,
			"llm_io_fingerprint.prompt_registry_attestation.prompt_variables_schema_version",
		),
		schemaVersion: "prompt_registry_attestation.v1",
	};
}

function normalizeProviderRequestSafeHash(
	value: unknown,
): ToolExecutionLlmIoFingerprint["providerRequestSafeHash"] {
	const record = requireRecord(value, "llm_io_fingerprint.provider_request_safe_hash");
	assertAllowedKeys(
		record,
		PROVIDER_REQUEST_SAFE_HASH_FIELDS,
		"llm_io_fingerprint.provider_request_safe_hash",
	);
	if (record.schema_version !== "provider_request_safe_hash.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.provider_request_safe_hash.schema_version is unsupported.",
			status: 422,
		});
	}
	if (record.canonicalization !== "canonical_json_redacted_v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.provider_request_safe_hash.canonicalization is unsupported.",
			status: 422,
		});
	}
	if (record.redaction_policy !== "llm_provider_request_safe_projection.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.provider_request_safe_hash.redaction_policy is unsupported.",
			status: 422,
		});
	}
	return {
		canonicalization: "canonical_json_redacted_v1",
		redactionPolicy: "llm_provider_request_safe_projection.v1",
		requestSha256: normalizeSha256Ref(
			record.request_sha256,
			"llm_io_fingerprint.provider_request_safe_hash.request_sha256",
		),
		schemaVersion: "provider_request_safe_hash.v1",
	};
}

function normalizeToolRuntimeFingerprint(
	value: unknown,
): ToolExecutionLlmIoFingerprint["toolRuntimeFingerprint"] {
	const record = requireRecord(value, "llm_io_fingerprint.tool_runtime_fingerprint");
	assertAllowedKeys(
		record,
		TOOL_RUNTIME_FINGERPRINT_FIELDS,
		"llm_io_fingerprint.tool_runtime_fingerprint",
	);
	if (record.schema_version !== "tool_runtime_fingerprint.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.tool_runtime_fingerprint.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		combinedSha256: normalizeSha256Ref(
			record.combined_sha256,
			"llm_io_fingerprint.tool_runtime_fingerprint.combined_sha256",
		),
		functionSchemaSha256: normalizeSha256Ref(
			record.function_schema_sha256,
			"llm_io_fingerprint.tool_runtime_fingerprint.function_schema_sha256",
		),
		functionSchemaVersion: normalizeRequiredString(
			record.function_schema_version,
			"llm_io_fingerprint.tool_runtime_fingerprint.function_schema_version",
		),
		schemaVersion: "tool_runtime_fingerprint.v1",
		toolsRegistryVersion: normalizeRequiredString(
			record.tools_registry_version,
			"llm_io_fingerprint.tool_runtime_fingerprint.tools_registry_version",
		),
		toolsSchemaVersion: normalizeRequiredString(
			record.tools_schema_version,
			"llm_io_fingerprint.tool_runtime_fingerprint.tools_schema_version",
		),
		toolsSha256: normalizeSha256Ref(
			record.tools_sha256,
			"llm_io_fingerprint.tool_runtime_fingerprint.tools_sha256",
		),
		workflowArtifactRegistryVersion: normalizeRequiredString(
			record.workflow_artifact_registry_version,
			"llm_io_fingerprint.tool_runtime_fingerprint.workflow_artifact_registry_version",
		),
		workflowArtifactSchemaVersion: normalizeRequiredString(
			record.workflow_artifact_schema_version,
			"llm_io_fingerprint.tool_runtime_fingerprint.workflow_artifact_schema_version",
		),
		workflowArtifactSha256: normalizeSha256Ref(
			record.workflow_artifact_sha256,
			"llm_io_fingerprint.tool_runtime_fingerprint.workflow_artifact_sha256",
		),
	};
}

function normalizeToolRuntimeAttestation(
	value: unknown,
): ToolExecutionLlmIoFingerprint["toolRuntimeAttestation"] {
	const record = requireRecord(value, "llm_io_fingerprint.tool_runtime_attestation");
	assertAllowedKeys(
		record,
		TOOL_RUNTIME_ATTESTATION_FIELDS,
		"llm_io_fingerprint.tool_runtime_attestation",
	);
	if (record.schema_version !== "tool_runtime_attestation.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.tool_runtime_attestation.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		attestedBy: normalizeRequiredString(
			record.attested_by,
			"llm_io_fingerprint.tool_runtime_attestation.attested_by",
		),
		combinedSha256: normalizeSha256Ref(
			record.combined_sha256,
			"llm_io_fingerprint.tool_runtime_attestation.combined_sha256",
		),
		configRefs: normalizeToolRuntimeConfigRefs(record.config_refs),
		functionSchemaVersion: normalizeRequiredString(
			record.function_schema_version,
			"llm_io_fingerprint.tool_runtime_attestation.function_schema_version",
		),
		schemaVersion: "tool_runtime_attestation.v1",
		toolsRegistryVersion: normalizeRequiredString(
			record.tools_registry_version,
			"llm_io_fingerprint.tool_runtime_attestation.tools_registry_version",
		),
		workflowArtifactRegistryVersion: normalizeRequiredString(
			record.workflow_artifact_registry_version,
			"llm_io_fingerprint.tool_runtime_attestation.workflow_artifact_registry_version",
		),
	};
}

function normalizeToolRuntimeConfigRefs(
	value: unknown,
): ToolExecutionLlmIoFingerprint["toolRuntimeAttestation"]["configRefs"] {
	if (!Array.isArray(value) || value.length !== TOOL_RUNTIME_ATTESTATION_CONFIG_REFS.length) {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.tool_runtime_attestation.config_refs is invalid.",
			status: 422,
		});
	}
	const values = value.map((item) =>
		normalizeRequiredString(item, "llm_io_fingerprint.tool_runtime_attestation.config_refs"),
	);
	for (const ref of TOOL_RUNTIME_ATTESTATION_CONFIG_REFS) {
		if (!values.includes(ref)) {
			throw routeError({
				code: "validation_failed",
				message: "llm_io_fingerprint.tool_runtime_attestation.config_refs is invalid.",
				status: 422,
			});
		}
	}
	if (new Set(values).size !== values.length) {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.tool_runtime_attestation.config_refs is invalid.",
			status: 422,
		});
	}
	return [...TOOL_RUNTIME_ATTESTATION_CONFIG_REFS];
}

function normalizePrimaryAttestation(
	value: unknown,
): ToolExecutionLlmIoFingerprint["primaryAttestation"] {
	const record = requireRecord(value, "llm_io_fingerprint.primary_attestation");
	assertAllowedKeys(record, PRIMARY_ATTESTATION_FIELDS, "llm_io_fingerprint.primary_attestation");
	if (record.schema_version !== "primary_attestation.v1") {
		throw routeError({
			code: "validation_failed",
			message: "llm_io_fingerprint.primary_attestation.schema_version is unsupported.",
			status: 422,
		});
	}
	return {
		attestationKind: normalizeEnum(
			record.attestation_kind,
			PRIMARY_ATTESTATION_KINDS,
			"llm_io_fingerprint.primary_attestation.attestation_kind",
		) as ToolExecutionLlmIoFingerprint["primaryAttestation"]["attestationKind"],
		attestationSha256: normalizeSha256Ref(
			record.attestation_sha256,
			"llm_io_fingerprint.primary_attestation.attestation_sha256",
		),
		attestedBy: normalizeRequiredString(
			record.attested_by,
			"llm_io_fingerprint.primary_attestation.attested_by",
		),
		schemaVersion: "primary_attestation.v1",
	};
}

function assertMatchingLlmFingerprintHash(
	flatValue: string,
	nestedValue: string,
	flatField: string,
	nestedField: string,
): void {
	if (flatValue !== nestedValue) {
		throw routeError({
			code: "validation_failed",
			message: `llm_io_fingerprint.${flatField} must match tool_runtime_fingerprint.${nestedField}.`,
			status: 422,
		});
	}
}

function assertMatchingString(
	flatValue: string,
	nestedValue: string,
	flatField: string,
	nestedField: string,
): void {
	if (flatValue !== nestedValue) {
		throw routeError({
			code: "validation_failed",
			message: `llm_io_fingerprint.${flatField} must match ${nestedField}.`,
			status: 422,
		});
	}
}
