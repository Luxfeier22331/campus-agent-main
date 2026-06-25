package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestReadyzDegradesWhenExecutionAuditIsEnabledButUnconfigured(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.ExecutionAuditEnabled = true
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	executionAuditRuntime := expectRecord(t, body["execution_audit_runtime"], "execution_audit_runtime")
	if executionAuditRuntime["enabled"] != true || executionAuditRuntime["configured"] != false {
		t.Fatalf("unexpected execution_audit_runtime: %#v", executionAuditRuntime)
	}
}

func TestReadyzDegradesWhenOpenedCampusServicesRuntimeIsUnavailable(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.OpenCapabilities = []string{"campus_services"}
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["configured"] != false {
		t.Fatalf("structured_query_runtime.configured = %v, want false", structuredQueryRuntime["configured"])
	}
}

func TestReadyzDegradesWhenOpenedCampusServicesTransportProjectionIsUnavailable(t *testing.T) {
	emptyTransportFixture := `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[]
	}`
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.OpenCapabilities = []string{"campus_services"}
	})
	useStructuredQueryRuntimeFixtures(
		t,
		server,
		emptyTransportFixture,
		"",
	)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["transport_schedule_implemented"] != false {
		t.Fatalf("unexpected structured_query_runtime: %#v", structuredQueryRuntime)
	}
}

func TestReadyzDoesNotRequireClosedCampusServicesServiceStatusToolToBeModelVisible(t *testing.T) {
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
		]
	}`
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.OpenCapabilities = []string{"campus_services"}
	})
	useStructuredQueryRuntimeFixture(t, server, projectionFixture, "2026-04-24T10:30:00+08:00")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["transport_schedule_implemented"] != true {
		t.Fatalf("unexpected structured_query_runtime: %#v", structuredQueryRuntime)
	}
}

func TestReadyzDegradesWhenOpenedNoticeRuntimeIsUnavailable(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.OpenCapabilities = []string{"notice"}
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	structuredQueryRuntime := expectRecord(t, body["structured_query_runtime"], "structured_query_runtime")
	if structuredQueryRuntime["notice_read_model_configured"] != false ||
		structuredQueryRuntime["notice_body_store_configured"] != false {
		t.Fatalf("unexpected structured_query_runtime: %#v", structuredQueryRuntime)
	}
}

func TestReadyzDegradesWhenOpenedNoticeRuntimeHealthProbeFails(t *testing.T) {
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.OpenCapabilities = []string{"notice"}
		cfg.NoticeReadModelDatabaseURL = "postgresql://notice:secret-pass@127.0.0.1:1/campus_agent"
		cfg.NoticeReadModelTable = "ingestion_projection.internal_notice_read_model"
		cfg.NoticeBodyObjectStoreEndpoint = "http://127.0.0.1:1"
		cfg.NoticeBodyObjectStoreAccessKey = "access-key"
		cfg.NoticeBodyObjectStoreSecretKey = "secret-object-key"
		cfg.NoticeBodyObjectStoreBucket = "notice-body"
		cfg.NoticeBodyObjectStoreBodyLimitBytes = 1_048_576
	})
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
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
	server := newReadyServerForTest(t, func(cfg *config.Config) {
		cfg.NoticeReadModelDatabaseURL = "postgresql://notice:secret-pass@127.0.0.1:1/campus_agent"
		cfg.NoticeReadModelTable = "ingestion_projection.internal_notice_read_model"
		cfg.NoticeBodyObjectStoreEndpoint = "http://127.0.0.1:1"
		cfg.NoticeBodyObjectStoreAccessKey = "access-key"
		cfg.NoticeBodyObjectStoreSecretKey = "secret-object-key"
		cfg.NoticeBodyObjectStoreBucket = "notice-body"
		cfg.NoticeBodyObjectStoreBodyLimitBytes = 1_048_576
	})
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
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
		readyServerConfigForTest(t, func(cfg *config.Config) {
			cfg.MaxConcurrentAnswers = 1
			cfg.QueueCapacity = 1
			cfg.QueueTimeoutMS = 1_000
		}),
		controller,
		nil,
		nil,
	)
	markTemporalReadyForTest(server)
	markRAGRuntimeReadyForTest(server)

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
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
