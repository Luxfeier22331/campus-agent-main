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
	if !s.readinessAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid readiness auth.", false)
		return
	}
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
				bridgeLastError = "Supervisor Python bridge readiness check failed."
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
	workflowRunStatus := s.workflowRunStoreStatus(request.Context())
	durableWorkerLoopStatus := s.durableWorkerLoopStatus()
	durableRecoveryLoopStatus := s.durableRecoveryLoopStatus()
	promptGate := evaluatePromptConfigGate(s.config)
	telemetryHealthy := !telemetryStatus.Enabled || telemetryStatus.ExporterConfigured
	executionAuditHealthy := !executionAuditStatus.Enabled || executionAuditStatus.Configured
	structuredRuntimeHealthy := s.openStructuredRuntimeHealthy(structuredQueryStatus)
	workflowRuntimeHealthy := !s.config.MultiStepWorkflowEnabled || workflowRunStatus["healthy"] == true
	durableRuntimeStatus := s.durableRuntimeStatus(request.Context())
	durableWorkerLoopHealthy := durableWorkerLoopStatus["healthy"] == true
	durableRecoveryLoopHealthy := durableRecoveryLoopStatus["healthy"] == true
	ready := bridgeHealthy &&
		transportStatus.Healthy &&
		telemetryHealthy &&
		executionAuditHealthy &&
		structuredRuntimeHealthy &&
		workflowRuntimeHealthy &&
		durableRuntimeStatus["healthy"] == true &&
		durableWorkerLoopHealthy &&
		durableRecoveryLoopHealthy &&
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
		"workflow_run_runtime":     workflowRunStatus,
		"durable_runtime":          durableRuntimeStatus,
		"durable_worker_loop":      durableWorkerLoopStatus,
		"durable_recovery_loop":    durableRecoveryLoopStatus,
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

func (s *Server) workflowRunStoreStatus(ctx context.Context) map[string]any {
	configured := s.workflowRuns != nil
	status := map[string]any{
		"configured": configured,
		"enabled":    s.config.MultiStepWorkflowEnabled,
		"healthy":    !s.config.MultiStepWorkflowEnabled,
		"last_error": "",
	}
	if s.workflowRunsErr != nil {
		status["last_error"] = "workflow run store could not be initialized"
		return status
	}
	if !configured {
		if s.config.MultiStepWorkflowEnabled {
			status["last_error"] = "workflow run store is required when multi-step workflow is enabled"
		}
		return status
	}
	checker, ok := s.workflowRuns.(interface{ HealthCheck(context.Context) error })
	if !ok {
		status["healthy"] = true
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		status["last_error"] = "workflow run store health check failed"
		return status
	}
	status["healthy"] = true
	return status
}

func (s *Server) durableRuntimeStatus(ctx context.Context) map[string]any {
	configured := s.durableRuntime != nil
	status := map[string]any{
		"configured": configured,
		"healthy":    true,
		"last_error": "",
	}
	if s.durableRuntimeErr != nil {
		status["healthy"] = false
		status["last_error"] = "durable runtime store could not be initialized"
		return status
	}
	if !configured {
		return status
	}
	checker, ok := s.durableRuntime.(interface{ HealthCheck(context.Context) error })
	if !ok {
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		status["healthy"] = false
		status["last_error"] = "durable runtime store health check failed"
		return status
	}
	return status
}

func (s *Server) durableWorkerLoopStatus() map[string]any {
	status := map[string]any{
		"enabled":           s.config.DurableWorkerLoopEnabled,
		"configured":        s.durableWorkerLoop != nil,
		"healthy":           true,
		"last_error":        "",
		"worker_id":         "",
		"lane":              "",
		"step_id":           "",
		"started":           false,
		"last_outcome":      "",
		"last_run_id":       "",
		"last_lease_id":     "",
		"last_iteration_at": "",
	}
	if !s.config.DurableWorkerLoopEnabled {
		return status
	}
	if s.durableWorkerLoopErr != nil {
		status["healthy"] = false
		status["last_error"] = "durable worker loop could not be configured"
		return status
	}
	if s.durableWorkerLoop == nil {
		status["healthy"] = false
		status["last_error"] = "durable worker loop is enabled but not configured"
		return status
	}
	loopStatus := s.durableWorkerLoop.Status()
	status["worker_id"] = loopStatus.WorkerID
	status["lane"] = string(loopStatus.Lane)
	status["step_id"] = loopStatus.StepID
	status["started"] = loopStatus.Started
	status["last_outcome"] = string(loopStatus.LastOutcome)
	status["last_run_id"] = loopStatus.LastRunID
	status["last_lease_id"] = loopStatus.LastLeaseID
	status["healthy"] = loopStatus.Healthy
	if loopStatus.LastError != "" {
		status["last_error"] = "durable worker loop iteration failed"
	}
	if !loopStatus.LastIterationAt.IsZero() {
		status["last_iteration_at"] = loopStatus.LastIterationAt.UTC().Format(time.RFC3339Nano)
	}
	return status
}

func (s *Server) durableRecoveryLoopStatus() map[string]any {
	status := map[string]any{
		"enabled":             s.config.DurableRecoveryLoopEnabled,
		"configured":          s.durableRecoveryLoop != nil,
		"healthy":             true,
		"last_error":          "",
		"started":             false,
		"last_iteration_at":   "",
		"last_expired_leases": 0,
		"last_timed_out_runs": 0,
	}
	if !s.config.DurableRecoveryLoopEnabled {
		return status
	}
	if s.durableRecoveryLoopErr != nil {
		status["healthy"] = false
		status["last_error"] = "durable recovery loop could not be configured"
		return status
	}
	if s.durableRecoveryLoop == nil {
		status["healthy"] = false
		status["last_error"] = "durable recovery loop is enabled but not configured"
		return status
	}
	loopStatus := s.durableRecoveryLoop.Status()
	status["started"] = loopStatus.Started
	status["healthy"] = loopStatus.Healthy
	status["last_expired_leases"] = loopStatus.LastExpiredLeases
	status["last_timed_out_runs"] = loopStatus.LastTimedOutRuns
	if loopStatus.LastError != "" {
		status["last_error"] = "durable recovery loop iteration failed"
	}
	if !loopStatus.LastIterationAt.IsZero() {
		status["last_iteration_at"] = loopStatus.LastIterationAt.UTC().Format(time.RFC3339Nano)
	}
	return status
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
			!status.TransportScheduleImplemented ||
			!status.AcademicCalendarReadModelConfigured ||
			!status.AcademicCalendarReadModelHealthy ||
			!status.AcademicCalendarProjectionReady) {
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
