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
	SchemaVersion  string                   `json:"schema_version"`
	Mode           string                   `json:"mode"`
	IncludeModelIO bool                     `json:"include_model_io"`
	SampleRatio    float64                  `json:"sample_ratio"`
	LangfuseOTLP   *llmDebugTraceOTLPConfig `json:"langfuse_otlp,omitempty"`
}

type llmDebugTraceOTLPConfig struct {
	Endpoint           string `json:"endpoint"`
	AuthHeader         string `json:"auth_header"`
	PublicTraceBaseURL string `json:"public_trace_base_url,omitempty"`
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
	if value.IncludeModelIO {
		return errors.New("llm debug trace include_model_io must be false")
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

func requireSecureSecretProjectionFile(path string, label string) error {
	fileInfo, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat %s: %w", label, err)
	}
	if !fileInfo.Mode().IsRegular() {
		return fmt.Errorf("%s path must be a regular file", label)
	}
	if fileInfo.Mode().Perm() != 0o600 {
		return fmt.Errorf("%s file permissions must be 0600", label)
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
