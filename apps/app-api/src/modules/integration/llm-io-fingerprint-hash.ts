import { createHash } from "node:crypto";

import type { ToolExecutionLlmIoFingerprint } from "./tool-execution-types";

export function llmIoFingerprintSha256(input: ToolExecutionLlmIoFingerprint): string {
	return sha256JsonRef(toContractLlmIoFingerprint(input));
}

export function sha256JsonRef(value: unknown): string {
	return `sha256:${createHash("sha256").update(stableJsonStringify(value)).digest("hex")}`;
}

export function stableJsonStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
		.join(",")}}`;
}

function toContractLlmIoFingerprint(input: ToolExecutionLlmIoFingerprint): Record<string, unknown> {
	return {
		schema_version: input.schemaVersion,
		run_id: input.runId,
		request_id: input.requestId,
		trace_id: input.traceId,
		runtime_release: input.runtimeRelease,
		llm_call_site: input.llmCallSite,
		provider_profile_revision: input.providerProfileRevision,
		provider: input.provider,
		model: input.model,
		model_params_hash: input.modelParamsHash,
		model_params_projection: {
			schema_version: input.modelParamsProjection.schemaVersion,
			params_schema_version: input.modelParamsProjection.paramsSchemaVersion,
			params_sha256: input.modelParamsProjection.paramsSha256,
			projected_params: {
				max_output_tokens: input.modelParamsProjection.projectedParams.maxOutputTokens ?? null,
				reasoning_effort: input.modelParamsProjection.projectedParams.reasoningEffort ?? null,
				response_format: input.modelParamsProjection.projectedParams.responseFormat ?? null,
				store: input.modelParamsProjection.projectedParams.store ?? null,
				temperature: input.modelParamsProjection.projectedParams.temperature ?? null,
				text_verbosity: input.modelParamsProjection.projectedParams.textVerbosity ?? null,
				tool_choice: input.modelParamsProjection.projectedParams.toolChoice ?? null,
				top_p: input.modelParamsProjection.projectedParams.topP ?? null,
			},
		},
		prompt_id: input.promptId,
		prompt_registry_attestation: {
			schema_version: input.promptRegistryAttestation.schemaVersion,
			prompt_registry_version: input.promptRegistryAttestation.promptRegistryVersion,
			prompt_id: input.promptRegistryAttestation.promptId,
			prompt_template_sha256: input.promptRegistryAttestation.promptTemplateSha256,
			prompt_variables_schema_version: input.promptRegistryAttestation.promptVariablesSchemaVersion,
			output_schema_id: input.promptRegistryAttestation.outputSchemaId,
			attestation_sha256: input.promptRegistryAttestation.attestationSha256,
		},
		prompt_template_sha256: input.promptTemplateSha256,
		prompt_variables_schema_version: input.promptVariablesSchemaVersion,
		rendered_prompt_sha256: input.renderedPromptSha256,
		provider_request_safe_hash: {
			schema_version: input.providerRequestSafeHash.schemaVersion,
			canonicalization: input.providerRequestSafeHash.canonicalization,
			redaction_policy: input.providerRequestSafeHash.redactionPolicy,
			request_sha256: input.providerRequestSafeHash.requestSha256,
		},
		tool_catalog_sha256: input.toolCatalogSha256,
		tool_schema_sha256: input.toolSchemaSha256,
		tool_runtime_fingerprint: {
			schema_version: input.toolRuntimeFingerprint.schemaVersion,
			tools_schema_version: input.toolRuntimeFingerprint.toolsSchemaVersion,
			tools_registry_version: input.toolRuntimeFingerprint.toolsRegistryVersion,
			tools_sha256: input.toolRuntimeFingerprint.toolsSha256,
			function_schema_version: input.toolRuntimeFingerprint.functionSchemaVersion,
			function_schema_sha256: input.toolRuntimeFingerprint.functionSchemaSha256,
			workflow_artifact_schema_version: input.toolRuntimeFingerprint.workflowArtifactSchemaVersion,
			workflow_artifact_registry_version:
				input.toolRuntimeFingerprint.workflowArtifactRegistryVersion,
			workflow_artifact_sha256: input.toolRuntimeFingerprint.workflowArtifactSha256,
			combined_sha256: input.toolRuntimeFingerprint.combinedSha256,
		},
		tool_runtime_attestation: {
			schema_version: input.toolRuntimeAttestation.schemaVersion,
			attested_by: input.toolRuntimeAttestation.attestedBy,
			config_refs: input.toolRuntimeAttestation.configRefs,
			tools_registry_version: input.toolRuntimeAttestation.toolsRegistryVersion,
			function_schema_version: input.toolRuntimeAttestation.functionSchemaVersion,
			workflow_artifact_registry_version:
				input.toolRuntimeAttestation.workflowArtifactRegistryVersion,
			combined_sha256: input.toolRuntimeAttestation.combinedSha256,
		},
		workflow_artifact_sha256: input.workflowArtifactSha256,
		context_envelope_sha256: input.contextEnvelopeSha256,
		memory_selection_sha256: input.memorySelectionSha256,
		evidence_packet_sha256: input.evidencePacketSha256,
		output_schema_id: input.outputSchemaId,
		primary_attestation: {
			schema_version: input.primaryAttestation.schemaVersion,
			attestation_kind: input.primaryAttestation.attestationKind,
			attested_by: input.primaryAttestation.attestedBy,
			attestation_sha256: input.primaryAttestation.attestationSha256,
		},
	};
}
