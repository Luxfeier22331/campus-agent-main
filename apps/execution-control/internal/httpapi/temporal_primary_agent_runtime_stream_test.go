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

func TestAgentRuntimeStreamStateRequiresContinuousAnswerDeltas(t *testing.T) {
	state := agentRuntimeStreamState{}
	first := agentRuntimeAnswerDelta{
		SchemaVersion: "agent_runtime_answer_delta.v2",
		ChunkIndex:    1,
		Delta:         "你好",
	}
	if err := state.validateDelta(first); err != nil {
		t.Fatalf("validate first delta: %v", err)
	}
	state.recordDelta(first)

	tests := []struct {
		name  string
		delta agentRuntimeAnswerDelta
		want  string
	}{
		{
			name: "gap",
			delta: agentRuntimeAnswerDelta{
				SchemaVersion: "agent_runtime_answer_delta.v2",
				ChunkIndex:    3,
				Delta:         "！",
			},
			want: "chunk_index",
		},
		{
			name: "schema drift",
			delta: agentRuntimeAnswerDelta{
				SchemaVersion: "agent_runtime_answer_delta.v1",
				ChunkIndex:    2,
				Delta:         "！",
			},
			want: "schema_version",
		},
		{
			name: "empty delta",
			delta: agentRuntimeAnswerDelta{
				SchemaVersion: "agent_runtime_answer_delta.v2",
				ChunkIndex:    2,
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
	space := agentRuntimeAnswerDelta{
		SchemaVersion: "agent_runtime_answer_delta.v2",
		ChunkIndex:    2,
		Delta:         " ",
	}
	if err := state.validateDelta(space); err != nil {
		t.Fatalf("whitespace delta must remain valid: %v", err)
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
	first := agentRuntimeAnswerDelta{
		SchemaVersion: "agent_runtime_answer_delta.v2",
		ChunkIndex:    1,
		Delta:         "answer",
	}
	if err := state.validateDelta(first); err != nil {
		t.Fatalf("validate first delta: %v", err)
	}
	state.recordDelta(first)
	run := execution.DurableRun{RequestID: "run-1"}

	if err := state.validateCompleted(run, agentRuntimeResponse{
		RequestID:   "run-other",
		FinalOutput: "answer",
	}); err == nil || !strings.Contains(err.Error(), "does not match request") {
		t.Fatalf("run binding error = %v", err)
	}
	if err := state.validateCompleted(run, agentRuntimeResponse{
		RequestID:   "run-1",
		FinalOutput: "tampered",
	}); err == nil || !strings.Contains(err.Error(), "final_output") {
		t.Fatalf("final output drift error = %v", err)
	}
	if err := state.validateCompleted(run, agentRuntimeResponse{
		RequestID:   "run-1",
		FinalOutput: "answer",
	}); err != nil {
		t.Fatalf("validate completed result: %v", err)
	}
}
