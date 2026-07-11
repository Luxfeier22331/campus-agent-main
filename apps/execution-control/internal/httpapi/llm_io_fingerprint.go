package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	primaryAgentPromptVariablesSchemaVersion = "final_model_context.v1"
	primaryAgentOutputSchemaID               = "primary_agent_terminal_output.v1"
	promptRegistryVersion                    = "prompt-registry-v1"
	modelParamsSchemaVersion                 = "provider_model_params.v1"
)

var llmIOFingerprintStringFields = []string{
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
	"tool_schema_sha256",
	"tool_runtime_fingerprint",
	"tool_runtime_attestation",
	"workflow_artifact_sha256",
	"context_envelope_sha256",
	"memory_selection_sha256",
	"evidence_packet_sha256",
	"output_schema_id",
	"primary_attestation",
}

var llmIOFingerprintFieldAllowlist = stringBoolSet(llmIOFingerprintStringFields...)

var llmCallSiteAllowlist = map[string]bool{
	"agent.primary": true,
}

var primaryAttestationKindAllowlist = map[string]bool{
	"primary_agent_call": true,
}

var expectedToolRuntimeAttestationConfigRefs = []string{
	"configs/runtime/tools.v4.json",
	"configs/runtime/tool-function-schemas.v1.json",
	"configs/runtime/workflow-artifacts.v2.json",
}

var forbiddenLLMIOFingerprintKeyTokens = []string{
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
}

func primaryAgentLLMIOFingerprint(
	input primaryAgentFingerprintInput,
	output temporalruntime.ExecutePrimaryAgentActivityOutput,
) (map[string]any, error) {
	promptTrace, err := primaryAgentRuntimePromptTrace(output.PromptTrace)
	if err != nil {
		return nil, err
	}
	toolRuntime := cloneAnyMapFromMetadata(output.ToolRuntimeFingerprint)
	if !validToolRuntimeFingerprintShape(toolRuntime) {
		return nil, fmt.Errorf("agent runtime tool_runtime_fingerprint is invalid")
	}
	modelParamsProjection := modelParamsProjection(primaryAgentModelParamsForFingerprint(input.providerConfig))
	return map[string]any{
		"schema_version":                  "llm_io_fingerprint.v1",
		"run_id":                          input.run.RunID,
		"request_id":                      strings.TrimSpace(input.activityInput.RequestID),
		"trace_id":                        strings.TrimSpace(input.activityInput.TraceID),
		"runtime_release":                 defaultString(strings.TrimSpace(input.runtimeRelease), "execution-control@unknown"),
		"llm_call_site":                   "agent.primary",
		"provider_profile_revision":       providerProfileRevisionFingerprint(input.providerConfig),
		"provider":                        strings.TrimSpace(input.providerConfig.Provider),
		"model":                           strings.TrimSpace(input.providerConfig.Model),
		"model_params_hash":               modelParamsProjection["params_sha256"],
		"model_params_projection":         modelParamsProjection,
		"prompt_id":                       promptTrace.promptID,
		"prompt_registry_attestation":     promptRegistryAttestation(promptTrace.promptID, promptTrace.templateSHA256, primaryAgentPromptVariablesSchemaVersion, primaryAgentOutputSchemaID),
		"prompt_template_sha256":          promptTrace.templateSHA256,
		"prompt_variables_schema_version": primaryAgentPromptVariablesSchemaVersion,
		"rendered_prompt_sha256":          promptTrace.renderedSHA256,
		"provider_request_safe_hash":      providerRequestSafeHash(primaryAgentProviderRequestSafeProjection(input, promptTrace, modelParamsProjection, toolRuntime)),
		"tool_catalog_sha256":             stringValue(toolRuntime["tools_sha256"]),
		"tool_schema_sha256":              stringValue(toolRuntime["function_schema_sha256"]),
		"tool_runtime_fingerprint":        toolRuntime,
		"tool_runtime_attestation":        toolRuntimeAttestation("apps/agent-runtime", toolRuntime),
		"workflow_artifact_sha256":        stringValue(toolRuntime["workflow_artifact_sha256"]),
		"context_envelope_sha256":         sha256JSONRef(input.finalModelContext),
		"memory_selection_sha256":         sha256JSONRef(primaryAgentMemoryFingerprint(input.activityInput)),
		"evidence_packet_sha256":          sha256JSONRef(primaryAgentEvidenceFingerprint(input.finalModelContext)),
		"output_schema_id":                primaryAgentOutputSchemaID,
		"primary_attestation":             primaryAttestation("primary_agent_call", "apps/agent-runtime", map[string]any{"prompt_trace": output.PromptTrace, "tool_runtime_fingerprint": toolRuntime}),
	}, nil
}

