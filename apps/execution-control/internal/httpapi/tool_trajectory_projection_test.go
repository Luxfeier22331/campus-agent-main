package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestBuildAgentRuntimeEvalProjectionIncludesToolTrajectory(t *testing.T) {
	now := time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC)
	projection := buildAgentRuntimeEvalProjection(
		execution.DurableRun{
			RunID:          "run-tool-trajectory",
			ConversationID: "conv-tool-trajectory",
			RequestID:      "req-tool-trajectory",
			TraceID:        "trace-tool-trajectory",
			Surface:        "campus-web",
			SelectedTool:   "knowledge_query",
			Status:         execution.DurableRunStatusCompleted,
			TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
			RuntimeVersions: map[string]any{
				"release": "staging-2026-07-03",
			},
		},
		[]execution.RunStepProjection{{
			StepID:           "rag.plan",
			RunID:            "run-tool-trajectory",
			ConversationID:   "conv-tool-trajectory",
			StepKind:         "planning",
			Tool:             "knowledge_query",
			Status:           "completed",
			TaskQueue:        "campus-agent.activity.knowledge",
			StartedAt:        now,
			CompletedAt:      now.Add(100 * time.Millisecond),
			SanitizedPayload: map[string]any{"raw_prompt": "must not leak"},
		}},
		[]execution.StepAttemptProjection{{
			AttemptID:     "rag.plan:attempt:1",
			StepID:        "rag.plan",
			RunID:         "run-tool-trajectory",
			Status:        "completed",
			DurationMS:    100,
			ModelProvider: "openai",
			ModelName:     "gpt-5-mini",
		}},
		[]execution.StepResultProjection{{
			ResultID:      "rag.plan:result:1",
			StepID:        "rag.plan",
			RunID:         "run-tool-trajectory",
			AttemptID:     "rag.plan:attempt:1",
			Status:        "completed",
			ResultKind:    "route_plan",
			ProjectionRef: "projection://runs/run-tool-trajectory/rag/plan",
			CreatedAt:     now.Add(100 * time.Millisecond),
			SanitizedPayload: map[string]any{
				"raw_provider_result": "must not leak",
				"selected_tool":       "knowledge_query",
				"tool_call": map[string]any{
					"arguments_hash": "sha256:args",
					"arguments_shape": map[string]any{
						"valid": true,
					},
					"authorization": "must not leak",
					"selected_tool": "knowledge_query",
				},
			},
		}},
	)

	trajectory := expectRecord(t, projection["tool_trajectory"], "tool_trajectory")
	if trajectory["schema_version"] != "tool_trajectory.v1" ||
		trajectory["decision_kind"] != "tool_call" ||
		trajectory["selected_tool"] != "knowledge_query" ||
		trajectory["request_id"] != "req-tool-trajectory" ||
		trajectory["run_id"] != "run-tool-trajectory" ||
		trajectory["trace_id"] != "trace-tool-trajectory" ||
		trajectory["conversation_id"] != "conv-tool-trajectory" ||
		trajectory["surface"] != "campus-web" ||
		trajectory["release"] != "staging-2026-07-03" {
		t.Fatalf("tool trajectory = %#v", trajectory)
	}
	calls, ok := trajectory["tool_calls"].([]map[string]any)
	if !ok || len(calls) != 1 {
		t.Fatalf("tool calls = %#v, want one typed call", trajectory["tool_calls"])
	}
	if calls[0]["tool_name"] != "knowledge_query" ||
		calls[0]["status"] != "completed" ||
		calls[0]["result_kind"] != "route_plan" ||
		calls[0]["arguments_hash"] != "sha256:args" ||
		calls[0]["duration_ms"] != int64(100) ||
		calls[0]["provider"] != "openai" ||
		calls[0]["model"] != "gpt-5-mini" {
		t.Fatalf("tool call = %#v", calls[0])
	}
	serialized := stringifyForTest(projection)
	for _, forbidden := range []string{"must not leak", "raw_prompt", "raw_provider_result", "authorization"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("tool trajectory projection leaked %q: %s", forbidden, serialized)
		}
	}
}

func TestBuildToolTrajectoryProjectionClassifiesDirectAnswerAndFailClosed(t *testing.T) {
	direct := buildAgentRuntimeEvalProjection(
		execution.DurableRun{
			RunID:          "run-direct",
			ConversationID: "conv-direct",
			RequestID:      "req-direct",
			TraceID:        "trace-direct",
			Surface:        "campus-web",
			Status:         execution.DurableRunStatusCompleted,
			TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
		},
		nil,
		nil,
		[]execution.StepResultProjection{{
			ResultID:   "finalization.write:result:1",
			StepID:     "finalization.write",
			RunID:      "run-direct",
			Status:     "completed",
			ResultKind: "final_response",
			SanitizedPayload: map[string]any{
				"direct_answer": true,
			},
		}},
	)
	directTrajectory := expectRecord(t, direct["tool_trajectory"], "direct.tool_trajectory")
	if directTrajectory["decision_kind"] != "direct_answer" || directTrajectory["selected_tool"] != "" {
		t.Fatalf("direct tool trajectory = %#v", directTrajectory)
	}

	failClosed := buildAgentRuntimeEvalProjection(
		execution.DurableRun{
			RunID:           "run-fail-closed",
			ConversationID:  "conv-fail-closed",
			RequestID:       "req-fail-closed",
			TraceID:         "trace-fail-closed",
			Surface:         "campus-web",
			Status:          execution.DurableRunStatusFailed,
			TerminalReason:  execution.DurableTerminalReasonToolClosed,
			FailCloseReason: "tool_not_open",
		},
		nil,
		nil,
		nil,
	)
	failClosedTrajectory := expectRecord(t, failClosed["tool_trajectory"], "fail_closed.tool_trajectory")
	if failClosedTrajectory["decision_kind"] != "fail_closed" ||
		failClosedTrajectory["fail_close_reason"] != "tool_not_open" {
		t.Fatalf("fail-closed tool trajectory = %#v", failClosedTrajectory)
	}
}

func stringifyForTest(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return err.Error()
	}
	return string(payload)
}
