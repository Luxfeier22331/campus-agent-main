package operation

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
)

type payloadRuntimeClient struct {
	body   string
	status int
}

func (c payloadRuntimeClient) Execute(_ context.Context, request executionapplication.AgentRuntimeRequest, handle func(executionapplication.AgentRuntimeEvent) error) (executionapplication.AgentRuntimeResult, error) {
	return outboundadapter.DecodeAgentRuntimeResponse(c.status, strings.NewReader(c.body), request.Stream, handle)
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
			adapter := &OperationService{AgentRuntimeClient: payloadRuntimeClient{body: string(body), status: status}}
			_, err = adapter.CallWorkflowOperationRuntime(t.Context(), execution.DurableRun{RequestID: "run", CreatedAt: time.Now()}, executioncontract.WorkflowOperationSynthesize, "", executionapplication.AgentRuntimeRequest{}, 60000, false)
			var sizeError *execution.OperationPayloadTooLargeError
			if errors.As(err, &sizeError) != (delta > 0) {
				t.Fatalf("status=%d delta=%d err=%v", status, delta, err)
			}
			if delta <= 0 && status == 200 && err != nil {
				t.Fatal(err)
			}
			if delta <= 0 && status == 500 {
				var httpError executionapplication.AgentRuntimeFailure
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
		err := outboundadapter.ReadAgentRuntimeSSEEvents(strings.NewReader("event: completed\r\ndata: "+data+"\r\n\r\n"), func(event outboundadapter.AgentRuntimeSSEEvent) error { calls++; return nil })
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
	err := outboundadapter.ReadAgentRuntimeSSEEvents(strings.NewReader(data), func(outboundadapter.AgentRuntimeSSEEvent) error {
		t.Fatal("oversized multiline event dispatched")
		return nil
	})
	var sizeError *execution.OperationPayloadTooLargeError
	if !errors.As(err, &sizeError) {
		t.Fatal(err)
	}
}

func (c payloadRuntimeClient) Prepare(r executionapplication.AgentRuntimeRequest) (string, error) {
	return outboundadapter.NewAgentRuntimeClient(config.Config{}).Prepare(r)
}
