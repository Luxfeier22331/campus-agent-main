package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestProjectedAvailableToolsExcludesInternalSteps(t *testing.T) {
	steps := []execution.RunStepProjection{
		{StepID: "agent.primary", Tool: "memory"},
		{StepID: "sdk_tool.execute.campus_search.1", Tool: campusSearchToolName},
		{StepID: "memory.append", Tool: "memory"},
		{StepID: "agent.primary.retry", SanitizedPayload: map[string]any{
			"visible_tool_names": []any{
				"memory",
				personalMemoryRecallToolName,
				campusSearchToolName,
			},
		}},
	}

	got := projectedAvailableTools(steps, nil)
	want := []string{campusSearchToolName, personalMemoryRecallToolName}
	if len(got) != len(want) {
		t.Fatalf("projected available tools = %#v, want %#v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("projected available tools = %#v, want %#v", got, want)
		}
	}
}

func TestBuildAgentRuntimeEvalProjectionIncludesToolTrajectory(t *testing.T) {
	now := time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC)
	projection := buildAgentRuntimeEvalProjection(
		execution.DurableRun{
			RunID:          "run-tool-trajectory",
			ConversationID: "conv-tool-trajectory",
			RequestID:      "req-tool-trajectory",
			TraceID:        "trace-tool-trajectory",
			Surface:        "campus-web",
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
				"visible_tool_names": []any{"personal_memory_recall"},
			},
		}},
		[]execution.StepAttemptProjection{
			{
				AttemptID:       temporalStepAttemptID("run-tool-trajectory", "agent.primary", 1),
				StepID:          "agent.primary",
				RunID:           "run-tool-trajectory",
				Status:          "completed",
				Attempt:         1,
				ActivityAttempt: 1,
				DurationMS:      100,
				ModelProvider:   "openai",
				ModelName:       "gpt-5-mini",
			},
			{
				AttemptID:       temporalStepAttemptID("run-tool-trajectory", "sdk_tool.execute.personal_memory_recall.1", 1),
				StepID:          "sdk_tool.execute.personal_memory_recall.1",
				RunID:           "run-tool-trajectory",
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
				RunID:         "run-tool-trajectory",
				AttemptID:     temporalStepAttemptID("run-tool-trajectory", "agent.primary", 1),
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
				RunID:         "run-tool-trajectory",
				AttemptID:     temporalStepAttemptID("run-tool-trajectory", "sdk_tool.execute.personal_memory_recall.1", 1),
				Status:        "completed",
				ResultKind:    "typed_tool_result",
				ProjectionRef: "projection://runs/run-tool-trajectory/sdk-tools/personal_memory_recall/1",
				CreatedAt:     now.Add(90 * time.Millisecond),
				SanitizedPayload: map[string]any{
					"activity_attempt":      1,
					"arguments_json_sha256": "sha256:args",
					"authorization":         "must not leak",
					"result":                map[string]any{"outcome": "recalled"},
					"tool_name":             "personal_memory_recall",
				},
			},
		},
	)

	trajectory := expectRecord(t, projection["tool_trajectory"], "tool_trajectory")
	if trajectory["schema_version"] != "tool_trajectory.v3" ||
		trajectory["decision_kind"] != "tool_assisted" ||
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
	if calls[0]["tool_name"] != "personal_memory_recall" ||
		calls[0]["status"] != "completed" ||
		calls[0]["result_kind"] != "typed_tool_result" ||
		calls[0]["duration_ms"] != int64(40) {
		t.Fatalf("tool call = %#v", calls[0])
	}
	if _, exists := calls[0]["eval_safe_args"]; exists {
		t.Fatalf("personal memory call must not expose eval_safe_args: %#v", calls[0])
	}
	if _, exists := trajectory["selected_tool"]; exists {
		t.Fatalf("tool trajectory still publishes selected_tool: %#v", trajectory)
	}
	if _, exists := trajectory["internal_tool_calls"]; exists {
		t.Fatalf("tool trajectory still publishes internal_tool_calls: %#v", trajectory)
	}
	serialized := stringifyForTest(projection)
	for _, forbidden := range []string{"must not leak", "raw_prompt", "raw_provider_result", "authorization"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("tool trajectory projection leaked %q: %s", forbidden, serialized)
		}
	}
}