func primaryAgentSafeLLMIOFingerprint(agentResult map[string]any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(agentResult["llm_io_fingerprint"])
	if !validAllowedMapKeys(source, llmIOFingerprintFieldAllowlist) ||
		containsForbiddenLLMIOFingerprintKey(source) {
		return nil, false
	}
	if stringValue(source["schema_version"]) != "llm_io_fingerprint.v1" {
		return nil, false
	}
	fingerprint := make(map[string]any, len(llmIOFingerprintStringFields))
	for _, field := range llmIOFingerprintStringFields {
		if field == "model_params_projection" ||
			field == "prompt_registry_attestation" ||
			field == "provider_request_safe_hash" ||
			field == "primary_attestation" ||
			field == "tool_runtime_attestation" ||
			field == "tool_runtime_fingerprint" {
			continue
		}
		value := stringValue(source[field])
		if value == "" {
			return nil, false
		}
		if strings.HasSuffix(field, "_sha256") || strings.HasSuffix(field, "_hash") {
			if !validSHA256Ref(value) {
				return nil, false
			}
		}
		if field == "llm_call_site" && !llmCallSiteAllowlist[value] {
			return nil, false
		}
		fingerprint[field] = value
	}
	toolRuntime := cloneAnyMapFromMetadata(source["tool_runtime_fingerprint"])
	if !validSafeToolRuntimeFingerprint(source, toolRuntime) {
		return nil, false
	}
	fingerprint["tool_runtime_fingerprint"] = toolRuntime
	modelParamsProjection, ok := safeModelParamsProjection(source["model_params_projection"])
	if !ok || stringValue(source["model_params_hash"]) != stringValue(modelParamsProjection["params_sha256"]) {
		return nil, false
	}
	fingerprint["model_params_projection"] = modelParamsProjection
	promptRegistryAttestation, ok := safePromptRegistryAttestation(source["prompt_registry_attestation"])
	if !ok {
		return nil, false
	}
	fingerprint["prompt_registry_attestation"] = promptRegistryAttestation
	providerRequestSafeHash, ok := safeProviderRequestSafeHash(source["provider_request_safe_hash"])
	if !ok {
		return nil, false
	}
	fingerprint["provider_request_safe_hash"] = providerRequestSafeHash
	toolRuntimeAttestation, ok := safeToolRuntimeAttestation(source["tool_runtime_attestation"])
	if !ok || !validToolRuntimeAttestationMatches(toolRuntime, toolRuntimeAttestation) {
		return nil, false
	}
	fingerprint["tool_runtime_attestation"] = toolRuntimeAttestation
	primaryAttestation, ok := safePrimaryAttestation(source["primary_attestation"])
	if !ok {
		return nil, false
	}
	fingerprint["primary_attestation"] = primaryAttestation
	return fingerprint, true
}

func validSafeToolRuntimeFingerprint(source map[string]any, toolRuntime map[string]any) bool {
	if !validToolRuntimeFingerprintShape(toolRuntime) {
		return false
	}
	return source["tool_catalog_sha256"] == toolRuntime["tools_sha256"] &&
		source["tool_schema_sha256"] == toolRuntime["function_schema_sha256"] &&
		source["workflow_artifact_sha256"] == toolRuntime["workflow_artifact_sha256"]
}

func validToolRuntimeFingerprintShape(toolRuntime map[string]any) bool {
	if !validAllowedMapKeys(toolRuntime, stringBoolSet(
		"schema_version",
		"tools_schema_version",
		"tools_registry_version",
		"tools_sha256",
		"function_schema_version",
		"function_schema_sha256",
		"workflow_artifact_schema_version",
		"workflow_artifact_registry_version",
		"workflow_artifact_sha256",
		"combined_sha256",
	)) {
		return false
	}
	if toolRuntime["schema_version"] != toolRuntimeFingerprintSchemaVersion {
		return false
	}
	for _, field := range []string{
		"tools_schema_version",
		"tools_registry_version",
		"function_schema_version",
		"workflow_artifact_schema_version",
		"workflow_artifact_registry_version",
	} {
		if stringValue(toolRuntime[field]) == "" {
			return false
		}
	}
	for _, field := range []string{
		"tools_sha256",
		"function_schema_sha256",
		"workflow_artifact_sha256",
		"combined_sha256",
	} {
		if !validSHA256Ref(stringValue(toolRuntime[field])) {
			return false
		}
	}
	return true
}

