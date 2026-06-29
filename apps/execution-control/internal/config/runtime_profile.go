package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const runtimeConfigProfileSchemaVersion = "campus_execution_control_runtime_profile.v1"

type runtimeConfigProfile struct {
	SchemaVersion            string                          `json:"schema_version"`
	MaxConcurrentAnswers     *int                            `json:"max_concurrent_answers,omitempty"`
	QueueCapacity            *int                            `json:"queue_capacity,omitempty"`
	QueueTimeoutMS           *int                            `json:"queue_timeout_ms,omitempty"`
	RequestTimeoutMS         *int                            `json:"request_timeout_ms,omitempty"`
	RequestBodyLimitBytes    *int64                          `json:"request_body_limit_bytes,omitempty"`
	ShutdownGraceMS          *int                            `json:"shutdown_grace_ms,omitempty"`
	IntentPolicyPath         *string                         `json:"intent_policy_path,omitempty"`
	ProviderPricingPath      *string                         `json:"provider_pricing_path,omitempty"`
	QueryServingScopesPath   *string                         `json:"query_serving_scopes_path,omitempty"`
	ToolReadModelTimeoutMS   *int                            `json:"tool_read_model_timeout_ms,omitempty"`
	OpenTools                []string                        `json:"open_tools,omitempty"`
	MultiStepWorkflowEnabled *bool                           `json:"multi_step_workflow_enabled,omitempty"`
	OTel                     *runtimeConfigProfileOTel       `json:"otel,omitempty"`
	ExecutionAudit           *runtimeConfigProfileAudit      `json:"execution_audit,omitempty"`
	RAG                      *runtimeConfigProfileRAG        `json:"rag,omitempty"`
	PersonalMemory           *runtimeConfigProfileMemory     `json:"personal_memory,omitempty"`
	WorkerProfiles           map[string]runtimeProfileWorker `json:"worker_profiles,omitempty"`
}

type runtimeConfigProfileOTel struct {
	Enabled                  *bool    `json:"enabled,omitempty"`
	Endpoint                 *string  `json:"endpoint,omitempty"`
	MetricsEnabled           *bool    `json:"metrics_enabled,omitempty"`
	MetricsEndpoint          *string  `json:"metrics_endpoint,omitempty"`
	Headers                  *string  `json:"headers,omitempty"`
	ServiceName              *string  `json:"service_name,omitempty"`
	ExportTimeoutMS          *int     `json:"export_timeout_ms,omitempty"`
	ExportIntervalMS         *int     `json:"export_interval_ms,omitempty"`
	SampleRatio              *float64 `json:"sample_ratio,omitempty"`
	AllowedAttributesVersion *string  `json:"allowed_attributes_version,omitempty"`
	TemporalTracingEnabled   *bool    `json:"temporal_tracing_enabled,omitempty"`
}

type runtimeConfigProfileAudit struct {
	Enabled      *bool   `json:"enabled,omitempty"`
	URL          *string `json:"url,omitempty"`
	SharedSecret *string `json:"shared_secret,omitempty"`
	TimeoutMS    *int    `json:"timeout_ms,omitempty"`
}

type runtimeConfigProfileRAG struct {
	TopKMax                *int                                        `json:"top_k_max,omitempty"`
	SelectedEvidenceMax    *int                                        `json:"selected_evidence_max,omitempty"`
	RetrievalMaxConcurrent *int                                        `json:"retrieval_max_concurrent,omitempty"`
	SynthesisMaxConcurrent *int                                        `json:"synthesis_max_concurrent,omitempty"`
	EmbeddingTimeoutMS     *int                                        `json:"embedding_timeout_ms,omitempty"`
	QdrantTimeoutMS        *int                                        `json:"qdrant_timeout_ms,omitempty"`
	ProviderTimeoutMS      *int                                        `json:"provider_timeout_ms,omitempty"`
	SynthesisGeneration    *runtimeConfigProfileRAGSynthesisGeneration `json:"synthesis_generation,omitempty"`
}