func TestBuildAgentRuntimeEvalProjectionProjectsCurrentToolTrajectory(t *testing.T) {
	run := execution.DurableRun{
		RunID:          "run-retried-agent",
		ConversationID: "conv-retried-agent",
		RequestID:      "req-retried-agent",
		TraceID:        "trace-retried-agent",
		Status:         execution.DurableRunStatusCompleted,
		TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
	}
	results := []execution.StepResultProjection{
		{
			ResultID:   "agent.primary:result:2",
			StepID:     "agent.primary",
			RunID:      run.RunID,
			AttemptID:  temporalStepAttemptID(run.RunID, "agent.primary", 2),
			Status:     "completed",
			ResultKind: "agent_final_output",
			SanitizedPayload: map[string]any{
				"activity_attempt": 2,
			},
		},
		personalMemoryEvalResultForAttempt(run.RunID, 1),
		personalMemoryEvalResultForAttempt(run.RunID, 2),
		{
			ResultID:   "sdk_tool.execute.campus_search.1:result:2",
			StepID:     "sdk_tool.execute.campus_search.1",
			RunID:      run.RunID,
			AttemptID:  temporalStepAttemptID(run.RunID, "sdk_tool.execute.campus_search.1", 2),
			Status:     "completed",
			ResultKind: "typed_tool_result",
			SanitizedPayload: map[string]any{
				"result": campusSearchResult([]campusSearchEvidence{{
					EvidenceRef:  "evidence://" + strings.Repeat("c", 64),
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
				}}),
			},
		},
		{
			ResultID:   "finalization.write:result:1",
			StepID:     "finalization.write",
			RunID:      run.RunID,
			Status:     "completed",
			ResultKind: "final_answer_projection",
			SanitizedPayload: map[string]any{
				"finalized_response": map[string]any{
					"result": map[string]any{
						"sources": []any{map[string]any{
							"document_id":  "curriculum-document",
							"evidence_ref": "evidence://successful-context",
							"kind":         "campus_document",
							"snippet":      "successful context",
						}},
					},
				},
			},
		},
	}
	projection := buildAgentRuntimeEvalProjection(run, nil, nil, results)
	planning := expectRecord(t, projection["planning"], "planning")
	toolSequence, _ := planning["tool_sequence"].([]any)
	if len(toolSequence) != 2 ||
		expectRecord(t, toolSequence[0], "planning.tool_sequence[0]")["tool_name"] != "personal_memory_recall" ||
		expectRecord(t, toolSequence[1], "planning.tool_sequence[1]")["tool_name"] != "campus_search" {
		t.Fatalf("planning.tool_sequence = %#v", planning["tool_sequence"])
	}
	rag := expectRecord(t, projection["rag"], "rag")
	contexts, _ := rag["retrieved_contexts"].([]any)
	if len(contexts) != 1 || contexts[0] != "successful context" {
		t.Fatalf("rag.retrieved_contexts = %#v", rag["retrieved_contexts"])
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
	runID string,
	activityAttempt int,
) execution.StepResultProjection {
	return execution.StepResultProjection{
		ResultID:   "sdk_tool.execute.personal_memory_recall.1:result:" + string(rune('0'+activityAttempt)),
		StepID:     "sdk_tool.execute.personal_memory_recall.1",
		RunID:      runID,
		AttemptID:  temporalStepAttemptID(runID, "sdk_tool.execute.personal_memory_recall.1", activityAttempt),
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
	if directTrajectory["decision_kind"] != "direct_answer" {
		t.Fatalf("direct tool trajectory = %#v", directTrajectory)
	}
	if _, exists := directTrajectory["selected_tool"]; exists {
		t.Fatalf("direct tool trajectory still publishes selected_tool: %#v", directTrajectory)
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
