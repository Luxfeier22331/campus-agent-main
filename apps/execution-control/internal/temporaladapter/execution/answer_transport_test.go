package execution

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestStreamModelAnswersFollowsAnswerTransportSwitch(t *testing.T) {
	for _, tc := range []struct {
		transport string
		want      bool
	}{
		{transport: config.AnswerTransportBuffered, want: false},
		{transport: config.AnswerTransportStream, want: true},
		{transport: "", want: false},
	} {
		adapter := &Adapter{Writer: &activityprojection.Writer{Config: config.Config{AnswerTransport: tc.transport}}}
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

func (c *streamCapturingClient) Execute(_ context.Context, request executionapplication.AgentRuntimeRequest) (executionapplication.AgentRuntimeResponse, error) {
	c.stream = request.Stream
	return executionapplication.AgentRuntimeResponse{
		StatusCode: c.status,
		Body:       io.NopCloser(strings.NewReader(c.response)),
	}, nil
}

// Buffered transport must forward Stream=false to the agent runtime so it uses
// the non-stream /internal/agent-requests endpoint instead of /stream.
func TestCallWorkflowOperationRuntimeForwardsStreamFlag(t *testing.T) {
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
		{stream: false, body: string(resultPayload)},
	}
	for _, tc := range cases {
		client := &streamCapturingClient{status: 200, response: tc.body}
		adapter := &Adapter{AgentRuntimeClient: client}
		response, err := adapter.CallWorkflowOperationRuntime(
			t.Context(),
			execution.DurableRun{RequestID: "run-1", CreatedAt: time.Now()},
			temporalruntime.WorkflowOperationSolve,
			"",
			[]byte("{}"),
			60_000,
			tc.stream,
		)
		if err != nil {
			t.Fatalf("stream=%v err=%v", tc.stream, err)
		}
		if client.stream != tc.stream {
			t.Fatalf("stream=%v forwarded Stream=%v", tc.stream, client.stream)
		}
		if response.RequestID != "run-1" || response.FinalOutput == "" {
			t.Fatalf("stream=%v unexpected response: %#v", tc.stream, response)
		}
	}
}

// Buffered solve consumes the non-stream response body (io.ReadAll branch) and
// must not require any SSE framing.
func TestCallWorkflowOperationRuntimeBufferedReadsWholeBody(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"request_id":     "run-2",
		"operation":      "solve",
		"status":         "completed",
		"solve_outcome":  "answer",
		"final_output":   "完整回答",
		"answer_started": false,
	})
	if err != nil {
		t.Fatal(err)
	}
	client := &streamCapturingClient{status: 200, response: string(payload)}
	adapter := &Adapter{AgentRuntimeClient: client}
	response, err := adapter.CallWorkflowOperationRuntime(
		t.Context(),
		execution.DurableRun{RequestID: "run-2", CreatedAt: time.Now()},
		temporalruntime.WorkflowOperationSolve,
		"",
		[]byte("{}"),
		60_000,
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.FinalOutput != "完整回答" || response.SolveOutcome != "answer" {
		t.Fatalf("unexpected buffered response: %#v", response)
	}
}
