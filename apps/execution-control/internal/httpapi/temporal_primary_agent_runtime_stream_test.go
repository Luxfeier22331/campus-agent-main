package httpapi

import (
	"errors"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestPrimaryAgentRuntimeFailureKindKeepsPreflightAndTransportFailuresDistinct(t *testing.T) {
	if got := primaryAgentRuntimeFailureKind(agentRuntimeRequestBuildError{cause: errors.New("invalid URL")}); got != "agent_runtime_request_failed" {
		t.Fatalf("request build failure kind = %q", got)
	}
	if got := primaryAgentRuntimeFailureKind(errors.New("connection reset")); got != "agent_attempt_uncertain" {
		t.Fatalf("transport failure kind = %q", got)
	}
}

func TestAgentRuntimeStreamStateValidatesEachAnswerDelta(t *testing.T) {
	state := agentRuntimeStreamState{}
	tests := []struct {
		name  string
		delta agentRuntimeAnswerDelta
		want  string
	}{
		{
			name: "schema drift",
			delta: agentRuntimeAnswerDelta{
				SchemaVersion: "agent_runtime_answer_delta.v2",
				Delta:         "！",
			},
			want: "schema_version",
		},
		{
			name: "empty delta",
			delta: agentRuntimeAnswerDelta{
				SchemaVersion: "agent_runtime_answer_delta.v3",
			},
			want: "delta is required",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := state.validateDelta(test.delta)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("validate delta error = %v, want substring %q", err, test.want)
			}
		})
	}
	for _, delta := range []agentRuntimeAnswerDelta{
		{SchemaVersion: "agent_runtime_answer_delta.v3", Delta: "你好"},
		{SchemaVersion: "agent_runtime_answer_delta.v3", Delta: "！"},
		{SchemaVersion: "agent_runtime_answer_delta.v3", Delta: " "},
	} {
		if err := state.validateDelta(delta); err != nil {
			t.Fatalf("valid delta %#v rejected: %v", delta, err)
		}
	}
}

func TestAgentRuntimeHTTPErrorDoesNotExposeUpstreamMessage(t *testing.T) {
	err := agentRuntimeHTTPError{
		Code:       "provider_unavailable",
		StatusCode: 502,
	}
	if got := err.Error(); got != "The answer provider is temporarily unavailable." {
		t.Fatalf("error = %q", got)
	}
	if strings.Contains(err.Error(), "postgres://runtime:secret") {
		t.Fatalf("error exposed upstream message: %q", err.Error())
	}
}

func TestAgentRuntimeStreamStateBindsCompletedResultToRunAndAnswer(t *testing.T) {
	state := agentRuntimeStreamState{}
	run := execution.DurableRun{RequestID: "run-1"}

	if err := state.validateCompleted(run, agentRuntimeResponse{
		RequestID:   "run-other",
		FinalOutput: "answer",
	}); err == nil || !strings.Contains(err.Error(), "does not match request") {
		t.Fatalf("run binding error = %v", err)
	}
	if err := state.validateCompleted(run, agentRuntimeResponse{
		RequestID:   "run-1",
		FinalOutput: "any canonical answer",
	}); err != nil {
		t.Fatalf("validate completed result: %v", err)
	}
}