type runtimeConfigProfileRAGSynthesisGeneration struct {
	MaxOutputTokens     *int    `json:"max_output_tokens,omitempty"`
	ReasoningEffort     *string `json:"reasoning_effort,omitempty"`
	StoreProviderOutput *bool   `json:"store_provider_output,omitempty"`
	TextVerbosity       *string `json:"text_verbosity,omitempty"`
}

type runtimeConfigProfileMemory struct {
	Runtime           *string  `json:"runtime,omitempty"`
	TimeoutSeconds    *float64 `json:"timeout_seconds,omitempty"`
	RecallLimit       *int     `json:"recall_limit,omitempty"`
	RecallMaxTokens   *int     `json:"recall_max_tokens,omitempty"`
	ContextCharBudget *int     `json:"context_char_budget,omitempty"`
}

type runtimeProfileWorker struct {
	ActivitySlots                *int     `json:"activity_slots,omitempty"`
	ActivityTaskPollers          *int     `json:"activity_task_pollers,omitempty"`
	TaskQueueActivitiesPerSecond *float64 `json:"task_queue_activities_per_second,omitempty"`
	WorkerActivitiesPerSecond    *float64 `json:"worker_activities_per_second,omitempty"`
	WorkflowTaskSlots            *int     `json:"workflow_task_slots,omitempty"`
	WorkflowTaskPollers          *int     `json:"workflow_task_pollers,omitempty"`
}

func loadRuntimeConfigProfileFromEnv() (runtimeConfigProfile, error) {
	path := strings.TrimSpace(os.Getenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH"))
	if path == "" {
		return runtimeConfigProfile{}, fmt.Errorf("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH is required")
	}
	file, err := os.Open(path)
	if err != nil {
		return runtimeConfigProfile{}, fmt.Errorf("open EXECUTION_CONTROL_RUNTIME_CONFIG_PATH: %w", err)
	}
	defer func() { _ = file.Close() }()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	profile := runtimeConfigProfile{}
	if err := decoder.Decode(&profile); err != nil {
		return runtimeConfigProfile{}, fmt.Errorf("decode execution-control runtime profile: %w", err)
	}
	if strings.TrimSpace(profile.SchemaVersion) != runtimeConfigProfileSchemaVersion {
		return runtimeConfigProfile{}, fmt.Errorf(
			"execution-control runtime profile schema_version must be %s",
			runtimeConfigProfileSchemaVersion,
		)
	}
	if err := validateRuntimeConfigProfileCompleteness(profile); err != nil {
		return runtimeConfigProfile{}, err
	}
	return profile, nil
}

func validateRuntimeConfigProfileCompleteness(profile runtimeConfigProfile) error {
	requiredInts := []struct {
		name  string
		value *int
	}{
		{"max_concurrent_answers", profile.MaxConcurrentAnswers},
		{"queue_capacity", profile.QueueCapacity},
		{"queue_timeout_ms", profile.QueueTimeoutMS},
		{"request_timeout_ms", profile.RequestTimeoutMS},
		{"shutdown_grace_ms", profile.ShutdownGraceMS},
		{"tool_read_model_timeout_ms", profile.ToolReadModelTimeoutMS},
	}
	for _, item := range requiredInts {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime profile missing required field %s", item.name)
		}
	}
	if profile.RequestBodyLimitBytes == nil {
		return fmt.Errorf("execution-control runtime profile missing required field request_body_limit_bytes")
	}
	requiredStrings := []struct {
		name  string
		value *string
	}{
		{"intent_policy_path", profile.IntentPolicyPath},
		{"provider_pricing_path", profile.ProviderPricingPath},
		{"query_serving_scopes_path", profile.QueryServingScopesPath},
	}
	for _, item := range requiredStrings {
		if item.value == nil || strings.TrimSpace(*item.value) == "" {
			return fmt.Errorf("execution-control runtime profile missing required field %s", item.name)
		}
	}
	if profile.OpenTools == nil {
		return fmt.Errorf("execution-control runtime profile missing required field open_tools")
	}
	if profile.MultiStepWorkflowEnabled == nil {
		return fmt.Errorf("execution-control runtime profile missing required field multi_step_workflow_enabled")
	}
	if err := validateRuntimeConfigProfileOTelCompleteness(profile.OTel); err != nil {
		return err
	}
	if err := validateRuntimeConfigProfileAuditCompleteness(profile.ExecutionAudit); err != nil {
		return err
	}
	if err := validateRuntimeConfigProfileRAGCompleteness(profile.RAG); err != nil {
		return err
	}
	if err := validateRuntimeConfigProfileMemoryCompleteness(profile.PersonalMemory); err != nil {
		return err
	}
	return nil
}

