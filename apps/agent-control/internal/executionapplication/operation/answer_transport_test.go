package operation

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"testing"
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
		adapter := &RuntimeInputService{AnswerTransport: tc.transport}
		if got := adapter.streamModelAnswers(); got != tc.want {
			t.Fatalf("transport=%q streamModelAnswers()=%v, want %v", tc.transport, got, tc.want)
		}
	}
}

// Both provider modes use internal SSE so retrieval can arrive before the answer.

// Buffered recovery synthesis keeps its existing non-stream response contract.

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
