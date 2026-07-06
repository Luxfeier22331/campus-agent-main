package httpapi

import (
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
)

const (
	ragSynthesisPromptID                     = "rag_synthesis_answer"
	ragSynthesisPromptVersion                = "v1"
	ragSynthesisPromptVariablesSchemaVersion = "rag_synthesis_packet.v1"
	ragSynthesisPromptTemplate               = "You are campus-agent RAG synthesis. Answer only from selected evidence. Return JSON matching the requested schema."
)

type ragSynthesisFingerprintInput struct {
	generationControls      provider.ResponsesGenerationControls
	modelName               string
	modelProvider           string
	packet                  ragSynthesisPacket
	providerProfileRevision string
	renderedInput           []map[string]any
	requestID               string
	run                     execution.DurableRun
	runtimeRelease          string
}

func ragSynthesisPromptTrace(modelProvider string, modelName string) map[string]any {
	return map[string]any{
		"model_name":               strings.TrimSpace(modelName),
		"model_provider":           strings.TrimSpace(modelProvider),
		"output_schema_version":    "v2",
		"prompt_id":                ragSynthesisPromptID,
		"prompt_version":           ragSynthesisPromptVersion,
		"template_sha256":          strings.TrimPrefix(sha256JSONRef(ragSynthesisPromptTemplate), "sha256:"),
		"variables_schema_version": ragSynthesisPromptVariablesSchemaVersion,
	}
}

func ragSynthesisLLMIOFingerprint(input ragSynthesisFingerprintInput) (map[string]any, error) {
	toolRuntime, err := buildToolRuntimeFingerprint(input.runtimeRelease)
	if err != nil {
		return nil, err
	}
	modelParamsProjection := modelParamsProjection(ragSynthesisModelParamsForFingerprint(input))
	toolRuntimeMap := toolRuntime.toMap()
	outputSchemaID := defaultString(strings.TrimSpace(input.packet.OutputSchemaID), "rag_answer_v2")
	return map[string]any{
		"schema_version":                  "llm_io_fingerprint.v1",
		"run_id":                          strings.TrimSpace(input.run.RunID),
		"request_id":                      defaultString(strings.TrimSpace(input.requestID), strings.TrimSpace(input.packet.RequestID)),
		"trace_id":                        strings.TrimSpace(input.run.TraceID),
		"runtime_release":                 defaultString(strings.TrimSpace(input.runtimeRelease), "execution-control@unknown"),
		"llm_call_site":                   "rag.synthesis",
		"provider_profile_revision":       strings.TrimSpace(input.providerProfileRevision),
		"provider":                        strings.TrimSpace(input.modelProvider),
		"model":                           strings.TrimSpace(input.modelName),
		"model_params_hash":               modelParamsProjection["params_sha256"],
		"model_params_projection":         modelParamsProjection,
		"prompt_id":                       ragSynthesisPromptID,
		"prompt_registry_attestation":     promptRegistryAttestation(ragSynthesisPromptID, sha256JSONRef(ragSynthesisPromptTemplate), ragSynthesisPromptVariablesSchemaVersion, outputSchemaID),
		"prompt_template_sha256":          sha256JSONRef(ragSynthesisPromptTemplate),
		"prompt_variables_schema_version": ragSynthesisPromptVariablesSchemaVersion,
		"rendered_prompt_sha256":          sha256JSONRef(input.renderedInput),
		"provider_request_safe_hash":      providerRequestSafeHash(ragSynthesisProviderRequestSafeProjection(input, modelParamsProjection, toolRuntimeMap)),
		"tool_catalog_sha256":             toolRuntime.ToolsSHA256,
		"tool_schema_sha256":              toolRuntime.FunctionSchemaSHA256,
		"tool_runtime_fingerprint":        toolRuntimeMap,
		"tool_runtime_attestation":        toolRuntimeAttestation("apps/execution-control", toolRuntimeMap),
		"workflow_artifact_sha256":        toolRuntime.WorkflowArtifactSHA256,
		"context_envelope_sha256":         sha256JSONRef(ragSynthesisContextEnvelope(input.packet)),
		"memory_selection_sha256":         sha256JSONRef(ragSynthesisMemorySelection(input.packet)),
		"evidence_packet_sha256":          ragSynthesisEvidencePacketHash(input.packet),
		"output_schema_id":                outputSchemaID,
		"primary_attestation":             primaryAttestation("primary_admitted_rag_synthesis", "apps/execution-control", map[string]any{"packet_ref": input.packet.PayloadSHA256, "tool_runtime_fingerprint": toolRuntimeMap}),
	}, nil
}

