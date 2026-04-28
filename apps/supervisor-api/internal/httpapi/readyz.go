package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
)

type promptConfigGate struct {
	Admitted                bool   `json:"admitted"`
	Reason                  string `json:"reason"`
	Provider                string `json:"provider"`
	Transport               string `json:"transport"`
	SupervisorModel         string `json:"supervisor_model"`
	AgentModel              string `json:"agent_model"`
	StrictStructuredOutputs bool   `json:"strict_structured_outputs"`
}

func (s *Server) handleReadyz(response http.ResponseWriter, request *http.Request) {
	bridgeConfigured := s.bridge != nil && s.bridge.Configured()
	bridgeReachable := false
	bridgeHealthy := false
	bridgeStatusCode := 0
	bridgeStatus := ""
	bridgeLastError := ""
	readinessBody := map[string]any{}
	bridgeCircuit := s.bridgeBreaker.Snapshot()
	if bridgeConfigured && bridgeCircuit.State == string(bridge.CircuitOpen) {
		bridgeLastError = "Supervisor Python bridge circuit is open."
	} else if bridgeConfigured {
		ctx, cancel := context.WithTimeout(request.Context(), time.Second)
		defer cancel()

		bridgeReadyz, err := s.bridge.Readyz(ctx)
		if err == nil {
			parsedBody, parseErr := decodeJSONObject(bridgeReadyz.Body)
			if parseErr == nil {
				readinessBody = parsedBody
				bridgeReachable = true
				bridgeStatusCode = bridgeReadyz.StatusCode
				bridgeStatus, _ = readinessBody["status"].(string)
				bridgeHealthy = bridgeReadyz.StatusCode == http.StatusOK && bridgeStatus == "ready"
			} else {
				bridgeLastError = "Supervisor Python bridge returned invalid readiness JSON."
			}
		} else {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				bridgeLastError = "Supervisor Python bridge readiness timed out."
			} else {
				bridgeLastError = err.Error()
			}
		}
	}

	transportStatus := s.admission.Status()
	telemetryStatus := s.telemetry.Status()
	executionAuditStatus := s.executionAudit.Status()
	structuredQueryCtx, structuredQueryCancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer structuredQueryCancel()
	structuredQueryStatus := s.structuredQuery.Status(structuredQueryCtx)
	promptGate := evaluatePromptConfigGate(s.config)
	telemetryHealthy := !telemetryStatus.Enabled || telemetryStatus.ExporterConfigured
	executionAuditHealthy := !executionAuditStatus.Enabled || executionAuditStatus.Configured
	structuredRuntimeHealthy := s.openStructuredRuntimeHealthy(structuredQueryStatus)
	ready := bridgeHealthy &&
		transportStatus.Healthy &&
		telemetryHealthy &&
		executionAuditHealthy &&
		structuredRuntimeHealthy &&
		promptGate.Admitted
	statusCode := http.StatusOK
	statusText := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		statusText = "degraded"
	}

	bridgeSnapshot := s.metrics.BridgeRuntimeSnapshot()
	responseBody := map[string]any{
		"status":                   statusText,
		"transport_runtime":        transportStatus,
		"lifecycle_runtime":        s.lifecycle.Snapshot(),
		"telemetry_runtime":        telemetryStatus,
		"execution_audit_runtime":  executionAuditStatus,
		"structured_query_runtime": structuredQueryStatus,
		"capability_gates":         s.capabilityGateStatus(),
		"prompt_config_gate":       promptGate,
		"bridge_runtime": map[string]any{
			"configured": bridgeConfigured,
			"reachable":  bridgeReachable,
			"healthy":    bridgeHealthy,
			"worker_status": defaultString(
				bridgeStatus,
				func() string {
					if bridgeConfigured {
						return "degraded"
					}
					return ""
				}(),
			),
			"status_code":                  bridgeStatusCode,
			"last_error":                   bridgeLastError,
			"last_answer_failure_code":     bridgeSnapshot.LastAnswerFailureCode,
			"last_answer_failure_at":       bridgeSnapshot.LastAnswerFailureAt,
			"last_answer_success_at":       bridgeSnapshot.LastAnswerSuccessAt,
			"circuit_state":                bridgeCircuit.State,
			"circuit_open_until":           bridgeCircuit.OpenUntil,
			"circuit_consecutive_failures": bridgeCircuit.ConsecutiveFailures,
			"circuit_open_count":           bridgeCircuit.OpenCount,
			"circuit_rejected_count":       bridgeCircuit.RejectedCount,
		},
	}
	for _, key := range []string{
		"runtime_provider",
		"supervisor_model",
		"agent_model",
		"prompt_runtime",
		"prompt_http_pool",
	} {
		if value, ok := readinessBody[key]; ok {
			responseBody[key] = value
		}
	}

	writeJSON(response, statusCode, responseBody)
}

