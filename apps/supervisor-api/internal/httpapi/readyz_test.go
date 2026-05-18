package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
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

func TestReadyzDegradesWhenExecutionAuditIsEnabledButUnconfigured(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		ExecutionAuditEnabled:         true,
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
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	executionAuditRuntime := expectRecord(t, body["execution_audit_runtime"], "execution_audit_runtime")
	if executionAuditRuntime["enabled"] != true || executionAuditRuntime["configured"] != false {
		t.Fatalf("unexpected execution_audit_runtime: %#v", executionAuditRuntime)
	}
}

func TestReadyzDegradesWhenOpenedCampusServicesRuntimeIsUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		OpenCapabilities:              []string{"campus_services"},
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
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["configured"] != false {
		t.Fatalf("structured_query_runtime.configured = %v, want false", structuredQueryRuntime["configured"])
	}
}

func TestReadyzDegradesWhenOpenedCampusServicesServiceGuideProjectionIsUnavailable(t *testing.T) {
	partialProjectionFixture := `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"override_source_refs":["notice:library-hours"],
				"related_notice_refs":["notice:library-hours"]
			}
		],
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		]
	}`
	emptyServiceGuideFixture := `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"service_guide_records":[],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		OpenCapabilities:              []string{"campus_services"},
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
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	useStructuredQueryRuntimeFixtures(
		t,
		server,
		partialProjectionFixture,
		partialProjectionFixture,
		emptyServiceGuideFixture,
		"",
	)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["service_status_projection_ready"] != true ||
		structuredQueryRuntime["transport_schedule_implemented"] != true ||
		structuredQueryRuntime["service_guide_projection_ready"] != false {
		t.Fatalf("unexpected structured_query_runtime: %#v", structuredQueryRuntime)
	}
}

func TestReadyzDegradesWhenOpenedCampusServicesContactDirectoryUnavailable(t *testing.T) {
	projectionFixture := `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"override_source_refs":["notice:library-hours"],
				"related_notice_refs":["notice:library-hours"]
			}
		],
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		],
		"service_guide_records":[
			{
				"service_id":"shuttle_bus",
				"service_name":"校车",
				"required_materials":[],
				"contact_refs":[]
			}
		]
	}`
	server := NewServer(config.Config{
		AppName:                       "campus-agent",
		MaxConcurrentAnswers:          8,
		OpenCapabilities:              []string{"campus_services"},
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
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	bundle := decodeProjectionBundleFixture(t, projectionFixture)
	server.structuredQuery = structuredquery.NewRuntime(structuredquery.Options{
		ServiceStatusReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		TransportScheduleReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		ServiceGuideReadModelStore: &fakeStructuredReadModelStore{
			bundle: bundle,
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["contact_directory_read_model_configured"] != false ||
		structuredQueryRuntime["contact_directory_projection_ready"] != false {
		t.Fatalf("unexpected structured_query_runtime: %#v", structuredQueryRuntime)
	}
}

func TestReadyzDegradesWhenOpenedNoticeRuntimeIsUnavailable(t *testing.T) {
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
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["notice_read_model_configured"] != false ||
		structuredQueryRuntime["notice_body_store_configured"] != false {
		t.Fatalf("unexpected structured_query_runtime: %#v", structuredQueryRuntime)
	}
}

func TestReadyzDegradesWhenOpenedNoticeRuntimeHealthProbeFails(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                         "campus-agent",
		MaxConcurrentAnswers:            8,
		OpenCapabilities:                []string{"notice"},
		PromptRuntimeProvider:           "openai-responses",
		SupervisorPromptModel:           "gpt-supervisor",
		AgentPromptModel:                "gpt-agent",
		PromptRuntimeAPIKey:             "test-key",
		PromptRuntimeTransport:          "responses",
		PromptRuntimeBaseURL:            "https://api.openai.com/v1",
		PromptStrictStructuredOutputs:   true,
		NoticeReadModelDatabaseURL:      "postgresql://notice:secret-pass@127.0.0.1:1/campus_agent",
		NoticeReadModelTable:            "ingestion_projection.internal_notice_read_model",
		NoticeObjectStoreEndpoint:       "http://127.0.0.1:1",
		NoticeObjectStoreAccessKey:      "access-key",
		NoticeObjectStoreSecretKey:      "secret-object-key",
		NoticeObjectStoreBucketDerived:  "campus-rag-derived",
		NoticeObjectStoreBodyLimitBytes: 1_048_576,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["notice_read_model_configured"] != true ||
		structuredQueryRuntime["notice_body_store_configured"] != true {
		t.Fatalf("notice runtime should be configured: %#v", structuredQueryRuntime)
	}
	if structuredQueryRuntime["notice_read_model_healthy"] != false ||
		structuredQueryRuntime["notice_body_store_healthy"] != false {
		t.Fatalf("notice runtime health should fail closed: %#v", structuredQueryRuntime)
	}
	lastError, _ := structuredQueryRuntime["notice_runtime_last_error"].(string)
	if lastError == "" {
		t.Fatalf("notice_runtime_last_error = %q, want stable reason", lastError)
	}
	for _, secret := range []string{"secret-pass", "secret-object-key", "127.0.0.1:1"} {
		if strings.Contains(lastError, secret) {
			t.Fatalf("notice_runtime_last_error leaked %q: %s", secret, lastError)
		}
	}
}

func TestReadyzDoesNotDegradeWhenClosedNoticeRuntimeHealthProbeFails(t *testing.T) {
	server := NewServer(config.Config{
		AppName:                         "campus-agent",
		MaxConcurrentAnswers:            8,
		PromptRuntimeProvider:           "openai-responses",
		SupervisorPromptModel:           "gpt-supervisor",
		AgentPromptModel:                "gpt-agent",
		PromptRuntimeAPIKey:             "test-key",
		PromptRuntimeTransport:          "responses",
		PromptRuntimeBaseURL:            "https://api.openai.com/v1",
		PromptStrictStructuredOutputs:   true,
		NoticeReadModelDatabaseURL:      "postgresql://notice:secret-pass@127.0.0.1:1/campus_agent",
		NoticeReadModelTable:            "ingestion_projection.internal_notice_read_model",
		NoticeObjectStoreEndpoint:       "http://127.0.0.1:1",
		NoticeObjectStoreAccessKey:      "access-key",
		NoticeObjectStoreSecretKey:      "secret-object-key",
		NoticeObjectStoreBucketDerived:  "campus-rag-derived",
		NoticeObjectStoreBodyLimitBytes: 1_048_576,
	}, &fakeBridge{
		configured: true,
		readyz: bridge.ReadyzResponse{
			StatusCode: http.StatusOK,
			Body:       json.RawMessage(`{"status":"ready"}`),
		},
	})
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["notice_read_model_healthy"] != false {
		t.Fatalf("notice health should still be reported: %#v", structuredQueryRuntime)
	}
}

func TestReadyzKeepsTransportReadyWhenAllSlotsAreBusyButQueueCanAccept(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithDependencies(
		config.Config{
			AppName:                       "campus-agent",
			MaxConcurrentAnswers:          1,
			QueueCapacity:                 1,
			QueueTimeoutMS:                1_000,
			PromptRuntimeProvider:         "openai-responses",
			SupervisorPromptModel:         "gpt-supervisor",
			AgentPromptModel:              "gpt-agent",
			PromptRuntimeAPIKey:           "test-key",
			PromptRuntimeTransport:        "responses",
			PromptRuntimeBaseURL:          "https://api.openai.com/v1",
			PromptStrictStructuredOutputs: true,
		},
		&fakeBridge{
			configured: true,
			readyz: bridge.ReadyzResponse{
				StatusCode: http.StatusOK,
				Body: json.RawMessage(`{
					"status":"ready"
				}`),
			},
		},
		controller,
		nil,
		nil,
	)

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	transportRuntime := expectRecord(t, body["transport_runtime"], "transport_runtime")
	if transportRuntime["active_answers"] != float64(1) {
		t.Fatalf("active_answers = %v, want 1", transportRuntime["active_answers"])
	}
	if transportRuntime["queue_capacity"] != float64(1) {
		t.Fatalf("queue_capacity = %v, want 1", transportRuntime["queue_capacity"])
	}
	if transportRuntime["accepting"] != true {
		t.Fatalf("accepting = %v, want true", transportRuntime["accepting"])
	}
	lanes := expectRecord(t, transportRuntime["lanes"], "transport_runtime.lanes")
	if _, ok := lanes["default"]; !ok {
		t.Fatalf("transport_runtime.lanes missing default: %#v", lanes)
	}
	lifecycleRuntime := expectRecord(t, body["lifecycle_runtime"], "lifecycle_runtime")
	if lifecycleRuntime["active_executions"] != float64(0) {
		t.Fatalf("active executions = %v, want 0", lifecycleRuntime["active_executions"])
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

func TestReadyzIncludesBridgeAnswerHistoryFingerprint(t *testing.T) {
	callCount := 0
	server := NewServerWithDependencies(
		config.Config{
			AuthMode:                      "bearer",
			BearerToken:                   "secret-token",
			DefaultActorID:                "runtime-bearer-user",
			RequestBodyLimitBytes:         1_048_576,
			MaxConcurrentAnswers:          8,
			PromptRuntimeProvider:         "openai-responses",
			SupervisorPromptModel:         "gpt-supervisor",
			AgentPromptModel:              "gpt-agent",
			PromptRuntimeAPIKey:           "test-key",
			PromptRuntimeTransport:        "responses",
			PromptRuntimeBaseURL:          "https://api.openai.com/v1",
			PromptStrictStructuredOutputs: true,
		},
		&fakeBridge{
			configured: true,
			executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
				callCount++
				if callCount == 1 {
					return bridge.ExecuteResponse{}, context.DeadlineExceeded
				}
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body: json.RawMessage(
						`{"selected_target":"rag-agent","status":"completed","answer_text":"ok","follow_up_question":"","confidence":"high"}`,
					),
				}, nil
			},
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
		},
		nil,
		nil,
		nil,
	)

	timeoutRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-readyz-timeout"),
	)
	timeoutRequest.Header.Set("authorization", "Bearer secret-token")
	timeoutResponse := httptest.NewRecorder()
	server.ServeHTTP(timeoutResponse, timeoutRequest)
	assertError(t, timeoutResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	successRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-readyz-success"),
	)
	successRequest.Header.Set("authorization", "Bearer secret-token")
	successResponse := httptest.NewRecorder()
	server.ServeHTTP(successResponse, successRequest)
	if successResponse.Code != http.StatusOK {
		t.Fatalf("success status = %d, want 200", successResponse.Code)
	}

	readyzResponse := httptest.NewRecorder()
	server.ServeHTTP(readyzResponse, newTestRequest(http.MethodGet, "/readyz", nil))
	if readyzResponse.Code != http.StatusOK {
		t.Fatalf("readyz status = %d, want 200", readyzResponse.Code)
	}
	body := decodeBody(t, readyzResponse)
	bridgeRuntime := expectRecord(t, body["bridge_runtime"], "bridge_runtime")
	if bridgeRuntime["last_answer_failure_code"] != "timeout" {
		t.Fatalf(
			"bridge_runtime.last_answer_failure_code = %v, want timeout",
			bridgeRuntime["last_answer_failure_code"],
		)
	}
	if bridgeRuntime["last_answer_failure_at"] == "" {
		t.Fatal("expected bridge_runtime.last_answer_failure_at to be populated")
	}
	if bridgeRuntime["last_answer_success_at"] == "" {
		t.Fatal("expected bridge_runtime.last_answer_success_at to be populated")
	}
}