func validateRuntimeConfigProfileOTelCompleteness(value *runtimeConfigProfileOTel) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime profile missing required field otel")
	}
	requiredBools := []struct {
		name  string
		value *bool
	}{
		{"otel.enabled", value.Enabled},
		{"otel.metrics_enabled", value.MetricsEnabled},
		{"otel.temporal_tracing_enabled", value.TemporalTracingEnabled},
	}
	for _, item := range requiredBools {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime profile missing required field %s", item.name)
		}
	}
	requiredStrings := []struct {
		name  string
		value *string
	}{
		{"otel.endpoint", value.Endpoint},
		{"otel.metrics_endpoint", value.MetricsEndpoint},
		{"otel.service_name", value.ServiceName},
		{"otel.allowed_attributes_version", value.AllowedAttributesVersion},
	}
	for _, item := range requiredStrings {
		if item.value == nil || strings.TrimSpace(*item.value) == "" {
			return fmt.Errorf("execution-control runtime profile missing required field %s", item.name)
		}
	}
	requiredInts := []struct {
		name  string
		value *int
	}{
		{"otel.export_timeout_ms", value.ExportTimeoutMS},
		{"otel.export_interval_ms", value.ExportIntervalMS},
	}
	for _, item := range requiredInts {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime profile missing required field %s", item.name)
		}
	}
	if value.SampleRatio == nil {
		return fmt.Errorf("execution-control runtime profile missing required field otel.sample_ratio")
	}
	return nil
}

func validateRuntimeConfigProfileAuditCompleteness(value *runtimeConfigProfileAudit) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime profile missing required field execution_audit")
	}
	if value.Enabled == nil {
		return fmt.Errorf("execution-control runtime profile missing required field execution_audit.enabled")
	}
	if value.TimeoutMS == nil {
		return fmt.Errorf("execution-control runtime profile missing required field execution_audit.timeout_ms")
	}
	return nil
}

func validateRuntimeConfigProfileRAGCompleteness(value *runtimeConfigProfileRAG) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime profile missing required field rag")
	}
	required := []struct {
		name  string
		value *int
	}{
		{"top_k_max", value.TopKMax},
		{"selected_evidence_max", value.SelectedEvidenceMax},
		{"retrieval_max_concurrent", value.RetrievalMaxConcurrent},
		{"synthesis_max_concurrent", value.SynthesisMaxConcurrent},
		{"embedding_timeout_ms", value.EmbeddingTimeoutMS},
		{"qdrant_timeout_ms", value.QdrantTimeoutMS},
		{"provider_timeout_ms", value.ProviderTimeoutMS},
	}
	for _, item := range required {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime profile missing required rag.%s", item.name)
		}
	}
	if err := validateRuntimeConfigProfileRAGSynthesisGenerationCompleteness(value.SynthesisGeneration); err != nil {
		return err
	}
	return nil
}

func validateRuntimeConfigProfileRAGSynthesisGenerationCompleteness(
	value *runtimeConfigProfileRAGSynthesisGeneration,
) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime profile missing required field rag.synthesis_generation")
	}
	if value.MaxOutputTokens == nil {
		return fmt.Errorf("execution-control runtime profile missing required rag.synthesis_generation.max_output_tokens")
	}
	if value.ReasoningEffort == nil || strings.TrimSpace(*value.ReasoningEffort) == "" {
		return fmt.Errorf("execution-control runtime profile missing required rag.synthesis_generation.reasoning_effort")
	}
	if value.StoreProviderOutput == nil {
		return fmt.Errorf("execution-control runtime profile missing required rag.synthesis_generation.store_provider_output")
	}
	if value.TextVerbosity == nil || strings.TrimSpace(*value.TextVerbosity) == "" {
		return fmt.Errorf("execution-control runtime profile missing required rag.synthesis_generation.text_verbosity")
	}
	return nil
}