func safePromptRegistryAttestation(value any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(value)
	if !validAllowedMapKeys(source, stringBoolSet(
		"schema_version",
		"prompt_registry_version",
		"prompt_id",
		"prompt_template_sha256",
		"prompt_variables_schema_version",
		"output_schema_id",
		"attestation_sha256",
	)) ||
		stringValue(source["schema_version"]) != "prompt_registry_attestation.v1" ||
		stringValue(source["prompt_registry_version"]) == "" ||
		stringValue(source["prompt_id"]) == "" ||
		!validSHA256Ref(stringValue(source["prompt_template_sha256"])) ||
		stringValue(source["prompt_variables_schema_version"]) == "" ||
		stringValue(source["output_schema_id"]) == "" ||
		!validSHA256Ref(stringValue(source["attestation_sha256"])) {
		return nil, false
	}
	return map[string]any{
		"schema_version":                  "prompt_registry_attestation.v1",
		"prompt_registry_version":         stringValue(source["prompt_registry_version"]),
		"prompt_id":                       stringValue(source["prompt_id"]),
		"prompt_template_sha256":          stringValue(source["prompt_template_sha256"]),
		"prompt_variables_schema_version": stringValue(source["prompt_variables_schema_version"]),
		"output_schema_id":                stringValue(source["output_schema_id"]),
		"attestation_sha256":              stringValue(source["attestation_sha256"]),
	}, true
}

func safeProviderRequestSafeHash(value any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(value)
	if !validAllowedMapKeys(source, stringBoolSet(
		"schema_version",
		"canonicalization",
		"redaction_policy",
		"request_sha256",
	)) ||
		stringValue(source["schema_version"]) != "provider_request_safe_hash.v1" ||
		stringValue(source["canonicalization"]) != "canonical_json_redacted_v1" ||
		stringValue(source["redaction_policy"]) != "llm_provider_request_safe_projection.v1" ||
		!validSHA256Ref(stringValue(source["request_sha256"])) {
		return nil, false
	}
	return map[string]any{
		"schema_version":   "provider_request_safe_hash.v1",
		"canonicalization": "canonical_json_redacted_v1",
		"redaction_policy": "llm_provider_request_safe_projection.v1",
		"request_sha256":   stringValue(source["request_sha256"]),
	}, true
}

func safeToolRuntimeAttestation(value any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(value)
	if !validAllowedMapKeys(source, stringBoolSet(
		"schema_version",
		"attested_by",
		"config_refs",
		"tools_registry_version",
		"function_schema_version",
		"workflow_artifact_registry_version",
		"combined_sha256",
	)) ||
		stringValue(source["schema_version"]) != "tool_runtime_attestation.v1" ||
		stringValue(source["attested_by"]) == "" ||
		!validToolRuntimeAttestationConfigRefs(source["config_refs"]) ||
		stringValue(source["tools_registry_version"]) == "" ||
		stringValue(source["function_schema_version"]) == "" ||
		stringValue(source["workflow_artifact_registry_version"]) == "" ||
		!validSHA256Ref(stringValue(source["combined_sha256"])) {
		return nil, false
	}
	return map[string]any{
		"schema_version":                     "tool_runtime_attestation.v1",
		"attested_by":                        stringValue(source["attested_by"]),
		"config_refs":                        append([]string{}, expectedToolRuntimeAttestationConfigRefs...),
		"tools_registry_version":             stringValue(source["tools_registry_version"]),
		"function_schema_version":            stringValue(source["function_schema_version"]),
		"workflow_artifact_registry_version": stringValue(source["workflow_artifact_registry_version"]),
		"combined_sha256":                    stringValue(source["combined_sha256"]),
	}, true
}

func validToolRuntimeAttestationMatches(toolRuntime map[string]any, attestation map[string]any) bool {
	return stringValue(toolRuntime["combined_sha256"]) == stringValue(attestation["combined_sha256"]) &&
		stringValue(toolRuntime["tools_registry_version"]) == stringValue(attestation["tools_registry_version"]) &&
		stringValue(toolRuntime["function_schema_version"]) == stringValue(attestation["function_schema_version"]) &&
		stringValue(toolRuntime["workflow_artifact_registry_version"]) == stringValue(attestation["workflow_artifact_registry_version"])
}

