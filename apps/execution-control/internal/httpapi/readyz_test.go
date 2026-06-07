package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestReadyzReportsBridgeNotConfigured(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 8,
	}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.Code)
	}

	body := decodeBody(t, response)
	if body["status"] != "degraded" {
		t.Fatalf("status body = %v, want degraded", body["status"])
	}
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["configured"] != false {
		t.Fatalf("bridge configured = %v, want false", bridgeRuntime["configured"])
	}
	temporalRuntime := expectRecord(t, body["temporal_runtime"], "temporal_runtime")
	if temporalRuntime["configured"] != false || temporalRuntime["healthy"] != false {
		t.Fatalf("temporal_runtime = %#v, want unconfigured degraded", temporalRuntime)
	}
}

func TestReadyzRequiresWorkerAuthOutsideLocalProfile(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 8,
		RuntimeProfile:       "staging",
		WorkerSharedSecret:   "worker-secret",
	}, nil)

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

func TestReadyzRedactsBridgeReadinessTransportErrors(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		PromptRuntimeProvider:         "openai-responses",
		SupervisorPromptModel:         "gpt-supervisor",
		AgentPromptModel:              "gpt-agent",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		readyzErr:  errors.New("Get http://127.0.0.1:8888/internal/bridge/readyz?token=secret-token: dial tcp 127.0.0.1:8888: connect: connection refused"),
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	lastError, _ := bridgeRuntime["last_error"].(string)
	if lastError != "Supervisor Python bridge readiness check failed." {
		t.Fatalf("bridge_runtime.last_error = %q", lastError)
	}
	for _, secret := range []string{"secret-token", "127.0.0.1:8888", "/internal/bridge/readyz"} {
		if strings.Contains(lastError, secret) {
			t.Fatalf("bridge_runtime.last_error leaked %q: %s", secret, lastError)
		}
	}
}

func TestReadyzMergesWorkerReadinessAndGoTransportStatus(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		PromptRuntimeProvider:         "openai-responses",
		SupervisorPromptModel:         "gpt-supervisor",
		AgentPromptModel:              "gpt-agent",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body: json.RawMessage(`{
				"status":"ready",
				"runtime_provider":"mock-runtime",
				"prompt_runtime":{"provider":"mock-runtime","admitted":true},
				"prompt_http_pool":{"healthy":true,"max_connections":32},
				"audit_runtime":{"healthy":true,"queue_depth":0}
			}`),
		},
	})
	markTemporalReadyForTest(server)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}

	body := decodeBody(t, response)
	if body["status"] != "ready" {
		t.Fatalf("status body = %v, want ready", body["status"])
	}
	if body["runtime_provider"] != "mock-runtime" {
		t.Fatalf("runtime_provider = %v, want mock-runtime", body["runtime_provider"])
	}
	transportRuntime := expectRecord(t, body["transport_runtime"], "transport_runtime")
	if transportRuntime["max_concurrent_answers"] != float64(8) {
		t.Fatalf(
			"transport_runtime.max_concurrent_answers = %v, want 8",
			transportRuntime["max_concurrent_answers"],
		)
	}
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["healthy"] != true {
		t.Fatalf("bridge_runtime.healthy = %v, want true", bridgeRuntime["healthy"])
	}
	if _, ok := body["audit_runtime"]; ok {
		t.Fatalf("readyz must not publish stale Python audit_runtime")
	}
	workerTransportKey := "worker_" + "transport_runtime"
	if _, ok := bridgeRuntime[workerTransportKey]; ok {
		t.Fatalf("bridge_runtime.%s must not be published", workerTransportKey)
	}
	promptConfigGate := expectRecord(t, body["prompt_config_gate"], "prompt_config_gate")
	if promptConfigGate["admitted"] != true || promptConfigGate["reason"] != "" {
		t.Fatalf("prompt_config_gate = %#v, want admitted", promptConfigGate)
	}
}

func TestReadyzDegradesWhenTemporalTaskQueuePollerIsMissing(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		PromptRuntimeProvider:         "openai-responses",
		SupervisorPromptModel:         "gpt-supervisor",
		AgentPromptModel:              "gpt-agent",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body: json.RawMessage(`{
				"status":"ready",
				"prompt_runtime":{"admitted":true},
				"prompt_http_pool":{"healthy":true}
			}`),
		},
	})
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
					Name:    temporalruntime.ActivityTaskQueueRAG,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueFinalization,
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

