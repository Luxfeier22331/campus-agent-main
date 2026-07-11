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
			StepID:         "agent.primary",
			RunID:          "run-tool-trajectory",
			ConversationID: "conv-tool-trajectory",
			StepKind:       "agent",
			Status:         "completed",
			TaskQueue:      "campus-agent.activity.agent",
			StartedAt:      now,
			CompletedAt:    now.Add(100 * time.Millisecond),
			SanitizedPayload: map[string]any{
				"raw_prompt":         "must not leak",
				"visible_tool_names": []any{"knowledge_query", "transport_schedule_lookup"},
			},
		}},
		[]execution.StepAttemptProjection{
			{
				AttemptID:     "agent.primary:attempt:1",
				StepID:        "agent.primary",
				RunID:         "run-tool-trajectory",
				Status:        "completed",
				DurationMS:    100,
				ModelProvider: "openai",
				ModelName:     "gpt-5-mini",
			},
			{
				AttemptID:  "knowledge.search.search-1:attempt:1",
				StepID:     "knowledge.search.search-1",
				RunID:      "run-tool-trajectory",
				Status:     "completed",
				DurationMS: 40,
			},
		},
		[]execution.StepResultProjection{
			{
				ResultID:      "agent.primary:result:1",
				StepID:        "agent.primary",
				RunID:         "run-tool-trajectory",
				AttemptID:     "agent.primary:attempt:1",
				Status:        "completed",
				ResultKind:    "agent_final_output",
				ProjectionRef: "projection://runs/run-tool-trajectory/agent/primary/result",
				CreatedAt:     now.Add(100 * time.Millisecond),
				SanitizedPayload: map[string]any{
					"raw_provider_result": "must not leak",
					"selected_tools":      []any{"knowledge_query", "knowledge_search"},
					"tool_results": []any{
						map[string]any{
							"arguments_json_sha256":    "sha256:args",
							"arguments_schema_sha256":  "sha256:schema",
							"arguments_schema_version": "knowledge_search.args.v1",
							"authorization":            "must not leak",
							"payload_kind":             "knowledge_search",
							"result": map[string]any{
								"outcome":          "found",
								"resolved_scope":   "student_rules",
								"resolved_version": map[string]any{"mode": "current"},
							},
							"result_ref": "projection://runs/run-tool-trajectory/knowledge/search/search-1",
							"status":     "completed",
							"tool_name":  "knowledge_search",
						},
					},
				},
			},
			{
				ResultID:      "knowledge.search.search-1:result:1",
				StepID:        "knowledge.search.search-1",
				RunID:         "run-tool-trajectory",
				AttemptID:     "knowledge.search.search-1:attempt:1",
				Status:        "completed",
				ResultKind:    "knowledge_search_result",
				ProjectionRef: "projection://runs/run-tool-trajectory/knowledge/search/search-1",
				CreatedAt:     now.Add(90 * time.Millisecond),
				SanitizedPayload: map[string]any{
					"resolved_scope": "student_rules",
				},
			},
		},
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
		calls[0]["result_kind"] != "knowledge_search" ||
		calls[0]["arguments_hash"] != "sha256:args" ||
		calls[0]["duration_ms"] != int64(40) ||
		calls[0]["provider"] != "openai" ||
		calls[0]["model"] != "gpt-5-mini" {
		t.Fatalf("tool call = %#v", calls[0])
	}
	evalSafeArgs := expectRecord(t, calls[0]["eval_safe_args"], "tool_calls[0].eval_safe_args")
	if evalSafeArgs["scope"] != "student_rules" || evalSafeArgs["version_mode"] != "current" {
		t.Fatalf("eval_safe_args = %#v, want bounded knowledge selection", evalSafeArgs)
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
			FailCloseReason: "unsupported_tool_hint",
		},
		nil,
		nil,
		nil,
	)
	failClosedTrajectory := expectRecord(t, failClosed["tool_trajectory"], "fail_closed.tool_trajectory")
	if failClosedTrajectory["decision_kind"] != "fail_closed" ||
		failClosedTrajectory["fail_close_reason"] != "unsupported_tool_hint" {
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