func safePrimaryAttestation(value any) (map[string]any, bool) {
	source := cloneAnyMapFromMetadata(value)
	kind := stringValue(source["attestation_kind"])
	if !validAllowedMapKeys(source, stringBoolSet(
		"schema_version",
		"attestation_kind",
		"attested_by",
		"attestation_sha256",
	)) ||
		stringValue(source["schema_version"]) != "primary_attestation.v1" ||
		!primaryAttestationKindAllowlist[kind] ||
		stringValue(source["attested_by"]) == "" ||
		!validSHA256Ref(stringValue(source["attestation_sha256"])) {
		return nil, false
	}
	return map[string]any{
		"schema_version":     "primary_attestation.v1",
		"attestation_kind":   kind,
		"attested_by":        stringValue(source["attested_by"]),
		"attestation_sha256": stringValue(source["attestation_sha256"]),
	}, true
}

func validToolRuntimeAttestationConfigRefs(value any) bool {
	values := llmIOStringSliceFromAny(value)
	if len(values) != len(expectedToolRuntimeAttestationConfigRefs) {
		return false
	}
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			return false
		}
		seen[value] = true
	}
	for _, expected := range expectedToolRuntimeAttestationConfigRefs {
		if !seen[expected] {
			return false
		}
	}
	return true
}

func llmIOStringSliceFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string{}, typed...)
	case []any:
		values := make([]string, 0, len(typed))
		for _, item := range typed {
			text := stringValue(item)
			if text == "" {
				return nil
			}
			values = append(values, text)
		}
		return values
	default:
		return nil
	}
}

func containsForbiddenLLMIOFingerprintKey(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			normalized := normalizedKeyToken(key)
			for _, token := range forbiddenLLMIOFingerprintKeyTokens {
				if strings.Contains(normalized, normalizedKeyToken(token)) {
					return true
				}
			}
			if containsForbiddenLLMIOFingerprintKey(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if containsForbiddenLLMIOFingerprintKey(child) {
				return true
			}
		}
	case []map[string]any:
		for _, child := range typed {
			if containsForbiddenLLMIOFingerprintKey(child) {
				return true
			}
		}
	}
	return false
}

func normalizedKeyToken(value string) string {
	var builder strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func validAllowedMapKeys(value map[string]any, allowed map[string]bool) bool {
	for key := range value {
		if !allowed[key] {
			return false
		}
	}
	return true
}

func stringBoolSet(values ...string) map[string]bool {
	result := make(map[string]bool, len(values))
	for _, value := range values {
		result[value] = true
	}
	return result
}

func positiveIntValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, typed >= 1
	case int64:
		return int(typed), typed >= 1
	case float64:
		intValue := int(typed)
		return intValue, typed == float64(intValue) && intValue >= 1
	default:
		return 0, false
	}
}

func numberInRange(value any, minValue float64, maxValue float64) (float64, bool) {
	switch typed := value.(type) {
	case int:
		number := float64(typed)
		return number, number >= minValue && number <= maxValue
	case int64:
		number := float64(typed)
		return number, number >= minValue && number <= maxValue
	case float64:
		return typed, typed >= minValue && typed <= maxValue
	default:
		return 0, false
	}
}

