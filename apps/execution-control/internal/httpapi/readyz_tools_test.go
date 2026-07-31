package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestReadyzPublishesOnlyModelVisibleToolGates(t *testing.T) {
	server := newReadyServerForTest(t, func(*config.Config) {})
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/readyz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	toolGates := expectRecord(t, body["tool_gates"], "tool_gates")
	if len(toolGates) != 1 {
		t.Fatalf("tool gates = %#v, want only personal_memory_recall", toolGates)
	}
	memoryGate := expectRecord(t, toolGates["personal_memory_recall"], "personal_memory_recall")
	if memoryGate["open"] != true {
		t.Fatalf("personal_memory_recall gate = %#v, want open", memoryGate)
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
		providerConfigKindLLM:       primaryAgentProviderConfigSnapshotForTest(),
		providerConfigKindEmbedding: embeddingProviderConfigSnapshotForTest(providerConfigKindEmbedding, "https://embedding.example/v1", "embedding-test", 2560),
	}
	server.providerConfigErr = nil
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
