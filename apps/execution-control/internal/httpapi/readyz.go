package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type providerConfigGate struct {
	Configured bool   `json:"configured"`
	Reason     string `json:"reason"`
	Source     string `json:"source"`
}

func providerConfigGateRequiredKinds() []providerConfigKind {
	return []providerConfigKind{
		providerConfigKindLLM,
	}
}

func (s *Server) handleReadyz(response http.ResponseWriter, request *http.Request) {
	if !s.readinessAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid readiness auth.", false)
		return
	}
	transportStatus := s.admission.Status()
	telemetryStatus := s.telemetry.Status()
	toolReadModelCtx, toolReadModelCancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond,
	)
	defer toolReadModelCancel()
	toolReadModelStatus := s.toolReadModel.Status(toolReadModelCtx)
	temporalRuntimeStatus := s.temporalRuntimeStatus(request.Context())
	providerConfigGate := s.evaluateProviderConfigGate()
	agentRuntimeStatus := s.agentRuntimeStatus(request.Context())
	personalMemoryStatus := s.personalMemoryRuntimeStatus(request.Context())
	knowledgeSearchStatus := s.knowledgeSearchRuntimeStatus(request.Context())
	runProjectionStoreStatus := s.runProjectionStoreStatus(request.Context())
	ready := transportStatus.Healthy &&
		agentRuntimeStatus["healthy"] == true &&
		runProjectionStoreStatus["healthy"] == true &&
		temporalRuntimeStatus["healthy"] == true
	statusCode := http.StatusOK
	statusText := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		statusText = "degraded"
	}

	responseBody := map[string]any{
		"status":                   statusText,
		"runtime_release":          strings.TrimSpace(s.config.DeploymentRelease),
		"transport_runtime":        transportStatus,
		"lifecycle_runtime":        s.lifecycle.Snapshot(),
		"telemetry_runtime":        telemetryStatus,
		"tool_read_model_runtime":  toolReadModelStatus,
		"run_projection_store":     runProjectionStoreStatus,
		"temporal_runtime":         temporalRuntimeStatus,
		"personal_memory_runtime":  personalMemoryStatus,
		"knowledge_search_runtime": knowledgeSearchStatus,
		"tool_gates":               s.toolGateStatus(),
		"provider_config_gate":     providerConfigGate,
		"agent_runtime":            agentRuntimeStatus,
	}

	writeJSON(response, statusCode, responseBody)
}

func (s *Server) agentRuntimeStatus(ctx context.Context) map[string]any {
	baseURL := strings.TrimRight(strings.TrimSpace(s.config.AgentRuntimeBaseURL), "/")
	configured := baseURL != ""
	status := map[string]any{
		"configured": configured,
		"healthy":    false,
		"last_error": "",
	}
	if !configured {
		status["last_error"] = "agent runtime is not configured"
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
	defer cancel()
	request, err := http.NewRequestWithContext(checkCtx, http.MethodGet, baseURL+"/readyz", nil)
	if err != nil {
		status["last_error"] = "agent runtime readiness request could not be created"
		return status
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		status["last_error"] = "agent runtime readiness check failed"
		return status
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		status["last_error"] = "agent runtime readiness check returned non-200 status"
		return status
	}
	status["healthy"] = true
	return status
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

func (s *Server) knowledgeSearchRuntimeStatus(ctx context.Context) map[string]any {
	status := map[string]any{
		"configured":                    s.knowledgeSearchExecutor != nil,
		"embedding_provider_configured": false,
		"healthy":                       false,
		"last_error":                    "",
		"retrieval_adapter":             "qdrant_native",
	}
	if s.knowledgeSearchErr != nil {
		status["last_error"] = "knowledge search executor could not be initialized"
		return status
	}
	if s.knowledgeSearchExecutor == nil {
		status["last_error"] = "knowledge search executor is not configured"
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
	defer cancel()
	if s.providerConfigErr != nil || s.providerConfigResolver == nil {
		status["last_error"] = "knowledge search embedding provider config is not available"
		return status
	}
	if _, err := s.providerConfigResolver.ResolveActiveProviderConfig(
		checkCtx,
		providerConfigKindEmbedding,
	); err != nil {
		status["last_error"] = "knowledge search embedding provider config is not available"
		return status
	}
	status["embedding_provider_configured"] = true
	if err := s.knowledgeSearchExecutor.HealthCheck(checkCtx); err != nil {
		status["last_error"] = "knowledge search health check failed: " + err.Error()
		return status
	}
	status["healthy"] = true
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
		"retention_model":               "synchronous_user_message_documents",
		"hindsight_base_url_configured": strings.TrimSpace(s.config.PersonalMemoryBaseURL) != "",
		"hindsight_secret_configured":   strings.TrimSpace(s.config.PersonalMemoryAPISecret) != "",
		"state_store_healthy":           false,
	}
	if s.personalMemoryErr != nil {
		status["last_error"] = "personal memory executor could not be initialized"
		return status
	}
	if s.personalMemoryExecutor == nil {
		status["last_error"] = "personal memory executor is not configured"
		return status
	}
	if s.personalMemoryStateErr != nil || s.personalMemoryStateStore == nil {
		status["last_error"] = "personal memory state store could not be initialized"
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond)
	defer cancel()
	if err := s.personalMemoryStateStore.HealthCheck(checkCtx); err != nil {
		status["last_error"] = "personal memory state store health check failed"
		return status
	}
	status["state_store_healthy"] = true
	if err := s.personalMemoryExecutor.HealthCheck(checkCtx); err != nil {
		status["last_error"] = "personal memory health check failed: " + formatReadinessError(err)
		return status
	}
	status["healthy"] = true
	return status
}

func formatReadinessError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.Join(strings.Fields(err.Error()), " ")
	const maxLength = 256
	runes := []rune(message)
	if len(runes) > maxLength {
		return string(runes[:maxLength]) + "..."
	}
	return message
}

func requiredTemporalTaskQueueNames(cfg config.Config) []string {
	return append([]string{
		defaultString(strings.TrimSpace(cfg.TemporalTaskQueue), "campus-agent.workflow"),
	}, requiredTemporalActivityTaskQueueNames(cfg)...)
}

func requiredTemporalActivityTaskQueueNames(cfg config.Config) []string {
	_ = cfg
	required := []string{
		temporalruntime.ActivityTaskQueueCore,
		temporalruntime.ActivityTaskQueueAgent,
	}
	return required
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
			Source:     "execution-config",
		}
	}
	if s.providerConfigResolver == nil {
		return providerConfigGate{
			Configured: false,
			Reason:     "provider_config_resolver_not_configured",
			Source:     "execution-config",
		}
	}
	for _, kind := range providerConfigGateRequiredKinds() {
		if _, err := s.providerConfigResolver.ResolveActiveProviderConfig(context.Background(), kind); err != nil {
			return providerConfigGate{
				Configured: false,
				Reason:     "provider_config_invalid_for_" + string(kind),
				Source:     "execution-config",
			}
		}
	}
	return providerConfigGate{
		Configured: true,
		Reason:     "",
		Source:     "execution-config",
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
			"gate": "openai_agents_handoff",
		},
		"transport_schedule_lookup": map[string]any{
			"open": modelVisibleToolConfigured("transport_schedule_lookup"),
			"gate": "tool_read_model_runtime_and_activity_worker",
		},
	}
}

func modelVisibleToolConfigured(toolName string) bool {
	_, ok := runtimepolicy.ModelVisibleToolByName(toolName)
	return ok
}