func TestReadyzDegradesWhenOpenedNoticeActivityPollerIsMissing(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		OpenCapabilities:              []string{"notice"},
		PromptRuntimeProvider:         "openai-responses",
		SupervisorPromptModel:         "gpt-supervisor",
		AgentPromptModel:              "gpt-agent",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body: json.RawMessage(`{
				"status":"ready",
				"prompt_runtime":{"admitted":true},
				"prompt_http_pool":{"healthy":true}
			}`),
		},
	})
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
					Name:    temporalruntime.ActivityTaskQueueRAG,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    temporalruntime.ActivityTaskQueueFinalization,
					Type:    temporalruntime.TaskQueueTypeActivity,
					Pollers: 1,
					Healthy: true,
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
	required, ok := temporalRuntime["task_queues"].([]any)
	if !ok {
		t.Fatalf("temporal_runtime.task_queues = %#v, want array", temporalRuntime["task_queues"])
	}
	if !containsStringValue(required, temporalruntime.ActivityTaskQueueNotice) {
		t.Fatalf("required task queues = %#v, want notice activity queue", required)
	}
	if temporalRuntime["healthy"] != false {
		t.Fatalf("temporal_runtime.healthy = %v, want false", temporalRuntime["healthy"])
	}
}

func TestRequiredTemporalTaskQueuesIncludeOpenedCapabilityWorkers(t *testing.T) {
	queues := requiredTemporalTaskQueueNames(config.Config{
		TemporalTaskQueue: "custom.workflow",
		OpenCapabilities:  []string{"campus_services", "navigation", "notice"},
	})

	for _, want := range []string{
		"custom.workflow",
		temporalruntime.ActivityTaskQueueRAG,
		temporalruntime.ActivityTaskQueueFinalization,
		temporalruntime.ActivityTaskQueueCampusService,
		temporalruntime.ActivityTaskQueueNavigation,
		temporalruntime.ActivityTaskQueueNotice,
	} {
		if !containsStringValue(anySlice(queues), want) {
			t.Fatalf("required task queues = %#v, missing %s", queues, want)
		}
	}
}

func TestReadyzPublishesGoOwnedPromptConfigGateReason(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		PromptRuntimeProvider:         "openai-responses",
		SupervisorPromptModel:         "gpt-supervisor",
		AgentPromptModel:              "gpt-agent",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body: json.RawMessage(`{
				"status":"ready",
				"prompt_runtime":{"admitted":true},
				"prompt_http_pool":{"healthy":true}
			}`),
		},
	})
	markTemporalReadyForTest(server)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	promptConfigGate := expectRecord(t, body["prompt_config_gate"], "prompt_config_gate")
	if promptConfigGate["admitted"] != false {
		t.Fatalf("prompt_config_gate.admitted = %v, want false", promptConfigGate["admitted"])
	}
	if promptConfigGate["reason"] != "prompt_api_key_not_configured" {
		t.Fatalf("prompt_config_gate.reason = %v", promptConfigGate["reason"])
	}
}

func TestReadyzPromptConfigGateDoesNotRequireSupervisorTerminalModel(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		PromptRuntimeProvider:         "openai-responses",
		SupervisorPromptModel:         "",
		AgentPromptModel:              "gpt-agent",
		PromptRuntimeAPIKey:           "test-key",
		PromptRuntimeTransport:        "responses",
		PromptRuntimeBaseURL:          "https://api.openai.com/v1",
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body: json.RawMessage(`{
				"status":"ready",
				"prompt_runtime":{"admitted":true},
				"prompt_http_pool":{"healthy":true}
			}`),
		},
	})
	markTemporalReadyForTest(server)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	promptConfigGate := expectRecord(t, body["prompt_config_gate"], "prompt_config_gate")
	if promptConfigGate["admitted"] != true || promptConfigGate["reason"] != "" {
		t.Fatalf("prompt_config_gate = %#v, want admitted", promptConfigGate)
	}
	if promptConfigGate["supervisor_model"] != "" {
		t.Fatalf("prompt_config_gate.supervisor_model = %v, want empty", promptConfigGate["supervisor_model"])
	}
}

func TestReadyzDegradesWhenOTelEnabledWithoutExporter(t *testing.T) {
	server := NewServer(config.Config{
		AppName:              "campus-agent",
		MaxConcurrentAnswers: 1,
		QueueCapacity:        1,
		QueueTimeoutMS:       1_000,
		OTelEnabled:          true,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
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
