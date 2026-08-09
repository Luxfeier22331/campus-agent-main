package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestReadyzRequiresWorkerAuthOutsideLocalProfile(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                     "campus-agent",
		MaxConcurrentAnswers:        8,
		DeploymentEnvironment:       "staging",
		AppAPIExecutionSharedSecret: "worker-secret",
	})

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(unauthorized, newTestRequest(http.MethodGet, "/readyz", nil))
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	authorized := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/readyz", nil)
	request.Header.Set("x-worker-origin-auth", "worker-secret")
	server.ServeHTTP(authorized, request)
	if authorized.Code != http.StatusServiceUnavailable {
		t.Fatalf("authorized readyz status = %d, want 503", authorized.Code)
	}
	body := decodeBody(t, authorized)
	if body["status"] != "degraded" {
		t.Fatalf("authorized readyz body status = %v, want degraded", body["status"])
	}
}

func TestReadyzAcceptsOpsWebBearerOutsideLocalProfile(t *testing.T) {
	server := NewServer(config.Config{
		AppName:               "campus-agent",
		DeploymentEnvironment: "staging",
		MaxConcurrentAnswers:  8,
		OpsWebInternalToken:   "ops-web-token",
	})
	request := newTestRequest(http.MethodGet, "/readyz", nil)
	request.Header.Set("authorization", "Bearer ops-web-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("authorized readyz status = %d, want 503", response.Code)
	}
}

func TestReadyzDoesNotCheckRetiredPythonHandoffReadiness(t *testing.T) {
	server := newReadyServerForTest(t)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	retiredKey := "bridge" + "_runtime"
	if _, ok := body[retiredKey]; ok {
		t.Fatalf("readyz must not publish retired runtime state in online path: %#v", body[retiredKey])
	}
}

func TestReadyzPublishesGoOwnedRuntimeStatus(t *testing.T) {
	server := newReadyServerForTest(t)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}

	body := decodeBody(t, response)
	if body["status"] != "ready" {
		t.Fatalf("status body = %v, want ready", body["status"])
	}
	transportRuntime := expectRecord(t, body["transport_runtime"], "transport_runtime")
	if transportRuntime["max_concurrent_answers"] != float64(8) {
		t.Fatalf(
			"transport_runtime.max_concurrent_answers = %v, want 8",
			transportRuntime["max_concurrent_answers"],
		)
	}
	if _, ok := body["runtime_provider"]; ok {
		t.Fatalf("readyz must not publish stale Python runtime_provider")
	}
	retiredKey := "bridge" + "_runtime"
	if _, ok := body[retiredKey]; ok {
		t.Fatalf("readyz must not publish retired runtime state in online path")
	}
	if _, ok := body["prompt_config_gate"]; ok {
		t.Fatalf("readyz must not publish retired prompt_config_gate: %#v", body["prompt_config_gate"])
	}
}

func TestReadyzPublishesDeploymentRelease(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.DeploymentRelease = "execution-control@0123456789ab"
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["runtime_release"] != "execution-control@0123456789ab" {
		t.Fatalf("runtime_release = %v, want configured release", body["runtime_release"])
	}
}

func TestReadyzDegradesWhenTemporalTaskQueuePollerIsMissing(t *testing.T) {
	server := newReadyServerForTest(t)
	server.temporalStarter = readyTemporalStarter{
		readiness: temporalruntime.RuntimeReadiness{
			Healthy: false,
			TaskQueues: []temporalruntime.TaskQueueReadiness{
				{
					Name:    temporalruntime.WorkflowTaskQueue,
					Type:    temporalruntime.TaskQueueTypeWorkflow,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueCore,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueAgent,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueCore,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 0,
					Healthy: false,
				},
			},
		},
	}
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	temporalRuntime := expectRecord(t, body["temporal_runtime"], "temporal_runtime")
	if temporalRuntime["healthy"] != false {
		t.Fatalf("temporal_runtime.healthy = %v, want false", temporalRuntime["healthy"])
	}
	if temporalRuntime["last_error"] == "" {
		t.Fatalf("temporal_runtime.last_error missing: %#v", temporalRuntime)
	}
}

func TestReadyzDoesNotRequireNoticeActivityPollerForClosedNoticeTool(t *testing.T) {
	server := newReadyServerForTest(t, func(*config.Config) {})
	server.temporalStarter = readyTemporalStarter{
		readiness: temporalruntime.RuntimeReadiness{
			Healthy: true,
			TaskQueues: []temporalruntime.TaskQueueReadiness{
				{
					Name:    temporalruntime.WorkflowTaskQueue,
					Type:    temporalruntime.TaskQueueTypeWorkflow,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueCore,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueAgent,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueCore,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
			},
		},
	}
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	temporalRuntime := expectRecord(t, body["temporal_runtime"], "temporal_runtime")
	if temporalRuntime["healthy"] != true {
		t.Fatalf("temporal_runtime.healthy = %v, want true", temporalRuntime["healthy"])
	}
}

func TestRequiredTemporalTaskQueuesIncludeRuntimeWorkers(t *testing.T) {
	queues := requiredTemporalTaskQueueNames(config.Config{
		TemporalTaskQueue: "custom.workflow",
	})

	for _, want := range []string{
		"custom.workflow",
		temporalruntime.ActivityTaskQueueCore,
		temporalruntime.ActivityTaskQueueAgent,
	} {
		if !containsStringValue(anySlice(queues), want) {
			t.Fatalf("required task queues = %#v, missing %s", queues, want)
		}
	}
}

func TestReadyzDegradesWhenAgentRuntimeIsNotConfigured(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.AgentRuntimeBaseURL = ""
		cfg.AgentRuntimeSharedSecret = ""
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	agentRuntime := expectRecord(t, body["agent_runtime"], "agent_runtime")
	if agentRuntime["configured"] != false || agentRuntime["healthy"] != false {
		t.Fatalf("agent_runtime = %#v, want unconfigured and unhealthy", agentRuntime)
	}
}

func TestReadyzDegradesWhenAgentRuntimeIsUnavailable(t *testing.T) {
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeJSON(response, http.StatusServiceUnavailable, map[string]any{"status": "degraded"})
	}))
	defer agentRuntime.Close()
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.AgentRuntimeBaseURL = agentRuntime.URL
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	status := expectRecord(t, body["agent_runtime"], "agent_runtime")
	if status["configured"] != true || status["healthy"] != false {
		t.Fatalf("agent_runtime = %#v, want configured and unhealthy", status)
	}
}

func TestReadyzAcceptsAgentRuntimeWithoutServerSharedSecret(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.AgentRuntimeSharedSecret = ""
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	agentRuntime := expectRecord(t, body["agent_runtime"], "agent_runtime")
	if agentRuntime["configured"] != true || agentRuntime["healthy"] != true {
		t.Fatalf("agent_runtime = %#v, want configured and healthy", agentRuntime)
	}
}

func TestReadyzOmitsNonCoreRuntimeDiagnostics(t *testing.T) {
	server := newReadyServerForTest(t)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	for _, key := range []string{
		"document_evidence_runtime",
		"personal_memory_runtime",
		"provider_config_gate",
		"telemetry_runtime",
		"tool_gates",
	} {
		if _, ok := body[key]; ok {
			t.Fatalf("readyz must not publish non-core diagnostic %s: %#v", key, body[key])
		}
	}
}