func validSHA256Ref(value string) bool {
	hashValue := strings.TrimPrefix(strings.TrimSpace(value), "sha256:")
	if len(hashValue) != 64 {
		return false
	}
	for _, char := range hashValue {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

type primaryAgentFingerprintInput struct {
	activityInput     temporalruntime.ExecutePrimaryAgentActivityInput
	finalModelContext map[string]any
	providerConfig    providerConfigSnapshot
	run               execution.DurableRun
	runtimeRelease    string
}

func providerProfileRevisionFingerprint(snapshot providerConfigSnapshot) string {
	parts := []string{
		strings.TrimSpace(snapshot.Role),
		strings.TrimSpace(snapshot.ProfileID),
		strings.TrimSpace(stringFromInt(snapshot.Revision)),
	}
	return strings.Join(parts, ":")
}

type runtimePromptTrace struct {
	promptID       string
	renderedSHA256 string
	templateSHA256 string
}

func primaryAgentRuntimePromptTrace(trace map[string]any) (runtimePromptTrace, error) {
	if stringValue(trace["schema_version"]) != "agent_runtime_prompt_trace.v1" {
		return runtimePromptTrace{}, fmt.Errorf("agent runtime prompt_trace schema_version is invalid")
	}
	promptID := stringValue(trace["prompt_id"])
	templateSHA256 := stringValue(trace["prompt_template_sha256"])
	renderedSHA256 := stringValue(trace["rendered_prompt_sha256"])
	if promptID == "" || !validSHA256Ref(templateSHA256) || !validSHA256Ref(renderedSHA256) {
		return runtimePromptTrace{}, fmt.Errorf("agent runtime prompt_trace is incomplete")
	}
	return runtimePromptTrace{
		promptID:       promptID,
		renderedSHA256: renderedSHA256,
		templateSHA256: templateSHA256,
	}, nil
}

func providerRequestSafeHash(projection map[string]any) map[string]any {
	return map[string]any{
		"schema_version":   "provider_request_safe_hash.v1",
		"canonicalization": "canonical_json_redacted_v1",
		"redaction_policy": "llm_provider_request_safe_projection.v1",
		"request_sha256":   sha256JSONRef(projection),
	}
}

func promptRegistryAttestation(promptID string, templateSHA256 string, variablesSchemaVersion string, outputSchemaID string) map[string]any {
	body := map[string]any{
		"output_schema_id":                strings.TrimSpace(outputSchemaID),
		"prompt_id":                       strings.TrimSpace(promptID),
		"prompt_registry_version":         promptRegistryVersion,
		"prompt_template_sha256":          strings.TrimSpace(templateSHA256),
		"prompt_variables_schema_version": strings.TrimSpace(variablesSchemaVersion),
		"schema_version":                  "prompt_registry_attestation.v1",
	}
	body["attestation_sha256"] = sha256JSONRef(body)
	return body
}

func primaryAttestation(kind string, attestedBy string, body map[string]any) map[string]any {
	attestation := map[string]any{
		"attestation_kind": strings.TrimSpace(kind),
		"attested_by":      strings.TrimSpace(attestedBy),
		"schema_version":   "primary_attestation.v1",
	}
	attestation["attestation_sha256"] = sha256JSONRef(map[string]any{
		"attestation": attestation,
		"body":        body,
	})
	return attestation
}

func toolRuntimeAttestation(attestedBy string, toolRuntime map[string]any) map[string]any {
	return map[string]any{
		"schema_version":                     "tool_runtime_attestation.v1",
		"attested_by":                        strings.TrimSpace(attestedBy),
		"config_refs":                        append([]string{}, expectedToolRuntimeAttestationConfigRefs...),
		"tools_registry_version":             stringValue(toolRuntime["tools_registry_version"]),
		"function_schema_version":            stringValue(toolRuntime["function_schema_version"]),
		"workflow_artifact_registry_version": stringValue(toolRuntime["workflow_artifact_registry_version"]),
		"combined_sha256":                    stringValue(toolRuntime["combined_sha256"]),
	}
}

func primaryAgentProviderRequestSafeProjection(
	input primaryAgentFingerprintInput,
	promptTrace runtimePromptTrace,
	modelParamsProjection map[string]any,
	toolRuntime map[string]any,
) map[string]any {
	return map[string]any{
		"context_envelope_sha256": sha256JSONRef(input.finalModelContext),
		"model":                   strings.TrimSpace(input.providerConfig.Model),
		"model_params_projection": modelParamsProjection,
		"prompt_id":               promptTrace.promptID,
		"rendered_prompt_sha256":  promptTrace.renderedSHA256,
		"tool_runtime_sha256":     stringValue(toolRuntime["combined_sha256"]),
	}
}

func primaryAgentMemoryFingerprint(
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) map[string]any {
	refs := append([]string{}, input.MemoryProjectionRefs...)
	memoryContext := map[string]any{}
	if input.MemoryContext != nil {
		memoryContext = map[string]any{
			"memory_ref":            strings.TrimSpace(input.MemoryContext.MemoryRef),
			"provider":              strings.TrimSpace(input.MemoryContext.Provider),
			"retrieval_mode":        strings.TrimSpace(input.MemoryContext.RetrievalMode),
			"schema_version":        strings.TrimSpace(input.MemoryContext.SchemaVersion),
			"selected_memory_chars": input.MemoryContext.SelectedMemoryChars,
			"selected_memory_count": input.MemoryContext.SelectedMemoryCount,
		}
	}
	return map[string]any{
		"memory_context":         memoryContext,
		"memory_projection_refs": refs,
	}
}

func primaryAgentEvidenceFingerprint(finalModelContext map[string]any) map[string]any {
	if len(finalModelContext) == 0 {
		return map[string]any{"previous_evidence": []any{}}
	}
	return map[string]any{
		"previous_evidence": cloneAnyMapList(anyListFromAny(finalModelContext["previous_evidence"])),
	}
}

func cloneAnyMapList(values []any) []map[string]any {
	result := make([]map[string]any, 0, len(values))
	for _, value := range values {
		result = append(result, cloneAnyMapFromMetadata(value))
	}
	return result
}

func sha256JSONRef(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		raw = []byte("null")
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func sha256TextRef(value string) string {
	sum := sha256.Sum256([]byte(value))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func stringFromInt(value int) string {
	return strconv.Itoa(value)
}
