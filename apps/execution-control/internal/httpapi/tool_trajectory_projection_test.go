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
			ConversationID: "conv-tool-trajectory",
			RequestID:      "req-tool-trajectory",
			Surface:        "campus-web",
			Status:         execution.DurableRunStatusCompleted,
			TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
			RuntimeVersions: map[string]any{
				"release": "staging-2026-07-03",
			},
		},
		[]execution.RunStepProjection{{
			StepID:         "agent.primary",
			RequestID:      "req-tool-trajectory",
			ConversationID: "conv-tool-trajectory",
			StepKind:       "agent",
			Status:         "completed",
			TaskQueue:      "campus-agent.activity.agent",
			StartedAt:      now,
			CompletedAt:    now.Add(100 * time.Millisecond),
			SanitizedPayload: map[string]any{
				"raw_prompt":                  "must not leak",
				"visible_function_tool_names": []any{"personal_memory_recall"},
			},
		}},
		[]execution.StepAttemptProjection{
			{
				AttemptID:       temporalStepAttemptID("req-tool-trajectory", "agent.primary", 1),
				StepID:          "agent.primary",
				RequestID:       "req-tool-trajectory",
				Status:          "completed",
				Attempt:         1,
				ActivityAttempt: 1,
				DurationMS:      100,
				ModelProvider:   "openai",
				ModelName:       "gpt-5-mini",
			},
			{
				AttemptID:       temporalStepAttemptID("req-tool-trajectory", "sdk_tool.execute.personal_memory_recall.1", 1),
				StepID:          "sdk_tool.execute.personal_memory_recall.1",
				RequestID:       "req-tool-trajectory",
				Status:          "completed",
				Attempt:         1,
				ActivityAttempt: 1,
				DurationMS:      40,
			},
		},
		[]execution.StepResultProjection{
			{
				ResultID:      "agent.primary:result:1",
				StepID:        "agent.primary",
				RequestID:     "req-tool-trajectory",
				AttemptID:     temporalStepAttemptID("req-tool-trajectory", "agent.primary", 1),
				Status:        "completed",
				ResultKind:    "agent_final_output",
				ProjectionRef: "projection://runs/run-tool-trajectory/agent/primary/result",
				CreatedAt:     now.Add(100 * time.Millisecond),
				SanitizedPayload: map[string]any{
					"activity_attempt":    1,
					"raw_provider_result": "must not leak",
				},
			},
			{
				ResultID:      "sdk_tool.execute.personal_memory_recall.1:result:1",
				StepID:        "sdk_tool.execute.personal_memory_recall.1",
				RequestID:     "req-tool-trajectory",
				AttemptID:     temporalStepAttemptID("req-tool-trajectory", "sdk_tool.execute.personal_memory_recall.1", 1),
				Status:        "completed",
				ResultKind:    "typed_tool_result",
				ProjectionRef: "projection://runs/run-tool-trajectory/sdk-tools/personal_memory_recall/1",
				CreatedAt:     now.Add(90 * time.Millisecond),
				SanitizedPayload: map[string]any{
					"activity_attempt":      1,
					"arguments_json_sha256": "sha256:args",
					"result":                map[string]any{"outcome": "recalled"},
					"tool_name":             "personal_memory_recall",
				},
			},
		},
	)

	trajectory := expectRecord(t, projection["tool_trajectory"], "tool_trajectory")
	if trajectory["schema_version"] != "tool_trajectory.v4" ||
		trajectory["decision_kind"] != "tool_assisted" {
		t.Fatalf("tool trajectory = %#v", trajectory)
	}
	calls, ok := trajectory["tool_calls"].([]map[string]any)
	if !ok || len(calls) != 1 {
		t.Fatalf("tool calls = %#v, want one typed call", trajectory["tool_calls"])
	}
	if calls[0]["tool_name"] != "personal_memory_recall" {
		t.Fatalf("tool call = %#v", calls[0])
	}
	if _, exists := calls[0]["eval_safe_args"]; exists {
		t.Fatalf("personal memory call must not expose eval_safe_args: %#v", calls[0])
	}
	if len(calls[0]) != 1 {
		t.Fatalf("tool call contains non-eval fields: %#v", calls[0])
	}
}

