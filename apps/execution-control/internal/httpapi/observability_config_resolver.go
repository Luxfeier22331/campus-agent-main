package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

type llmDebugTraceConfig struct {
	SchemaVersion    string                   `json:"schema_version"`
	Mode             string                   `json:"mode"`
	IncludeModelIO   bool                     `json:"include_model_io"`
	SampleRatio      float64                  `json:"sample_ratio"`
	RawCapturePolicy *rawCapturePolicy        `json:"raw_capture_policy,omitempty"`
	LangfuseOTLP     *llmDebugTraceOTLPConfig `json:"langfuse_otlp,omitempty"`
}

type llmDebugTraceOTLPConfig struct {
	Endpoint           string `json:"endpoint"`
	AuthHeader         string `json:"auth_header"`
	PublicTraceBaseURL string `json:"public_trace_base_url,omitempty"`
}

type rawCapturePolicy struct {
	SchemaVersion             string   `json:"schema_version"`
	Mode                      string   `json:"mode"`
	CaptureReason             string   `json:"capture_reason"`
	TTLDays                   int      `json:"ttl_days"`
	AllowedSinks              []string `json:"allowed_sinks"`
	AllowedRawFields          []string `json:"allowed_raw_fields"`
	OperatorPrincipal         *string  `json:"operator_principal"`
	ApprovalRef               *string  `json:"approval_ref"`
	RequestID                 *string  `json:"request_id"`
	RunID                     *string  `json:"run_id"`
	TraceID                   *string  `json:"trace_id"`
	AuditRequired             bool     `json:"audit_required"`
	DSARDeleteLinkageRequired bool     `json:"dsar_delete_linkage_required"`
}

type rawCapturePolicyScope struct {
	RequestID string
	RunID     string
	TraceID   string
}

type observabilityConfigResolver interface {
	ResolveLLMDebugTraceConfig(context.Context) (llmDebugTraceConfig, error)
}

type fileObservabilityConfigResolver struct {
	path string
}

var errObservabilityConfigResolverNotConfigured = errors.New("observability config resolver is not configured")

func newObservabilityConfigResolver(cfg config.Config) (observabilityConfigResolver, error) {
	path := strings.TrimSpace(cfg.ObservabilityConfigProjectionPath)
	if path == "" {
		return nil, errObservabilityConfigResolverNotConfigured
	}
	return fileObservabilityConfigResolver{path: path}, nil
}