func evaluatePromptConfigGate(cfg config.Config) promptConfigGate {
	provider := strings.TrimSpace(cfg.PromptRuntimeProvider)
	transport := defaultString(strings.TrimSpace(cfg.PromptRuntimeTransport), "responses")
	baseURL := strings.TrimSpace(cfg.PromptRuntimeBaseURL)
	supervisorModel := strings.TrimSpace(cfg.SupervisorPromptModel)
	agentModel := strings.TrimSpace(cfg.AgentPromptModel)
	apiKey := strings.TrimSpace(cfg.PromptRuntimeAPIKey)
	reason := ""
	switch {
	case provider == "":
		reason = "prompt_provider_not_configured"
	case agentModel == "":
		reason = "prompt_models_not_configured"
	case !cfg.PromptStrictStructuredOutputs:
		reason = "strict_structured_outputs_disabled"
	case apiKey == "":
		reason = "prompt_api_key_not_configured"
	case transport != "responses":
		reason = "prompt_transport_unsupported"
	case baseURL == "":
		reason = "prompt_base_url_not_configured"
	}
	return promptConfigGate{
		Admitted:                reason == "",
		Reason:                  reason,
		Provider:                provider,
		Transport:               transport,
		SupervisorModel:         supervisorModel,
		AgentModel:              agentModel,
		StrictStructuredOutputs: cfg.PromptStrictStructuredOutputs,
	}
}

func (s *Server) structuredRuntimeGateApplies(capability string) bool {
	return capability == "campus_services" || capability == "notice"
}

func (s *Server) capabilityGateStatus() map[string]any {
	return map[string]any{
		"knowledge": map[string]any{
			"open": true,
			"gate": "always_open",
		},
		"place_lookup": map[string]any{
			"open": false,
			"gate": "deferred_until_map_rollout",
		},
		"campus_services": map[string]any{
			"open": s.config.CapabilityOpen("campus_services"),
			"gate": "structured_runtime",
		},
		"notice": map[string]any{
			"open": s.config.CapabilityOpen("notice"),
			"gate": "structured_runtime",
		},
	}
}

func (s *Server) openStructuredRuntimeHealthy(status structuredquery.Status) bool {
	if s.config.CapabilityOpen("campus_services") &&
		(!status.Configured ||
			!status.ServiceStatusReadModelConfigured ||
			!status.ServiceStatusReadModelHealthy ||
			!status.ServiceStatusProjectionReady ||
			!status.ServiceGuideReadModelConfigured ||
			!status.ServiceGuideReadModelHealthy ||
			!status.ServiceGuideProjectionReady ||
			!status.ContactDirectoryReadModelConfigured ||
			!status.ContactDirectoryReadModelHealthy ||
			!status.ContactDirectoryProjectionReady ||
			!status.TransportScheduleReadModelConfigured ||
			!status.TransportScheduleReadModelHealthy ||
			!status.TransportScheduleImplemented) {
		return false
	}
	if s.config.CapabilityOpen("notice") &&
		(!status.NoticeReadModelConfigured ||
			!status.NoticeBodyStoreConfigured ||
			!status.NoticeReadModelHealthy ||
			!status.NoticeBodyStoreHealthy) {
		return false
	}
	return true
}
