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
				AttemptID:       temporalStepAttemptID("run-tool-trajectory", "knowledge.search.1", 1),
				StepID:          "knowledge.search.1",
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
					"selected_tools":      []any{"knowledge_query"},
					"tool_results": []any{
						map[string]any{
							"arguments_json_sha256":    "sha256:args",
							"arguments_schema_sha256":  "sha256:schema",
							"arguments_schema_version": "knowledge_search.args.v1",
							"authorization":            "must not leak",
							"payload_kind":             "knowledge_search",
							"result": map[string]any{
								"outcome":          "found",
								"retrieval_target": "student_rules",
								"include_history":  false,
							},
							"result_ref": "projection://runs/run-tool-trajectory/knowledge/search/1",
							"status":     "completed",
							"tool_name":  "knowledge_search",
						},
					},
				},
			},
			{
				ResultID:      "knowledge.search.1:result:1",
				StepID:        "knowledge.search.1",
				RunID:         "run-tool-trajectory",
				AttemptID:     temporalStepAttemptID("run-tool-trajectory", "knowledge.search.1", 1),
				Status:        "completed",
				ResultKind:    "knowledge_search_result",
				ProjectionRef: "projection://runs/run-tool-trajectory/knowledge/search/1",
				CreatedAt:     now.Add(90 * time.Millisecond),
				SanitizedPayload: map[string]any{
					"activity_attempt": 1,
					"candidate_count":  4,
					"include_history":  false,
					"invocation_id":    "search-1",
					"outcome":          "found",
					"query_sha256":     "sha256:query",
					"retrieval_target": "student_rules",
					"search_ordinal":   1,
				},
			},
		},
	)

	trajectory := expectRecord(t, projection["tool_trajectory"], "tool_trajectory")
	if trajectory["schema_version"] != "tool_trajectory.v2" ||
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
		calls[0]["result_kind"] != "agent_handoff" ||
		calls[0]["provider"] != "openai" ||
		calls[0]["model"] != "gpt-5-mini" {
		t.Fatalf("tool call = %#v", calls[0])
	}
	internalCalls, ok := trajectory["internal_tool_calls"].([]map[string]any)
	if !ok || len(internalCalls) != 1 {
		t.Fatalf("internal tool calls = %#v, want one search", trajectory["internal_tool_calls"])
	}
	internalCall := internalCalls[0]
	if internalCall["tool_name"] != "knowledge_search" ||
		internalCall["search_ordinal"] != 1 ||
		internalCall["duration_ms"] != int64(40) ||
		internalCall["outcome"] != "found" {
		t.Fatalf("internal tool call = %#v", internalCall)
	}
	evalSafeArgs := expectRecord(t, internalCall["eval_safe_args"], "internal_tool_calls[0].eval_safe_args")
	if evalSafeArgs["target"] != "student_rules" || evalSafeArgs["include_history"] != false {
		t.Fatalf("eval_safe_args = %#v, want target and history intent", evalSafeArgs)
	}
	serialized := stringifyForTest(projection)
	for _, forbidden := range []string{"must not leak", "raw_prompt", "raw_provider_result", "authorization"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("tool trajectory projection leaked %q: %s", forbidden, serialized)
		}
	}
}

func TestBuildAgentRuntimeEvalProjectionExcludesPriorActivityAttempt(t *testing.T) {
	run := execution.DurableRun{
		RunID:          "run-retried-agent",
		ConversationID: "conv-retried-agent",
		RequestID:      "req-retried-agent",
		TraceID:        "trace-retried-agent",
		SelectedTool:   "knowledge_query",
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
				"selected_tools":   []any{"knowledge_query"},
			},
		},
		knowledgeSearchEvalResultForAttempt(run.RunID, 1, "student_rules", "prior context"),
		knowledgeSearchEvalResultForAttempt(run.RunID, 2, "curriculum", "successful context"),
	}
	attempts := []execution.StepAttemptProjection{
		{
			AttemptID:       temporalStepAttemptID(run.RunID, "knowledge.search.1", 1),
			StepID:          "knowledge.search.1",
			RunID:           run.RunID,
			Attempt:         1,
			ActivityAttempt: 1,
		},
		{
			AttemptID:       temporalStepAttemptID(run.RunID, "knowledge.search.1", 2),
			StepID:          "knowledge.search.1",
			RunID:           run.RunID,
			Attempt:         2,
			ActivityAttempt: 2,
		},
	}

	projection := buildAgentRuntimeEvalProjection(run, nil, attempts, results)
	planning := expectRecord(t, projection["planning"], "planning")
	resolvedTargets, _ := planning["resolved_targets"].([]any)
	if len(resolvedTargets) != 1 || resolvedTargets[0] != "curriculum" {
		t.Fatalf("planning.resolved_targets = %#v", planning["resolved_targets"])
	}
	rag := expectRecord(t, projection["rag"], "rag")
	contexts, _ := rag["retrieved_contexts"].([]any)
	if len(contexts) != 1 || contexts[0] != "successful context" {
		t.Fatalf("rag.retrieved_contexts = %#v", rag["retrieved_contexts"])
	}
	trajectory := expectRecord(t, projection["tool_trajectory"], "tool_trajectory")
	internalCalls, _ := trajectory["internal_tool_calls"].([]map[string]any)
	if len(internalCalls) != 1 {
		t.Fatalf("internal_tool_calls = %#v", trajectory["internal_tool_calls"])
	}
	args := expectRecord(t, internalCalls[0]["eval_safe_args"], "eval_safe_args")
	if args["target"] != "curriculum" {
		t.Fatalf("eval_safe_args = %#v", args)
	}
}

func knowledgeSearchEvalResultForAttempt(
	runID string,
	activityAttempt int,
	target string,
	snippet string,
) execution.StepResultProjection {
	return execution.StepResultProjection{
		ResultID:   "knowledge.search.1:result:" + string(rune('0'+activityAttempt)),
		StepID:     "knowledge.search.1",
		RunID:      runID,
		AttemptID:  temporalStepAttemptID(runID, "knowledge.search.1", activityAttempt),
		Status:     "completed",
		ResultKind: "knowledge_search_result",
		SanitizedPayload: map[string]any{
			"activity_attempt": activityAttempt,
			"evidence": []any{map[string]any{
				"document_id": target + "-document",
				"snippet":     snippet,
			}},
			"invocation_id":    "search-1",
			"outcome":          "found",
			"retrieval_target": target,
			"search_ordinal":   1,
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