func (resolver fileObservabilityConfigResolver) ResolveLLMDebugTraceConfig(
	ctx context.Context,
) (llmDebugTraceConfig, error) {
	_ = ctx
	if strings.TrimSpace(resolver.path) == "" {
		return llmDebugTraceConfig{}, errObservabilityConfigResolverNotConfigured
	}
	data, err := os.ReadFile(resolver.path)
	if err != nil {
		return llmDebugTraceConfig{}, fmt.Errorf("read observability config projection: %w", err)
	}
	var payload struct {
		SchemaVersion string              `json:"schema_version"`
		LLMDebugTrace llmDebugTraceConfig `json:"llm_debug_trace"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return llmDebugTraceConfig{}, fmt.Errorf("decode observability config projection: %w", err)
	}
	if payload.SchemaVersion != "observability_config_projection.v1" {
		return llmDebugTraceConfig{}, errors.New("observability config projection schema_version is unsupported")
	}
	if err := validateLLMDebugTraceConfig(payload.LLMDebugTrace); err != nil {
		return llmDebugTraceConfig{}, err
	}
	if payload.LLMDebugTrace.LangfuseOTLP != nil &&
		strings.TrimSpace(payload.LLMDebugTrace.LangfuseOTLP.AuthHeader) != "" {
		if err := requireSecureSecretProjectionFile(resolver.path, "observability config projection"); err != nil {
			return llmDebugTraceConfig{}, err
		}
	}
	return payload.LLMDebugTrace, nil
}

func validateLLMDebugTraceConfig(value llmDebugTraceConfig) error {
	if strings.TrimSpace(value.SchemaVersion) != "llm_debug_trace_config.v1" {
		return errors.New("llm debug trace config schema_version is unsupported")
	}
	mode := strings.TrimSpace(value.Mode)
	if mode != "off" && mode != "langfuse_otlp" {
		return errors.New("llm debug trace config mode must be off or langfuse_otlp")
	}
	if err := validateRawModelIOAdmission(value); err != nil {
		return err
	}
	if value.SampleRatio < 0 || value.SampleRatio > 1 {
		return errors.New("llm debug trace sample_ratio must be between 0 and 1")
	}
	if mode == "off" {
		return nil
	}
	if value.LangfuseOTLP == nil {
		return errors.New("llm debug trace langfuse_otlp config is required")
	}
	if strings.TrimSpace(value.LangfuseOTLP.Endpoint) == "" {
		return errors.New("llm debug trace langfuse_otlp.endpoint is required")
	}
	if strings.TrimSpace(value.LangfuseOTLP.AuthHeader) == "" {
		return errors.New("llm debug trace langfuse_otlp.auth_header is required")
	}
	if !strings.HasPrefix(strings.TrimSpace(value.LangfuseOTLP.AuthHeader), "Basic ") {
		return errors.New("llm debug trace langfuse_otlp.auth_header must use Basic auth")
	}
	if !strings.HasSuffix(strings.TrimRight(strings.TrimSpace(value.LangfuseOTLP.Endpoint), "/"), "/api/public/otel") {
		return errors.New("llm debug trace langfuse_otlp.endpoint must end with /api/public/otel")
	}
	return nil
}

var allowedRawCapturePolicyModes = map[string]bool{
	"eval_case":          true,
	"failure_triggered":  true,
	"manual_run_capture": true,
	"off":                true,
	"operator_window":    true,
	"sampled":            true,
}

var allowedRawCaptureSinks = map[string]bool{
	"langfuse_otlp":       true,
	"openai_agents_trace": true,
	"s3_replay_packet":    true,
}

var allowedRawCaptureFields = map[string]bool{
	"output_schema":            true,
	"provider_request_body":    true,
	"provider_response_body":   true,
	"provider_stream_deltas":   true,
	"rendered_messages":        true,
	"selected_evidence_packet": true,
	"selected_memory_context":  true,
	"tool_calls":               true,
	"tool_results":             true,
}

var modelIORawCaptureSinks = map[string]bool{
	"langfuse_otlp":       true,
	"openai_agents_trace": true,
}

var modelIORawCaptureFields = map[string]bool{
	"provider_request_body":  true,
	"provider_response_body": true,
	"provider_stream_deltas": true,
	"rendered_messages":      true,
}

func validateRawModelIOAdmission(value llmDebugTraceConfig) error {
	if !value.IncludeModelIO {
		if value.RawCapturePolicy != nil {
			return validateRawCapturePolicy(*value.RawCapturePolicy)
		}
		return nil
	}
	if value.RawCapturePolicy == nil {
		return errors.New("llm debug trace include_model_io requires raw_capture_policy")
	}
	if err := validateRawCapturePolicy(*value.RawCapturePolicy); err != nil {
		return err
	}
	if value.RawCapturePolicy.Mode == "off" {
		return errors.New("llm debug trace include_model_io requires admitted raw_capture_policy")
	}
	if !containsAllowed(value.RawCapturePolicy.AllowedSinks, modelIORawCaptureSinks) {
		return errors.New("llm debug trace include_model_io requires model IO raw capture sink")
	}
	if !containsAllowed(value.RawCapturePolicy.AllowedRawFields, modelIORawCaptureFields) {
		return errors.New("llm debug trace include_model_io requires raw model IO field")
	}
	return nil
}

func validateRawCapturePolicy(policy rawCapturePolicy) error {
	if strings.TrimSpace(policy.SchemaVersion) != "raw_capture_policy.v1" {
		return errors.New("raw_capture_policy schema_version is unsupported")
	}
	mode := strings.TrimSpace(policy.Mode)
	if !allowedRawCapturePolicyModes[mode] {
		return errors.New("raw_capture_policy mode is unsupported")
	}
	if strings.TrimSpace(policy.CaptureReason) == "" {
		return errors.New("raw_capture_policy capture_reason is required")
	}
	if err := validateStringSet(policy.AllowedSinks, allowedRawCaptureSinks, "raw_capture_policy allowed_sinks"); err != nil {
		return err
	}
	if err := validateStringSet(policy.AllowedRawFields, allowedRawCaptureFields, "raw_capture_policy allowed_raw_fields"); err != nil {
		return err
	}
	if mode == "off" {
		if policy.TTLDays != 0 ||
			len(policy.AllowedSinks) != 0 ||
			len(policy.AllowedRawFields) != 0 ||
			policy.OperatorPrincipal != nil ||
			policy.ApprovalRef != nil ||
			policy.RequestID != nil ||
			policy.RunID != nil ||
			policy.TraceID != nil ||
			policy.AuditRequired ||
			policy.DSARDeleteLinkageRequired {
			return errors.New("raw_capture_policy mode off must not admit raw capture")
		}
		return nil
	}
	if policy.TTLDays <= 0 {
		return errors.New("raw_capture_policy ttl_days must be positive when mode is not off")
	}
	if len(policy.AllowedSinks) == 0 {
		return errors.New("raw_capture_policy allowed_sinks must not be empty when mode is not off")
	}
	if len(policy.AllowedRawFields) == 0 {
		return errors.New("raw_capture_policy allowed_raw_fields must not be empty when mode is not off")
	}
	if policy.OperatorPrincipal == nil || strings.TrimSpace(*policy.OperatorPrincipal) == "" ||
		policy.ApprovalRef == nil || strings.TrimSpace(*policy.ApprovalRef) == "" {
		return errors.New("raw_capture_policy requires operator_principal and approval_ref when mode is not off")
	}
	if !policy.AuditRequired || !policy.DSARDeleteLinkageRequired {
		return errors.New("raw_capture_policy requires audit and deletion linkage when mode is not off")
	}
	if policy.RequestID == nil || strings.TrimSpace(*policy.RequestID) == "" ||
		policy.RunID == nil || strings.TrimSpace(*policy.RunID) == "" ||
		policy.TraceID == nil || strings.TrimSpace(*policy.TraceID) == "" {
		return errors.New("raw_capture_policy requires request_id, run_id, and trace_id when mode is not off")
	}
	return nil
}

func llmDebugTraceConfigForScope(
	config llmDebugTraceConfig,
	scope rawCapturePolicyScope,
) (llmDebugTraceConfig, error) {
	if err := validateLLMDebugTraceConfig(config); err != nil {
		return llmDebugTraceConfig{}, err
	}
	policy := config.RawCapturePolicy
	if policy == nil || strings.TrimSpace(policy.Mode) == "" || strings.TrimSpace(policy.Mode) == "off" {
		config.IncludeModelIO = false
		return config, nil
	}
	if err := validateRawCapturePolicyScope(*policy, scope); err != nil {
		return llmDebugTraceConfig{}, err
	}
	return config, nil
}

func validateRawCapturePolicyScope(policy rawCapturePolicy, scope rawCapturePolicyScope) error {
	if strings.TrimSpace(policy.Mode) == "off" {
		return nil
	}
	checks := []struct {
		field    string
		actual   *string
		expected string
	}{
		{field: "request_id", actual: policy.RequestID, expected: scope.RequestID},
		{field: "run_id", actual: policy.RunID, expected: scope.RunID},
		{field: "trace_id", actual: policy.TraceID, expected: scope.TraceID},
	}
	for _, check := range checks {
		if check.actual == nil || strings.TrimSpace(*check.actual) != strings.TrimSpace(check.expected) {
			return fmt.Errorf("raw_capture_policy %s must match request scope", check.field)
		}
	}
	return nil
}

func validateStringSet(values []string, allowed map[string]bool, label string) error {
	seen := map[string]bool{}
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if !allowed[value] {
			return fmt.Errorf("%s contains unsupported value: %s", label, value)
		}
		if seen[value] {
			return fmt.Errorf("%s contains duplicate value: %s", label, value)
		}
		seen[value] = true
	}
	return nil
}

func containsAllowed(values []string, allowed map[string]bool) bool {
	for _, value := range values {
		if allowed[strings.TrimSpace(value)] {
			return true
		}
	}
	return false
}

func requireSecureSecretProjectionFile(path string, label string) error {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat %s: %w", label, err)
	}
	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("%s path must be a regular file", label)
	}
	permissions := fileInfo.Mode().Perm()
	if permissions != 0o600 && permissions != 0o440 {
		return fmt.Errorf("%s file permissions must be 0600 or 0440", label)
	}
	return nil
}

func (s *Server) resolveLLMDebugTraceConfig(ctx context.Context) (llmDebugTraceConfig, error) {
	if s.observabilityConfigErr != nil &&
		!errors.Is(s.observabilityConfigErr, errObservabilityConfigResolverNotConfigured) {
		return llmDebugTraceConfig{}, s.observabilityConfigErr
	}
	if s.observabilityConfigResolver == nil {
		return llmDebugTraceConfig{}, errObservabilityConfigResolverNotConfigured
	}
	return s.observabilityConfigResolver.ResolveLLMDebugTraceConfig(ctx)
}
