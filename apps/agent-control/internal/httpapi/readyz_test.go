package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
)

func TestReadyzRequiresWorkerAuthOutsideLocalProfile(t *testing.T) {
	server := NewServer(config.Config{
		AppName:               "campus-agent",
		DeploymentEnvironment: "staging",
		IngressSharedSecret:   "worker-secret", AppAPIExecutionSharedSecret: "worker-secret",
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
	for _, key := range []string{"run_projection_store", "temporal_runtime"} {
		status := expectRecord(t, body[key], key)
		if status["configured"] != true || status["healthy"] != true {
			t.Fatalf("%s = %#v, want configured and healthy", key, status)
		}
	}
	for _, key := range []string{"transport_runtime", "lifecycle_runtime"} {
		if _, ok := body[key]; ok {
			t.Fatalf("readyz must not publish unused local controller state %s", key)
		}
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
		readiness: executionapplication.RuntimeReadiness{
			Healthy: false,
			TaskQueues: []executionapplication.TaskQueueReadiness{
				{
					Name:    "campus-agent.agent.workflow.v1",
					Type:    "workflow",
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    "campus-agent.agent.tool.v1",
					Type:    "activity",
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    "campus-agent.agent.model.v1",
					Type:    "activity",
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    "campus-agent.agent.tool.v1",
					Type:    "activity",
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
		readiness: executionapplication.RuntimeReadiness{
			Healthy: true,
			TaskQueues: []executionapplication.TaskQueueReadiness{
				{
					Name:    "campus-agent.agent.workflow.v1",
					Type:    "workflow",
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    "campus-agent.agent.tool.v1",
					Type:    "activity",
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    "campus-agent.agent.model.v1",
					Type:    "activity",
					Pollers: 1,
					Healthy: true,
				},
				{
					Name:    "campus-agent.agent.tool.v1",
					Type:    "activity",
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
		"campus-agent.agent.tool.v1",
		"campus-agent.agent.model.v1",
	} {
		if !containsStringValue(anySlice(queues), want) {
			t.Fatalf("required task queues = %#v, missing %s", queues, want)
		}
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

func TestIngressSecretDoesNotAcceptProductCallbackIdentity(t *testing.T) {
	s := NewServer(config.Config{IngressSharedSecret: "ingress-secret", AppAPIExecutionSharedSecret: "callback-secret"})
	for _, tc := range []struct {
		secret string
		want   bool
	}{{"ingress-secret", true}, {"callback-secret", false}, {"", false}} {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/internal/execution/requests", nil)
		request.Header.Set("x-worker-origin-auth", tc.secret)
		if s.internalWorkerAuthorized(request) != tc.want {
			t.Fatalf("unexpected authorization result")
		}
	}
}
