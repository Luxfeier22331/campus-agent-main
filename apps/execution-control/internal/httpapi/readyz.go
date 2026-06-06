package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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
	temporalRuntimeStatus := s.temporalRuntimeStatus(request.Context())
	promptGate := evaluatePromptConfigGate(s.config)
	telemetryHealthy := !telemetryStatus.Enabled || telemetryStatus.ExporterConfigured
	executionAuditHealthy := !executionAuditStatus.Enabled || executionAuditStatus.Configured
	structuredRuntimeHealthy := s.openStructuredRuntimeHealthy(structuredQueryStatus)
	workflowRuntimeHealthy := !s.config.MultiStepWorkflowEnabled || workflowRunStatus["healthy"] == true
	runProjectionStoreStatus := s.runProjectionStoreStatus(request.Context())
	ready := bridgeHealthy &&
		transportStatus.Healthy &&
		telemetryHealthy &&
		executionAuditHealthy &&
		structuredRuntimeHealthy &&
		workflowRuntimeHealthy &&
		runProjectionStoreStatus["healthy"] == true &&
		temporalRuntimeStatus["healthy"] == true &&
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
		"run_projection_store":     runProjectionStoreStatus,
		"temporal_runtime":         temporalRuntimeStatus,
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
			"last_bridge_failure_code":     bridgeSnapshot.LastBridgeFailureCode,
			"last_bridge_failure_at":       bridgeSnapshot.LastBridgeFailureAt,
			"last_bridge_success_at":       bridgeSnapshot.LastBridgeSuccessAt,
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

func (s *Server) temporalRuntimeStatus(ctx context.Context) map[string]any {
	configured := s.temporalStarter != nil
	status := map[string]any{
		"configured":          configured,
		"healthy":             false,
		"last_error":          "",
		"namespace":           s.config.TemporalNamespace,
		"task_queue":          s.config.TemporalTaskQueue,
		"worker_id":           s.config.TemporalWorkerIdentity,
		"task_queues":         requiredTemporalTaskQueueNames(s.config),
		"task_queue_pollers":  []map[string]any{},
		"task_queue_gate":     "pollers_required",
		"poller_window_notes": "Temporal DescribeTaskQueue reports recent pollers.",
	}
	if s.temporalStarterErr != nil {
		status["last_error"] = "temporal starter could not be initialized"
		return status
	}
	if !configured {
		return status
	}
	readiness := s.temporalStarter.CheckReadiness(ctx)
	taskQueues := []map[string]any{}
	for _, taskQueue := range readiness.TaskQueues {
		taskQueues = append(taskQueues, map[string]any{
			"name":    taskQueue.Name,
			"type":    taskQueue.Type,
			"pollers": taskQueue.Pollers,
			"healthy": taskQueue.Healthy,
		})
	}
	status["task_queue_pollers"] = taskQueues
	status["healthy"] = readiness.Healthy && containsRequiredTemporalTaskQueues(readiness.TaskQueues, requiredTemporalTaskQueueNames(s.config))
	if !readiness.Healthy {
		status["last_error"] = defaultString(readiness.LastError, "temporal task queue poller check failed")
	} else if status["healthy"] != true {
		status["last_error"] = "temporal required task queues are incomplete"
	}
	return status
}

func requiredTemporalTaskQueueNames(cfg config.Config) []string {
	return append([]string{
		defaultString(strings.TrimSpace(cfg.TemporalTaskQueue), "campus-agent.workflow"),
	}, requiredTemporalActivityTaskQueueNames(cfg)...)
}

func requiredTemporalActivityTaskQueueNames(cfg config.Config) []string {
	required := []string{
		temporalruntime.ActivityTaskQueueRAG,
		temporalruntime.ActivityTaskQueueFinalization,
	}
	capabilityQueues := map[string]string{
		"campus_services": temporalruntime.ActivityTaskQueueCampusService,
		"navigation":      temporalruntime.ActivityTaskQueueNavigation,
		"notice":          temporalruntime.ActivityTaskQueueNotice,
	}
	for _, capability := range cfg.OpenCapabilities {
		queue := capabilityQueues[strings.TrimSpace(capability)]
		if queue != "" {
			required = appendUniqueString(required, queue)
		}
	}
	return required
}

func appendUniqueString(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func containsRequiredTemporalTaskQueues(
	actual []temporalruntime.TaskQueueReadiness,
	required []string,
) bool {
	seen := map[string]bool{}
	for _, taskQueue := range actual {
		if taskQueue.Healthy {
			seen[strings.TrimSpace(taskQueue.Name)] = true
		}
	}
	for _, queue := range required {
		if !seen[queue] {
			return false
		}
	}
	return true
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

func (s *Server) runProjectionStoreStatus(ctx context.Context) map[string]any {
	configured := s.runProjectionStore != nil
	status := map[string]any{
		"configured": configured,
		"healthy":    true,
		"last_error": "",
	}
	if s.runProjectionStoreErr != nil {
		status["healthy"] = false
		status["last_error"] = "run projection store could not be initialized"
		return status
	}
	if !configured {
		return status
	}
	checker, ok := s.runProjectionStore.(interface{ HealthCheck(context.Context) error })
	if !ok {
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		status["healthy"] = false
		status["last_error"] = "run projection store health check failed"
		return status
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
			"gate": "structured_runtime_and_activity_worker",
		},
		"navigation": map[string]any{
			"open": s.config.CapabilityOpen("navigation"),
			"gate": "activity_worker",
		},
		"notice": map[string]any{
			"open": s.config.CapabilityOpen("notice"),
			"gate": "structured_runtime_and_activity_worker",
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
