package httpapi

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/readiness"
)

const dependencyHealthCheckTimeout = time.Second

func (s *Server) handleReadyz(response http.ResponseWriter, request *http.Request) {
	if !s.readinessAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid readiness auth.", false)
		return
	}
	temporalRuntimeStatus := s.temporalRuntimeStatus(request.Context())
	agentRuntimeStatus := s.agentRuntimeStatus(request.Context())
	runProjectionStoreStatus := s.runProjectionStoreStatus(request.Context())
	ready := !s.draining.Load() && readiness.Aggregate(request.Context(),
		func(context.Context) map[string]any { return agentRuntimeStatus },
		func(context.Context) map[string]any { return runProjectionStoreStatus },
		func(context.Context) map[string]any { return temporalRuntimeStatus },
	)
	statusCode := http.StatusOK
	statusText := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		statusText = "degraded"
	}

	responseBody := map[string]any{
		"status":               statusText,
		"runtime_release":      strings.TrimSpace(s.config.DeploymentRelease),
		"run_projection_store": runProjectionStoreStatus,
		"temporal_runtime":     temporalRuntimeStatus,
		"agent_runtime":        agentRuntimeStatus,
	}

	writeJSON(response, statusCode, responseBody)
}

func (s *Server) agentRuntimeStatus(ctx context.Context) map[string]any {
	baseURL := strings.TrimRight(strings.TrimSpace(s.config.AgentRuntimeBaseURL), "/")
	sharedSecret := s.config.AgentRuntimeSharedSecret
	configured := baseURL != "" && sharedSecret != ""
	status := map[string]any{
		"configured": configured,
		"healthy":    false,
		"last_error": "",
	}
	if !configured {
		status["last_error"] = "agent runtime is not configured"
		return status
	}
	checkCtx, cancel := context.WithTimeout(ctx, dependencyHealthCheckTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(checkCtx, http.MethodGet, baseURL+"/internal/readyz", nil)
	if err != nil {
		status["last_error"] = "agent runtime readiness request could not be created"
		return status
	}
	request.Header.Set("authorization", "Bearer "+sharedSecret)
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
	configured := s.temporalStarter != nil || s.temporalStarterErr != nil
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
		defaultString(strings.TrimSpace(cfg.TemporalTaskQueue), "campus-agent.workflow.v3"),
	}, requiredTemporalActivityTaskQueueNames(cfg)...)
}

func requiredTemporalActivityTaskQueueNames(cfg config.Config) []string {
	_ = cfg
	required := []string{
		"campus-agent.activity.core.v3",
		"campus-agent.activity.agent.v3",
	}
	return required
}

func containsRequiredTemporalTaskQueues(
	actual []executionapplication.TaskQueueReadiness,
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

func (s *Server) runProjectionStoreStatus(ctx context.Context) map[string]any {
	configured := s.runProjectionStore != nil
	status := map[string]any{
		"configured": configured,
		"healthy":    configured,
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
	checkCtx, cancel := context.WithTimeout(ctx, dependencyHealthCheckTimeout)
	defer cancel()
	if err := checker.HealthCheck(checkCtx); err != nil {
		status["healthy"] = false
		status["last_error"] = "run projection store health check failed"
		return status
	}
	return status
}

// Process readiness keeps queries and cancellation reachable during execution outages.
func (s *Server) handleProcessReadyz(response http.ResponseWriter, request *http.Request) {
	if !s.readinessAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid readiness auth.", false)
		return
	}
	store := s.runProjectionStoreStatus(request.Context())
	ready := !s.draining.Load() && s.runService != nil && s.runProjectionStore != nil && store["healthy"] == true
	status, code := "ready", http.StatusOK
	if !ready {
		status, code = "degraded", http.StatusServiceUnavailable
	}
	writeJSON(response, code, map[string]any{"status": status, "run_projection_store": store, "runtime_release": s.config.DeploymentRelease})
}
