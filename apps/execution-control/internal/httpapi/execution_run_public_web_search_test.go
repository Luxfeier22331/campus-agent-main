package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestExecutionRunCreateAddsProfileOpenPublicWebSearchToPrimaryAgentTools(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	server.config.OpenTools = []string{"public_web_search"}
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(`{
			"run_id":"run-public-web-open",
			"conversation_id":"conv-public-web-open",
			"turn_id":"turn-public-web-open",
			"request_id":"req-public-web-open",
			"trace_id":"trace-public-web-open",
			"owner_user_id":"user-public-web-open",
			"surface":"campus-web",
			"task_queue":"campus-agent.workflow",
			"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
			"metadata":{
				"execution_payload":{
					"user_goal":"校园网密码怎么改",
					"request_id":"req-public-web-open",
					"conversation_id":"conv-public-web-open",
					"trace":{"trace_id":"trace-public-web-open"},
					"actor":{"user_id":"user-public-web-open"},
					"context":{"actor":{"user_id":"user-public-web-open"}},
					"runtime_decisions":{"runtime_decision_summary":{}}
				}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	want := []string{"knowledge_query", "public_web_search"}
	if !reflect.DeepEqual(starter.input.VisibleToolNames, want) {
		t.Fatalf("visible tools = %#v, want %#v", starter.input.VisibleToolNames, want)
	}
	if _, err := store.GetRun(context.Background(), "run-public-web-open"); err != nil {
		t.Fatalf("get run projection: %v", err)
	}
}
