package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type providerConfigGate struct {
	Configured bool   `json:"configured"`
	Reason     string `json:"reason"`
	Source     string `json:"source"`
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
	structuredQueryCtx, structuredQueryCancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer structuredQueryCancel()
	structuredQueryStatus := s.structuredQuery.Status(structuredQueryCtx)
	temporalRuntimeStatus := s.temporalRuntimeStatus(request.Context())
	providerConfigGate := s.evaluateProviderConfigGate()
	personalMemoryStatus := s.personalMemoryRuntimeStatus(request.Context())
	ragRuntimeStatus := s.ragRuntimeStatus(request.Context())
	telemetryHealthy := !telemetryStatus.Enabled || telemetryStatus.ExporterConfigured
	executionAuditHealthy := !executionAuditStatus.Enabled || executionAuditStatus.Configured
	structuredRuntimeHealthy := s.openStructuredRuntimeHealthy(structuredQueryStatus)
	runProjectionStoreStatus := s.runProjectionStoreStatus(request.Context())
	ready := transportStatus.Healthy &&
		telemetryHealthy &&
		executionAuditHealthy &&
		structuredRuntimeHealthy &&
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
		"status":                   statusText,
		"transport_runtime":        transportStatus,
		"lifecycle_runtime":        s.lifecycle.Snapshot(),
		"telemetry_runtime":        telemetryStatus,
		"execution_audit_runtime":  executionAuditStatus,
		"structured_query_runtime": structuredQueryStatus,
		"run_projection_store":     runProjectionStoreStatus,
		"temporal_runtime":         temporalRuntimeStatus,
		"personal_memory_runtime":  personalMemoryStatus,
		"rag_runtime":              ragRuntimeStatus,
		"capability_gates":         s.capabilityGateStatus(),
		"provider_config_gate":     providerConfigGate,
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
		checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond)
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
		checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond)
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
		"context_char_budget":           s.config.PersonalMemoryRecallMaxChars,
		"data_plane":                    "hindsight_self_host",
		"healthy":                       false,
		"last_error":                    "",
		"online_recall_owner":           "execution-control",
		"owner_salt_configured":         personalMemoryOwnerSaltConfigured(s.config),
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
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond)
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
		temporalruntime.ActivityTaskQueueContext,
		temporalruntime.ActivityTaskQueueKnowledgePlan,
		temporalruntime.ActivityTaskQueueKnowledgeRetrieval,
		temporalruntime.ActivityTaskQueueKnowledgeSynthesis,
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

func (s *Server) evaluateProviderConfigGate() providerConfigGate {
	if s.providerConfigErr != nil {
		reason := "provider_config_resolver_not_configured"
		if !errors.Is(s.providerConfigErr, errProviderConfigResolverNotConfigured) {
			reason = "provider_config_resolver_invalid"
		}
		return providerConfigGate{
			Configured: false,
			Reason:     reason,
			Source:     "app-api-provider-config",
		}
	}
	if s.providerConfigResolver == nil {
		return providerConfigGate{
			Configured: false,
			Reason:     "provider_config_resolver_not_configured",
			Source:     "app-api-provider-config",
		}
	}
	return providerConfigGate{
		Configured: true,
		Reason:     "",
		Source:     "app-api-provider-config",
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
