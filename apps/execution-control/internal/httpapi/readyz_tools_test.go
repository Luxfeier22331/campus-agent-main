package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

func TestReadyzDegradesWhenModelVisibleCampusServicesRuntimeIsUnavailable(t *testing.T) {
	server := newReadyServerForTest(t)
	server.toolReadModel = toolreadmodel.NewRuntime(toolreadmodel.Options{})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	toolReadModelRuntime := expectRecord(t, body["tool_read_model_runtime"], "tool_read_model_runtime")
	if toolReadModelRuntime["configured"] != false {
		t.Fatalf("tool_read_model_runtime.configured = %v, want false", toolReadModelRuntime["configured"])
	}
}

func TestReadyzKeepsRuntimeReadyWhenTransportProjectionHasNoCurrentRelease(t *testing.T) {
	emptyTransportFixture := `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[]
	}`
	server := newReadyServerForTest(t)
	useToolReadModelRuntimeFixtures(
		t,
		server,
		emptyTransportFixture,
		"",
	)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	toolReadModelRuntime := expectRecord(t, body["tool_read_model_runtime"], "tool_read_model_runtime")
	if toolReadModelRuntime["transport_schedule_implemented"] != false {
		t.Fatalf("unexpected tool_read_model_runtime: %#v", toolReadModelRuntime)
	}
	if toolReadModelRuntime["transport_schedule_read_model_healthy"] != true {
		t.Fatalf("unexpected tool_read_model_runtime: %#v", toolReadModelRuntime)
	}
}

func TestReadyzDegradesWhenTransportReadModelDatabaseIsUnhealthy(t *testing.T) {
	server := newReadyServerForTest(t)
	server.toolReadModel = toolreadmodel.NewRuntime(toolreadmodel.Options{
		TransportScheduleReadModelStore: &fakeStructuredReadModelStore{
			healthCheckErr: errors.New("database unavailable"),
		},
	})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	toolReadModelRuntime := expectRecord(t, body["tool_read_model_runtime"], "tool_read_model_runtime")
	if toolReadModelRuntime["transport_schedule_read_model_healthy"] != false {
		t.Fatalf("unexpected tool_read_model_runtime: %#v", toolReadModelRuntime)
	}
}

func TestReadyzDoesNotRequireUnregisteredCampusServicesServiceStatusToolToBeModelVisible(t *testing.T) {
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
	server := newReadyServerForTest(t)
	useToolReadModelRuntimeFixture(t, server, projectionFixture, "2026-04-24T10:30:00+08:00")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	toolReadModelRuntime := expectRecord(t, body["tool_read_model_runtime"], "tool_read_model_runtime")
	if toolReadModelRuntime["transport_schedule_implemented"] != true {
		t.Fatalf("unexpected tool_read_model_runtime: %#v", toolReadModelRuntime)
	}
}

func TestReadyzDoesNotPublishRetiredToolGates(t *testing.T) {
	server := newReadyServerForTest(t, func(*config.Config) {})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	toolGates := expectRecord(t, body["tool_gates"], "tool_gates")
	knowledgeGate := expectRecord(t, toolGates["knowledge_query"], "tool_gates.knowledge_query")
	if knowledgeGate["open"] != true || knowledgeGate["gate"] != "openai_agents_handoff" {
		t.Fatalf("knowledge gate = %#v, want OpenAI Agents handoff", knowledgeGate)
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
	markKnowledgeRuntimeReadyForTest(server)
	server.providerConfigResolver = staticProviderConfigResolver{
		"primary_agent":       primaryAgentProviderConfigSnapshotForTest(),
		"rag_query_embedding": embeddingProviderConfigSnapshotForTest(providerConfigRoleRAGQueryEmbedding, "https://embedding.example/v1", "embedding-test", 2560),
	}
	server.providerConfigErr = nil
	useReadyTransportReadModelRuntimeFixture(t, server)

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
	groups := expectRecord(t, transportRuntime["groups"], "transport_runtime.groups")
	if _, ok := groups["default"]; !ok {
		t.Fatalf("transport_runtime.groups missing default: %#v", groups)
	}
	lifecycleRuntime := expectRecord(t, body["lifecycle_runtime"], "lifecycle_runtime")
	if lifecycleRuntime["active_executions"] != float64(0) {
		t.Fatalf("active executions = %v, want 0", lifecycleRuntime["active_executions"])
	}
}
