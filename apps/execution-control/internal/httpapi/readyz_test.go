package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestReadyzDoesNotRequireRetiredPythonHandoffForOnlineRAGRuntime(t *testing.T) {
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
	retiredKey := "bridge" + "_runtime"
	if _, ok := body[retiredKey]; ok {
		t.Fatalf("readyz must not publish retired runtime state in online path: %#v", body[retiredKey])
	}
	knowledgeSearchRuntime := expectRecord(t, body["knowledge_search_runtime"], "knowledge_search_runtime")
	if knowledgeSearchRuntime["healthy"] != true {
		t.Fatalf("knowledge_search_runtime = %#v, want healthy", knowledgeSearchRuntime)
	}
	temporalRuntime := expectRecord(t, body["temporal_runtime"], "temporal_runtime")
	if temporalRuntime["healthy"] != true {
		t.Fatalf("temporal_runtime = %#v, want healthy", temporalRuntime)
	}
}

func TestReadyzRequiresWorkerAuthOutsideLocalProfile(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 8,
		RuntimeMode:          "staging",
		WorkerSharedSecret:   "worker-secret",
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
	knowledgeSearchRuntime := expectRecord(t, body["knowledge_search_runtime"], "knowledge_search_runtime")
	if knowledgeSearchRuntime["healthy"] != true {
		t.Fatalf("knowledge_search_runtime = %#v, want healthy", knowledgeSearchRuntime)
	}
	if _, ok := body["prompt_config_gate"]; ok {
		t.Fatalf("readyz must not publish retired prompt_config_gate: %#v", body["prompt_config_gate"])
	}
	providerConfigGate := expectRecord(t, body["provider_config_gate"], "provider_config_gate")
	if providerConfigGate["configured"] != true || providerConfigGate["reason"] != "" {
		t.Fatalf("provider_config_gate = %#v, want configured", providerConfigGate)
	}
}

func TestReadyzPublishesRuntimeRelease(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.RuntimeRelease = "execution-control@0123456789ab"
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

func TestRequiredTemporalTaskQueuesIncludeModelVisibleToolWorkers(t *testing.T) {
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

func TestReadyzPublishesProviderConfigGateReason(t *testing.T) {
	server := NewServer(readyServerConfigForTest(t, func(cfg *config.Config) {
		cfg.ProviderConfigSnapshotPath = ""
	}))
	markTemporalReadyForTest(server)
	markKnowledgeRuntimeReadyForTest(server)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["status"] != "degraded" {
		t.Fatalf("status body = %v, want degraded", body["status"])
	}
	if _, ok := body["prompt_config_gate"]; ok {
		t.Fatalf("readyz must not publish retired prompt_config_gate: %#v", body["prompt_config_gate"])
	}
	providerConfigGate := expectRecord(t, body["provider_config_gate"], "provider_config_gate")
	if providerConfigGate["configured"] != false {
		t.Fatalf("provider_config_gate.configured = %v, want false", providerConfigGate["configured"])
	}
	if providerConfigGate["reason"] != "provider_config_resolver_not_configured" {
		t.Fatalf("provider_config_gate.reason = %v", providerConfigGate["reason"])
	}
}

func TestReadyzProviderConfigGateUsesLocalProjectionResolver(t *testing.T) {
	server := newReadyServerForTest(t)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if _, ok := body["prompt_config_gate"]; ok {
		t.Fatalf("readyz must not publish retired prompt_config_gate: %#v", body["prompt_config_gate"])
	}
	providerConfigGate := expectRecord(t, body["provider_config_gate"], "provider_config_gate")
	if providerConfigGate["configured"] != true || providerConfigGate["reason"] != "" {
		t.Fatalf("provider_config_gate = %#v, want configured", providerConfigGate)
	}
}

func TestReadyzDegradesWhenOTelEnabledWithoutExporter(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 1,
		QueueCapacity:        1,
		QueueTimeoutMS:       1_000,
		OTelEnabled:          true,
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	telemetryRuntime := expectRecord(t, body["telemetry_runtime"], "telemetry_runtime")
	if telemetryRuntime["enabled"] != true || telemetryRuntime["exporter_configured"] != false {
		t.Fatalf("unexpected telemetry runtime: %#v", telemetryRuntime)
	}
	if telemetryRuntime["last_error"] == "" {
		t.Fatal("expected telemetry last_error to be populated")
	}
}
