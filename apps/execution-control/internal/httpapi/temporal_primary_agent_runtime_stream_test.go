package httpapi

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

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
	run := execution.DurableRun{RunID: "run-1"}

	if err := state.validateCompleted(run, agentRuntimeResponse{
		RunID:       "run-other",
		FinalOutput: "answer",
	}); err == nil || !strings.Contains(err.Error(), "does not match run") {
		t.Fatalf("run binding error = %v", err)
	}
	if err := state.validateCompleted(run, agentRuntimeResponse{
		RunID:       "run-1",
		FinalOutput: "tampered",
	}); err == nil || !strings.Contains(err.Error(), "final_output") {
		t.Fatalf("final output drift error = %v", err)
	}
	if err := state.validateCompleted(run, agentRuntimeResponse{
		RunID:       "run-1",
		FinalOutput: "answer",
	}); err != nil {
		t.Fatalf("validate completed result: %v", err)
	}
}