func TestBuildAgentRuntimeEvalProjectionProjectsCurrentToolTrajectory(t *testing.T) {
	run := execution.DurableRun{
		ConversationID: "conv-retried-agent",
		RequestID:      "req-retried-agent",
		Status:         execution.DurableRunStatusCompleted,
		TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
	}
	results := []execution.StepResultProjection{
		{
			ResultID:   "agent.primary:result:2",
			StepID:     "agent.primary",
			RequestID:  run.RequestID,
			AttemptID:  temporalStepAttemptID(run.RequestID, "agent.primary", 2),
			Status:     "completed",
			ResultKind: "agent_final_output",
			SanitizedPayload: map[string]any{
				"activity_attempt": 2,
			},
		},
		personalMemoryEvalResultForAttempt(run.RequestID, 1),
		personalMemoryEvalResultForAttempt(run.RequestID, 2),
		{
			ResultID:   "sdk_tool.execute.campus_search.1:result:2",
			StepID:     "sdk_tool.execute.campus_search.1",
			RequestID:  run.RequestID,
			AttemptID:  temporalStepAttemptID(run.RequestID, "sdk_tool.execute.campus_search.1", 2),
			Status:     "completed",
			ResultKind: "typed_tool_result",
			SanitizedPayload: map[string]any{
				"result": campusSearchResult([]campusSearchResultItem{{
					ResultRef:    "result://" + strings.Repeat("c", 64),
					SourceKind:   "document",
					DocumentID:   "curriculum-document",
					Title:        "培养方案",
					SectionRef:   "/docs/regulations/student_rules/curriculum/v/current#requirements",
					SectionTitle: "毕业要求",
					RootUnitIDs:  []string{"requirements"},
					VersionID:    "curriculum-current",
					VersionLabel: "当前版本",
					VersionSlug:  "current",
					Text:         "successful context",
				}}, 1),
			},
		},
		{
			ResultID:   "finalization.write:result:1",
			StepID:     "finalization.write",
			RequestID:  run.RequestID,
			Status:     "completed",
			ResultKind: "final_answer_projection",
			SanitizedPayload: map[string]any{
				"finalization_summary": map[string]any{
					"answer_text":         "回答 [1]。",
					"campus_source_count": 1,
					"source_count":        1,
					"status":              "completed",
				},
			},
		},
	}
	projection := buildAgentRuntimeEvalProjection(run, nil, nil, results)
	contexts, _ := projection["retrieved_contexts"].([]any)
	if len(contexts) != 1 || contexts[0] != "successful context" {
		t.Fatalf("retrieved_contexts = %#v", projection["retrieved_contexts"])
	}
	trajectory := expectRecord(t, projection["tool_trajectory"], "tool_trajectory")
	calls, _ := trajectory["tool_calls"].([]map[string]any)
	if len(calls) != 2 {
		t.Fatalf("tool_calls = %#v", trajectory["tool_calls"])
	}
	if _, exists := calls[0]["eval_safe_args"]; exists {
		t.Fatalf("personal memory call must not expose eval_safe_args: %#v", calls[0])
	}
}

func personalMemoryEvalResultForAttempt(
	requestID string,
	activityAttempt int,
) execution.StepResultProjection {
	return execution.StepResultProjection{
		ResultID:   "sdk_tool.execute.personal_memory_recall.1:result:" + string(rune('0'+activityAttempt)),
		StepID:     "sdk_tool.execute.personal_memory_recall.1",
		RequestID:  requestID,
		AttemptID:  temporalStepAttemptID(requestID, "sdk_tool.execute.personal_memory_recall.1", activityAttempt),
		Status:     "completed",
		ResultKind: "typed_tool_result",
		SanitizedPayload: map[string]any{
			"activity_attempt": activityAttempt,
			"result":           map[string]any{"outcome": "recalled"},
			"tool_name":        "personal_memory_recall",
		},
	}
}

func TestBuildToolTrajectoryProjectionClassifiesDirectAnswerAndFailClosed(t *testing.T) {
	direct := buildAgentRuntimeEvalProjection(
		execution.DurableRun{
			ConversationID: "conv-direct",
			RequestID:      "req-direct",
			Surface:        "campus-web",
			Status:         execution.DurableRunStatusCompleted,
			TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
		},
		nil,
		nil,
		[]execution.StepResultProjection{{
			ResultID:   "finalization.write:result:1",
			StepID:     "finalization.write",
			RequestID:  "req-direct",
			Status:     "completed",
			ResultKind: "final_response",
			SanitizedPayload: map[string]any{
				"direct_answer": true,
			},
		}},
	)
	directTrajectory := expectRecord(t, direct["tool_trajectory"], "direct.tool_trajectory")
	if directTrajectory["decision_kind"] != "direct_answer" {
		t.Fatalf("direct tool trajectory = %#v", directTrajectory)
	}
	if _, exists := directTrajectory["selected_tool"]; exists {
		t.Fatalf("direct tool trajectory still publishes selected_tool: %#v", directTrajectory)
	}

	failClosed := buildAgentRuntimeEvalProjection(
		execution.DurableRun{
			ConversationID:  "conv-fail-closed",
			RequestID:       "req-fail-closed",
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
	if failClosedTrajectory["decision_kind"] != "fail_closed" {
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
