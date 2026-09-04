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

	server := NewServerWithOptions(
		readyServerConfigForTest(t, func(cfg *config.Config) {
			cfg.MaxConcurrentAnswers = 1
			cfg.QueueCapacity = 1
			cfg.QueueTimeoutMS = 1_000
		}),
		ServerOptions{AdmissionController: controller},
	)
	markTemporalReadyForTest(server)
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
