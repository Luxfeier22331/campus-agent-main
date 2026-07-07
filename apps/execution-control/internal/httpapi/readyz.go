package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type providerConfigGate struct {
	Configured bool   `json:"configured"`
	Reason     string `json:"reason"`
	Source     string `json:"source"`
}

func providerConfigGateRequiredRoles(cfg config.Config) []providerConfigRole {
	roles := []providerConfigRole{}
	if cfg.ToolOpen("public_web_search") {
		roles = append(roles, providerConfigRolePublicWebSearch)
	}
	return roles
}

func (s *Server) handleReadyz(response http.ResponseWriter, request *http.Request) {
	if !s.readinessAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid readiness auth.", false)
		return
	}
	transportStatus := s.admission.Status()
	telemetryStatus := s.telemetry.Status()
	executionAuditStatus := s.executionAudit.Status()
	toolReadModelCtx, toolReadModelCancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond,
	)
	defer toolReadModelCancel()
	toolReadModelStatus := s.toolReadModel.Status(toolReadModelCtx)
	temporalRuntimeStatus := s.temporalRuntimeStatus(request.Context())
	providerConfigGate := s.evaluateProviderConfigGate()
	personalMemoryStatus := s.personalMemoryRuntimeStatus(request.Context())
	ragRuntimeStatus := s.ragRuntimeStatus(request.Context())
	telemetryHealthy := !telemetryStatus.Enabled || telemetryStatus.ExporterConfigured
	executionAuditHealthy := !executionAuditStatus.Enabled || executionAuditStatus.Configured
	toolReadModelRuntimeHealthy := s.openToolReadModelRuntimeHealthy(toolReadModelStatus)
	runProjectionStoreStatus := s.runProjectionStoreStatus(request.Context())
	ready := transportStatus.Healthy &&
		telemetryHealthy &&
		executionAuditHealthy &&
		toolReadModelRuntimeHealthy &&
		runProjectionStoreStatus["healthy"] == true &&
		temporalRuntimeStatus["healthy"] == true &&
		personalMemoryStatus["healthy"] == true &&
		ragRuntimeStatus["healthy"] == true &&
		providerConfigGate.Configured
	statusCode := http.StatusOK
	statusText := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		statusText = "degraded"
	}

	responseBody := map[string]any{
		"status":                  statusText,
		"transport_runtime":       transportStatus,
		"lifecycle_runtime":       s.lifecycle.Snapshot(),
		"telemetry_runtime":       telemetryStatus,
		"execution_audit_runtime": executionAuditStatus,
		"tool_read_model_runtime": toolReadModelStatus,
		"run_projection_store":    runProjectionStoreStatus,
		"temporal_runtime":        temporalRuntimeStatus,
		"personal_memory_runtime": personalMemoryStatus,
		"rag_runtime":             ragRuntimeStatus,
		"tool_gates":              s.toolGateStatus(),
		"provider_config_gate":    providerConfigGate,
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

func (s *Server) ragRuntimeStatus(ctx context.Context) map[string]any {
	status := map[string]any{
		"healthy":                  false,
		"lookup_configured":        s.ragLookupExecutor != nil,
		"lookup_healthy":           false,
		"lookup_last_error":        "",
		"synthesis_configured":     s.ragSynthesisExecutor != nil,
		"synthesis_healthy":        false,
		"synthesis_last_error":     "",
		"provider_execution_owner": "go",
		"retrieval_adapter":        "qdrant_native",
	}
	if s.ragLookupErr != nil {
		status["lookup_last_error"] = "rag lookup executor could not be initialized"
	} else if s.ragLookupExecutor == nil {
		status["lookup_last_error"] = "rag lookup executor is not configured"
	} else {
		checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
		defer cancel()
		if err := s.ragLookupExecutor.HealthCheck(checkCtx); err != nil {
			status["lookup_last_error"] = "rag lookup health check failed: " + err.Error()
		} else {
			status["lookup_healthy"] = true
		}
	}
	if s.ragSynthesisErr != nil {
		status["synthesis_last_error"] = "rag synthesis executor could not be initialized"
	} else if s.ragSynthesisExecutor == nil {
		status["synthesis_last_error"] = "rag synthesis executor is not configured"
	} else {
		checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
		defer cancel()
		if err := s.ragSynthesisExecutor.HealthCheck(checkCtx); err != nil {
			status["synthesis_last_error"] = "rag synthesis health check failed"
		} else {
			status["synthesis_healthy"] = true
		}
	}
	status["healthy"] = status["lookup_healthy"] == true && status["synthesis_healthy"] == true
	return status
}

func (s *Server) personalMemoryRuntimeStatus(ctx context.Context) map[string]any {
	status := map[string]any{
		"configured":                    s.personalMemoryExecutor != nil,
		"context_char_budget":           s.config.PersonalMemoryContextCharBudget,
		"data_plane":                    "hindsight_self_host",
		"healthy":                       false,
		"last_error":                    "",
		"online_recall_owner":           "execution-control",
		"owner_salt_configured":         personalMemoryOwnerSaltConfigured(s.config),
		"recall_max_tokens":             s.config.PersonalMemoryRecallMaxTokens,
		"thread_owner":                  "execution-control",
		"raw_transcript_gate":           "sanitized_turn_append_only",
		"hindsight_base_url_configured": strings.TrimSpace(s.config.PersonalMemoryBaseURL) != "",
		"hindsight_secret_configured":   strings.TrimSpace(s.config.PersonalMemoryAPISecret) != "",
	}
	if s.personalMemoryErr != nil {
		status["last_error"] = "personal memory executor could not be initialized"
		return status
	}
	if s.personalMemoryExecutor == nil {
		status["last_error"] = "personal memory executor is not configured"
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
	defer cancel()
	if err := s.personalMemoryExecutor.HealthCheck(checkCtx); err != nil {
		status["last_error"] = "personal memory health check failed"
		return status
	}
	status["healthy"] = true
	return status
}

func requiredTemporalTaskQueueNames(cfg config.Config) []string {
	return append([]string{
		defaultString(strings.TrimSpace(cfg.TemporalTaskQueue), "campus-agent.workflow"),
	}, requiredTemporalActivityTaskQueueNames(cfg)...)
}

func requiredTemporalActivityTaskQueueNames(cfg config.Config) []string {
	required := []string{
		temporalruntime.ActivityTaskQueueCore,
		temporalruntime.ActivityTaskQueueAgent,
		temporalruntime.ActivityTaskQueueKnowledge,
	}
	toolQueues := map[string]string{
		"transport_schedule_lookup": temporalruntime.ActivityTaskQueueCore,
		"campus_notice_discover":    temporalruntime.ActivityTaskQueueCore,
	}
	for _, toolName := range cfg.OpenTools {
		queue := toolQueues[strings.TrimSpace(toolName)]
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

func (s *Server) evaluateProviderConfigGate() providerConfigGate {
	if s.providerConfigErr != nil {
		reason := "provider_config_resolver_not_configured"
		if !errors.Is(s.providerConfigErr, errProviderConfigResolverNotConfigured) {
			reason = "provider_config_resolver_invalid"
		}
		return providerConfigGate{
			Configured: false,
			Reason:     reason,
			Source:     "provider-config-projection",
		}
	}
	if s.providerConfigResolver == nil {
		return providerConfigGate{
			Configured: false,
			Reason:     "provider_config_resolver_not_configured",
			Source:     "provider-config-projection",
		}
	}
	for _, role := range providerConfigGateRequiredRoles(s.config) {
		if _, err := s.providerConfigResolver.ResolveActiveProviderConfig(context.Background(), role); err != nil {
			return providerConfigGate{
				Configured: false,
				Reason:     "provider_config_projection_invalid_for_" + string(role),
				Source:     "provider-config-projection",
			}
		}
	}
	return providerConfigGate{
		Configured: true,
		Reason:     "",
		Source:     "provider-config-projection",
	}
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
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		status["healthy"] = false
		status["last_error"] = "run projection store health check failed"
		return status
	}
	return status
}

func (s *Server) toolGateStatus() map[string]any {
	return map[string]any{
		"knowledge_query": map[string]any{
			"open": true,
			"gate": "always_open",
		},
		"place_lookup": map[string]any{
			"open": false,
			"gate": "deferred_until_map_rollout",
		},
		"transport_schedule_lookup": map[string]any{
			"open": s.config.ToolOpen("transport_schedule_lookup"),
			"gate": "tool_read_model_runtime_and_activity_worker",
		},
		"campus_notice_discover": map[string]any{
			"open": s.config.ToolOpen("campus_notice_discover"),
			"gate": "tool_read_model_runtime_and_activity_worker",
		},
	}
}

func (s *Server) openToolReadModelRuntimeHealthy(status toolreadmodel.Status) bool {
	if s.config.ToolOpen("transport_schedule_lookup") &&
		(!status.Configured ||
			!status.TransportScheduleReadModelConfigured ||
			!status.TransportScheduleReadModelHealthy ||
			!status.TransportScheduleImplemented) {
		return false
	}
	if s.config.ToolOpen("campus_notice_discover") &&
		(!status.NoticeReadModelConfigured || !status.NoticeReadModelHealthy) {
		return false
	}
	return true
}
