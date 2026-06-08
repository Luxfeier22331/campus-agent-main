package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
)

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
		AppName:                             "campus-agent",
		MaxConcurrentAnswers:                8,
		OpenCapabilities:                    []string{"notice"},
		PromptRuntimeProvider:               "openai-responses",
		SupervisorPromptModel:               "gpt-supervisor",
		AgentPromptModel:                    "gpt-agent",
		PromptRuntimeAPIKey:                 "test-key",
		PromptRuntimeTransport:              "responses",
		PromptRuntimeBaseURL:                "https://api.openai.com/v1",
		PromptStrictStructuredOutputs:       true,
		NoticeReadModelDatabaseURL:          "postgresql://notice:secret-pass@127.0.0.1:1/campus_agent",
		NoticeReadModelTable:                "ingestion_projection.internal_notice_read_model",
		NoticeBodyObjectStoreEndpoint:       "http://127.0.0.1:1",
		NoticeBodyObjectStoreAccessKey:      "access-key",
		NoticeBodyObjectStoreSecretKey:      "secret-object-key",
		NoticeBodyObjectStoreBucket:         "notice-body",
		NoticeBodyObjectStoreBodyLimitBytes: 1_048_576,
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
		AppName:                             "campus-agent",
		MaxConcurrentAnswers:                8,
		PromptRuntimeProvider:               "openai-responses",
		SupervisorPromptModel:               "gpt-supervisor",
		AgentPromptModel:                    "gpt-agent",
		PromptRuntimeAPIKey:                 "test-key",
		PromptRuntimeTransport:              "responses",
		PromptRuntimeBaseURL:                "https://api.openai.com/v1",
		PromptStrictStructuredOutputs:       true,
		NoticeReadModelDatabaseURL:          "postgresql://notice:secret-pass@127.0.0.1:1/campus_agent",
		NoticeReadModelTable:                "ingestion_projection.internal_notice_read_model",
		NoticeBodyObjectStoreEndpoint:       "http://127.0.0.1:1",
		NoticeBodyObjectStoreAccessKey:      "access-key",
		NoticeBodyObjectStoreSecretKey:      "secret-object-key",
		NoticeBodyObjectStoreBucket:         "notice-body",
		NoticeBodyObjectStoreBodyLimitBytes: 1_048_576,
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
	markTemporalReadyForTest(server)
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
	markTemporalReadyForTest(server)

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
