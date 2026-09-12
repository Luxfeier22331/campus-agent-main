package execution

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type payloadRuntimeClient struct {
	body   string
	status int
}

func (c payloadRuntimeClient) Execute(context.Context, executionapplication.AgentRuntimeRequest) (executionapplication.AgentRuntimeResponse, error) {
	return executionapplication.AgentRuntimeResponse{StatusCode: c.status, Body: io.NopCloser(strings.NewReader(c.body))}, nil
}

func TestHTTPResponseBudgetIncludesSuccessAndErrorBodies(t *testing.T) {
	for _, status := range []int{200, 500} {
		for _, delta := range []int{-1, 0, 1} {
			value := map[string]string{"request_id": "run", "final_output": ""}
			base, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			value["final_output"] = strings.Repeat("x", execution.MaxAgentOperationPayloadBytes-len(base)+delta)
			body, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			adapter := &Adapter{AgentRuntimeClient: payloadRuntimeClient{body: string(body), status: status}}
			_, err = adapter.CallWorkflowOperationRuntime(t.Context(), execution.DurableRun{RequestID: "run", CreatedAt: time.Now()}, temporalruntime.WorkflowOperationExecuteStep, "", []byte("{}"), 60000, false)
			var sizeError *execution.OperationPayloadTooLargeError
			if errors.As(err, &sizeError) != (delta > 0) {
				t.Fatalf("status=%d delta=%d err=%v", status, delta, err)
			}
			if delta <= 0 && status == 200 && err != nil {
				t.Fatal(err)
			}
			if delta <= 0 && status == 500 {
				var httpError AgentRuntimeHTTPError
				if !errors.As(err, &httpError) {
					t.Fatalf("lost HTTP error: %v", err)
				}
			}
		}
	}
}

func TestSSEBudgetIncludesJSONButAllowsFraming(t *testing.T) {
	for _, delta := range []int{-1, 0, 1, 2048} {
		data := "{\"answer\":\"" + strings.Repeat("x", execution.MaxAgentOperationPayloadBytes-len(`{"answer":""}`)+delta) + "\"}"
		calls := 0
		err := ReadAgentRuntimeSSEEvents(strings.NewReader("event: completed\r\ndata: "+data+"\r\n\r\n"), func(event AgentRuntimeSSEEvent) error { calls++; return nil })
		if delta <= 0 {
			if err != nil || calls != 1 {
				t.Fatalf("delta=%d calls=%d err=%v", delta, calls, err)
			}
		} else {
			var sizeError *execution.OperationPayloadTooLargeError
			if !errors.As(err, &sizeError) || calls != 0 {
				t.Fatalf("delta=%d calls=%d err=%v", delta, calls, err)
			}
		}
	}
}

func TestSSEMultilineBudgetCountsWhitespace(t *testing.T) {
	data := "event: completed\ndata: {\ndata: " + strings.Repeat(" ", execution.MaxAgentOperationPayloadBytes) + "\ndata: }\n\n"
	err := ReadAgentRuntimeSSEEvents(strings.NewReader(data), func(AgentRuntimeSSEEvent) error { t.Fatal("oversized multiline event dispatched"); return nil })
	var sizeError *execution.OperationPayloadTooLargeError
	if !errors.As(err, &sizeError) {
		t.Fatal(err)
	}
}
