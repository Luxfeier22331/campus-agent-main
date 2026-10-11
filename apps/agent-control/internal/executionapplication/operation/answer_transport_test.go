package operation

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/outboundadapter"
)

func TestStreamModelAnswersFollowsAnswerTransportSwitch(t *testing.T) {
	for _, tc := range []struct {
		transport string
		want      bool
	}{
		{transport: "buffered", want: false},
		{transport: "stream", want: true},
		{transport: "", want: false},
	} {
		adapter := &OperationService{Options: Options{AnswerTransport: tc.transport}}
		if got := adapter.streamModelAnswers(); got != tc.want {
			t.Fatalf("transport=%q streamModelAnswers()=%v, want %v", tc.transport, got, tc.want)
		}
	}
}

type streamCapturingClient struct {
	stream   bool
	response string
	status   int
}

func (c *streamCapturingClient) Execute(_ context.Context, request executionapplication.AgentRuntimeRequest, handle func(executionapplication.AgentRuntimeEvent) error) (executionapplication.AgentRuntimeResult, error) {
	c.stream = request.Stream
	return outboundadapter.DecodeAgentRuntimeResponse(c.status, strings.NewReader(c.response), request.Stream, handle)
}

// Both provider modes use internal SSE so retrieval can arrive before the answer.
func TestCallWorkflowOperationRuntimeStreamsProgressInBothModelModes(t *testing.T) {
	resultPayload, err := json.Marshal(map[string]any{
		"request_id":    "run-1",
		"operation":     "solve",
		"status":        "completed",
		"solve_outcome": "answer",
		"final_output":  "图书馆周一至周日 8:00-22:00 开放。",
	})
	if err != nil {
		t.Fatal(err)
	}
	sseBody := "event: solve_decision\ndata: {\"schema_version\":\"workflow_runtime_solve_decision.v1\",\"outcome\":\"answer\"}\n\n" +
		"event: completed\ndata: " + string(resultPayload) + "\n\n"
	cases := []struct {
		stream bool
		body   string
	}{
		{stream: true, body: sseBody},
		{stream: false, body: sseBody},
	}
	for _, tc := range cases {
		client := &streamCapturingClient{status: 200, response: tc.body}
		adapter := &OperationService{AgentRuntimeClient: client}
		response, err := adapter.CallWorkflowOperationRuntime(
			t.Context(),
			execution.DurableRun{RequestID: "run-1", CreatedAt: time.Now()},
			executioncontract.WorkflowOperationSolve,
			"",
			executionapplication.AgentRuntimeRequest{},
			60_000,
			tc.stream,
		)
		if err != nil {
			t.Fatalf("stream=%v err=%v", tc.stream, err)
		}
		if !client.stream {
			t.Fatalf("stream=%v forwarded Stream=%v", tc.stream, client.stream)
		}
		if response.RequestID != "run-1" || response.FinalOutput == "" {
			t.Fatalf("stream=%v unexpected response: %#v", tc.stream, response)
		}
	}
}

// Buffered recovery synthesis keeps its existing non-stream response contract.
func TestCallWorkflowOperationRuntimeBufferedReadsWholeBody(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"request_id": "run-2",
		"operation":  "synthesize",
		"status":     "completed",

		"final_output":   "完整回答",
		"answer_started": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	client := &streamCapturingClient{status: 200, response: string(payload)}
	adapter := &OperationService{AgentRuntimeClient: client}
	response, err := adapter.CallWorkflowOperationRuntime(
		t.Context(),
		execution.DurableRun{RequestID: "run-2", CreatedAt: time.Now()},
		executioncontract.WorkflowOperationSynthesize,
		"",
		executionapplication.AgentRuntimeRequest{},
		60_000,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.FinalOutput != "完整回答" || client.stream {
		t.Fatalf("unexpected buffered response: %#v", response)
	}
}

func TestRuntimePayloadSelectsProviderTransport(t *testing.T) {
	for _, operation := range []executioncontract.WorkflowOperation{executioncontract.WorkflowOperationSolve, executioncontract.WorkflowOperationExecuteStep} {
		for _, stream := range []bool{false, true} {
			payload := WorkflowOperationRuntimeRequest(execution.DurableRun{}, OperationRequest{Operation: operation, Stream: stream}, nil, WorkflowRuntimeLimits{}, 1)
			want := "buffered"
			if stream {
				want = "stream"
			}
			if outboundadapterTransportForTest(payload) != want {
				t.Fatalf("operation=%s stream=%v payload=%v", operation, stream, payload)
			}
		}
	}
}

func outboundadapterTransportForTest(r executionapplication.AgentRuntimeRequest) string {
	if r.StreamModelAnswer {
		return "stream"
	}
	return "buffered"
}

func (c *streamCapturingClient) Prepare(r executionapplication.AgentRuntimeRequest) (string, error) {
	return outboundadapter.NewAgentRuntimeClient(config.Config{}).Prepare(r)
}