func validateRuntimeConfigProfileMemoryCompleteness(value *runtimeConfigProfileMemory) error {
	if value == nil {
		return fmt.Errorf("execution-control runtime profile missing required field personal_memory")
	}
	if value.Runtime == nil || strings.TrimSpace(*value.Runtime) == "" {
		return fmt.Errorf("execution-control runtime profile missing required personal_memory.runtime")
	}
	if strings.TrimSpace(*value.Runtime) != "hindsight" {
		return fmt.Errorf("execution-control runtime profile personal_memory.runtime must be hindsight")
	}
	requiredInts := []struct {
		name  string
		value *int
	}{
		{"recall_limit", value.RecallLimit},
		{"recall_max_tokens", value.RecallMaxTokens},
		{"context_char_budget", value.ContextCharBudget},
	}
	for _, item := range requiredInts {
		if item.value == nil {
			return fmt.Errorf("execution-control runtime profile missing required personal_memory.%s", item.name)
		}
	}
	if value.TimeoutSeconds == nil {
		return fmt.Errorf("execution-control runtime profile missing required personal_memory.timeout_seconds")
	}
	return nil
}

func applyRuntimeConfigProfileValues(values envValues, profile runtimeConfigProfile) envValues {
	applyInt(&values.MaxConcurrentAnswers, profile.MaxConcurrentAnswers)
	applyInt(&values.QueueCapacity, profile.QueueCapacity)
	applyInt(&values.QueueTimeoutMS, profile.QueueTimeoutMS)
	applyInt(&values.RequestTimeoutMS, profile.RequestTimeoutMS)
	applyInt64(&values.RequestBodyLimitBytes, profile.RequestBodyLimitBytes)
	applyInt(&values.ShutdownGraceMS, profile.ShutdownGraceMS)
	applyString(&values.IntentPolicyPath, profile.IntentPolicyPath)
	applyString(&values.ProviderPricingPath, profile.ProviderPricingPath)
	applyString(&values.QueryServingScopesPath, profile.QueryServingScopesPath)
	applyInt(&values.ToolReadModelTimeoutMS, profile.ToolReadModelTimeoutMS)
	if profile.OTel != nil {
		applyString(&values.OTelEndpoint, profile.OTel.Endpoint)
		applyString(&values.OTelMetricsEndpoint, profile.OTel.MetricsEndpoint)
		applyString(&values.OTelHeaders, profile.OTel.Headers)
		applyString(&values.OTelServiceName, profile.OTel.ServiceName)
		applyInt(&values.OTelExportTimeoutMS, profile.OTel.ExportTimeoutMS)
		applyInt(&values.OTelExportIntervalMS, profile.OTel.ExportIntervalMS)
		applyFloat64(&values.OTelSampleRatio, profile.OTel.SampleRatio)
		applyString(&values.OTelAllowedAttributesVersion, profile.OTel.AllowedAttributesVersion)
		values.TemporalTracingEnabled = boolFromRuntimeProfile(
			profile.OTel.TemporalTracingEnabled,
			values.TemporalTracingEnabled,
		)
	}
	if profile.ExecutionAudit != nil {
		applyString(&values.ExecutionAuditURL, profile.ExecutionAudit.URL)
		applyString(&values.ExecutionAuditSharedSecret, profile.ExecutionAudit.SharedSecret)
		applyInt(&values.ExecutionAuditTimeoutMS, profile.ExecutionAudit.TimeoutMS)
	}
	if profile.RAG != nil {
		applyInt(&values.RAGTopKMax, profile.RAG.TopKMax)
		applyInt(&values.RAGSelectedEvidenceMax, profile.RAG.SelectedEvidenceMax)
		applyInt(&values.RAGRetrievalMaxConcurrent, profile.RAG.RetrievalMaxConcurrent)
		applyInt(&values.RAGSynthesisMaxConcurrent, profile.RAG.SynthesisMaxConcurrent)
		applyInt(&values.RAGEmbeddingTimeoutMS, profile.RAG.EmbeddingTimeoutMS)
		applyInt(&values.RAGQdrantTimeoutMS, profile.RAG.QdrantTimeoutMS)
		applyInt(&values.RAGProviderTimeoutMS, profile.RAG.ProviderTimeoutMS)
		if profile.RAG.SynthesisGeneration != nil {
			applyInt(&values.RAGSynthesisMaxOutputTokens, profile.RAG.SynthesisGeneration.MaxOutputTokens)
			applyString(&values.RAGSynthesisReasoningEffort, profile.RAG.SynthesisGeneration.ReasoningEffort)
			values.RAGSynthesisStoreProviderOutput = boolFromRuntimeProfile(
				profile.RAG.SynthesisGeneration.StoreProviderOutput,
				values.RAGSynthesisStoreProviderOutput,
			)
			applyString(&values.RAGSynthesisTextVerbosity, profile.RAG.SynthesisGeneration.TextVerbosity)
		}
	}
	if profile.PersonalMemory != nil {
		applyString(&values.PersonalMemoryRuntime, profile.PersonalMemory.Runtime)
		applyFloat64(&values.PersonalMemoryTimeoutSeconds, profile.PersonalMemory.TimeoutSeconds)
		applyInt(&values.PersonalMemoryRecallLimit, profile.PersonalMemory.RecallLimit)
		applyInt(&values.PersonalMemoryRecallMaxTokens, profile.PersonalMemory.RecallMaxTokens)
		applyInt(&values.PersonalMemoryContextCharBudget, profile.PersonalMemory.ContextCharBudget)
	}
	return values
}