func ragSynthesisFinalPromptTrace(result ragSynthesisResult) (map[string]any, error) {
	promptTrace := cloneAnyMapFromMetadata(result.PromptTrace)
	if stringValue(promptTrace["prompt_id"]) != ragSynthesisPromptID ||
		stringValue(promptTrace["prompt_version"]) != ragSynthesisPromptVersion ||
		stringValue(promptTrace["variables_schema_version"]) != ragSynthesisPromptVariablesSchemaVersion ||
		stringValue(promptTrace["output_schema_version"]) != "v2" ||
		!validSHA256Ref(stringValue(promptTrace["template_sha256"])) {
		return nil, errors.New("rag synthesis prompt_trace is invalid")
	}
	return promptTrace, nil
}

func ragSynthesisFinalLLMIOFingerprint(
	run execution.DurableRun,
	packet ragSynthesisPacket,
	result ragSynthesisResult,
) (map[string]any, error) {
	fingerprint := cloneAnyMapFromMetadata(result.LLMIOFingerprint)
	if stringValue(fingerprint["schema_version"]) != "llm_io_fingerprint.v1" {
		return nil, errors.New("rag synthesis llm_io_fingerprint is missing")
	}
	fingerprint["run_id"] = strings.TrimSpace(run.RunID)
	fingerprint["request_id"] = defaultString(strings.TrimSpace(run.RequestID), strings.TrimSpace(packet.RequestID))
	fingerprint["trace_id"] = strings.TrimSpace(run.TraceID)
	if _, ok := primaryAgentSafeLLMIOFingerprint(map[string]any{"llm_io_fingerprint": fingerprint}); !ok {
		return nil, errors.New("rag synthesis llm_io_fingerprint is invalid")
	}
	return fingerprint, nil
}

func ragSynthesisModelParamsForFingerprint(input ragSynthesisFingerprintInput) map[string]any {
	projected := map[string]any{
		"model":    strings.TrimSpace(input.modelName),
		"provider": strings.TrimSpace(input.modelProvider),
		"text":     ragProviderTextSchema(input.packet),
	}
	if input.generationControls.MaxOutputTokens > 0 {
		projected["max_output_tokens"] = input.generationControls.MaxOutputTokens
	}
	if value := strings.TrimSpace(input.generationControls.ReasoningEffort); value != "" {
		projected["reasoning_effort"] = value
	}
	if input.generationControls.Store != nil {
		projected["store"] = *input.generationControls.Store
	}
	if value := strings.TrimSpace(input.generationControls.TextVerbosity); value != "" {
		projected["text_verbosity"] = value
	}
	return projected
}

func ragSynthesisProviderRequestSafeProjection(
	input ragSynthesisFingerprintInput,
	modelParamsProjection map[string]any,
	toolRuntime map[string]any,
) map[string]any {
	return map[string]any{
		"context_envelope_sha256": sha256JSONRef(ragSynthesisContextEnvelope(input.packet)),
		"evidence_packet_sha256":  ragSynthesisEvidencePacketHash(input.packet),
		"model":                   strings.TrimSpace(input.modelName),
		"model_params_projection": modelParamsProjection,
		"prompt_id":               ragSynthesisPromptID,
		"rendered_prompt_sha256":  sha256JSONRef(input.renderedInput),
		"tool_runtime_sha256":     stringValue(toolRuntime["combined_sha256"]),
	}
}

func ragSynthesisContextEnvelope(packet ragSynthesisPacket) map[string]any {
	return map[string]any{
		"payload_sha256": strings.TrimSpace(packet.PayloadSHA256),
		"query_intent":   strings.TrimSpace(packet.QueryIntent),
		"request_id":     strings.TrimSpace(packet.RequestID),
		"run_id":         strings.TrimSpace(packet.RunID),
		"step_id":        strings.TrimSpace(packet.StepID),
	}
}

func ragSynthesisMemorySelection(packet ragSynthesisPacket) map[string]any {
	return map[string]any{
		"memory_context":       packet.MemoryContext,
		"memory_context_block": strings.TrimSpace(packet.MemoryContextBlock),
		"memory_ref":           strings.TrimSpace(packet.MemoryRef),
	}
}

func ragSynthesisEvidencePacketHash(packet ragSynthesisPacket) string {
	if strings.TrimSpace(packet.PayloadSHA256) != "" {
		return "sha256:" + strings.TrimPrefix(strings.TrimSpace(packet.PayloadSHA256), "sha256:")
	}
	return sha256JSONRef(map[string]any{
		"previous_evidence_context": packet.PreviousEvidenceContext,
		"selected_evidence":         packet.SelectedEvidence,
	})
}

func defaultStringIfUnknown(value string, fallback string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" || normalized == "unknown" {
		return strings.TrimSpace(fallback)
	}
	return normalized
}