func applyRuntimeConfigProfileWorkerProfiles(
	profiles map[string]WorkerProfile,
	profile runtimeConfigProfile,
) (map[string]WorkerProfile, error) {
	for role, override := range profile.WorkerProfiles {
		current, ok := profiles[role]
		if !ok {
			return nil, fmt.Errorf("runtime profile worker_profiles contains unsupported role %q", role)
		}
		applyInt(&current.ActivitySlots, override.ActivitySlots)
		applyInt(&current.ActivityTaskPollers, override.ActivityTaskPollers)
		applyFloat64(&current.TaskQueueActivitiesPerSecond, override.TaskQueueActivitiesPerSecond)
		applyFloat64(&current.WorkerActivitiesPerSecond, override.WorkerActivitiesPerSecond)
		applyInt(&current.WorkflowTaskSlots, override.WorkflowTaskSlots)
		applyInt(&current.WorkflowTaskPollers, override.WorkflowTaskPollers)
		if current.ActivityTaskPollers > 0 && current.ActivitySlots <= 0 {
			return nil, fmt.Errorf("runtime profile worker %s activity_slots must be positive when pollers are configured", role)
		}
		if current.WorkflowTaskPollers > 0 && current.WorkflowTaskSlots <= 0 {
			return nil, fmt.Errorf("runtime profile worker %s workflow_task_slots must be positive when pollers are configured", role)
		}
		profiles[role] = current
	}
	return profiles, nil
}

func applyInt(target *int, value *int) {
	if value != nil {
		*target = *value
	}
}

func applyInt64(target *int64, value *int64) {
	if value != nil {
		*target = *value
	}
}

func applyFloat64(target *float64, value *float64) {
	if value != nil {
		*target = *value
	}
}

func applyString(target *string, value *string) {
	if value != nil {
		*target = strings.TrimSpace(*value)
	}
}

func boolFromRuntimeProfile(value *bool, defaultValue bool) bool {
	if value != nil {
		return *value
	}
	return defaultValue
}

func rejectRuntimeProfileOwnedEnvSettings() error {
	retired := []string{
		"EXECUTION_CONTROL_INTENT_POLICY_PATH",
		"EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS",
		"EXECUTION_CONTROL_QUEUE_CAPACITY",
		"EXECUTION_CONTROL_QUEUE_TIMEOUT_MS",
		"EXECUTION_CONTROL_REQUEST_TIMEOUT_MS",
		"EXECUTION_CONTROL_REQUEST_BODY_LIMIT_BYTES",
		"EXECUTION_CONTROL_SHUTDOWN_GRACE_MS",
		"EXECUTION_CONTROL_QUERY_SERVING_SCOPES_PATH",
		"EXECUTION_CONTROL_OPEN_TOOLS",
		"EXECUTION_CONTROL_MULTI_STEP_WORKFLOW_ENABLED",
		"EXECUTION_CONTROL_OTEL_ENABLED",
		"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_ENDPOINT",
		"EXECUTION_CONTROL_OTEL_METRICS_ENABLED",
		"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
		"EXECUTION_CONTROL_OTEL_SERVICE_NAME",
		"EXECUTION_CONTROL_OTEL_EXPORT_TIMEOUT_MS",
		"EXECUTION_CONTROL_OTEL_EXPORT_INTERVAL_MS",
		"EXECUTION_CONTROL_OTEL_SAMPLE_RATIO",
		"EXECUTION_CONTROL_OTEL_ALLOWED_ATTRIBUTES_VERSION",
		"EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED",
		"EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS",
		"EXECUTION_CONTROL_PROVIDER_PRICING_PATH",
		"EXECUTION_CONTROL_RAG_TOP_K_MAX",
		"EXECUTION_CONTROL_RAG_SELECTED_EVIDENCE_MAX",
		"EXECUTION_CONTROL_RAG_RETRIEVAL_MAX_CONCURRENT",
		"EXECUTION_CONTROL_RAG_SYNTHESIS_MAX_CONCURRENT",
		"EXECUTION_CONTROL_RAG_EMBEDDING_TIMEOUT_MS",
		"EXECUTION_CONTROL_RAG_QDRANT_TIMEOUT_MS",
		"EXECUTION_CONTROL_RAG_PROVIDER_TIMEOUT_MS",
		"PERSONAL_MEMORY_COLLECTION",
		"PERSONAL_MEMORY_TOP_K",
		"PERSONAL_MEMORY_MAX_CHARS",
		"PERSONAL_MEMORY_SCORE_THRESHOLD",
		"PERSONAL_MEMORY_RUNTIME",
		"PERSONAL_MEMORY_TIMEOUT_SECONDS",
		"PERSONAL_MEMORY_RECALL_LIMIT",
		"PERSONAL_MEMORY_RECALL_MAX_CHARS",
		"PERSONAL_MEMORY_RECALL_MAX_TOKENS",
		"PERSONAL_MEMORY_CONTEXT_CHAR_BUDGET",
	}
	for _, name := range retired {
		if strings.TrimSpace(os.Getenv(name)) != "" {
			return fmt.Errorf("%s is retired; use EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", name)
		}
	}
	if err := rejectEnvPrefix("EXECUTION_CONTROL_LANE_"); err != nil {
		return err
	}
	for _, role := range []string{
		"WORKFLOW",
		"ACTIVITY_CONTEXT",
		"ACTIVITY_AGENT",
		"ACTIVITY_KNOWLEDGE_PLAN",
		"ACTIVITY_KNOWLEDGE_RETRIEVAL",
		"ACTIVITY_KNOWLEDGE_SYNTHESIS",
		"ACTIVITY_CAMPUS_SERVICES",
		"ACTIVITY_NOTICE",
		"ACTIVITY_NAVIGATION",
		"ACTIVITY_FINALIZATION",
	} {
		if err := rejectEnvPrefix("EXECUTION_CONTROL_WORKER_" + role + "_"); err != nil {
			return err
		}
	}
	return nil
}

func rejectEnvPrefix(prefix string) error {
	for _, item := range os.Environ() {
		key, _, _ := strings.Cut(item, "=")
		if strings.HasPrefix(key, prefix) && strings.TrimSpace(os.Getenv(key)) != "" {
			return fmt.Errorf("%s is retired; use EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", key)
		}
	}
	return nil
}
