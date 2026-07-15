package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityFailsClosedWhenDirectAnswerMissingTerminalEnvelope(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 32, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-missing-envelope",
		"conv-primary-agent-missing-envelope",
		now,
		ragHandoffForDurableWorkerTest("hi 你是谁"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-missing-envelope",
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-missing-envelope",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:missing-envelope",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-missing-envelope",
		RequestID:        "req-primary-agent-missing-envelope",
		RunID:            "run-primary-agent-missing-envelope",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-missing-envelope",
		VisibleToolNames: []string{"transport_schedule_lookup"},
	})
	if err == nil {
		t.Fatal("expected direct primary agent answer without terminal envelope to fail")
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-missing-envelope")
	if listErr != nil {
		t.Fatalf("list steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["failure_kind"] != "agent_runtime_missing_terminal_envelope" {
		t.Fatalf("steps = %#v", steps)
	}
}

func TestWriteFinalizationActivityKeepsDirectPrimaryAgentToolNullableWithAgentProvenance(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 45, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-direct-finalization",
		"conv-primary-agent-direct-finalization",
		now,
		nil,
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:direct"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-direct-finalization", "agent/primary/result")
	preparePrimaryAgentFinalizationRunForTest(
		t,
		server,
		store,
		"run-primary-agent-direct-finalization",
		now,
		map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "legacy string that must not be consumed",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id": "resp-primary-agent-direct-finalization",
			"selected_tools":       []string{},
			"status":               "completed",
			"tool_results":         []map[string]any{},
			"terminal_reason":      "answer_completed",
		},
	)

	_, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-direct-finalization",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-direct-finalization")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["selected_tool"] != nil {
		t.Fatalf("selected_tool = %#v, want nil for direct no-tool branch", finalizationResponse["selected_tool"])
	}
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	workflowTrace := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if workflowTrace["selected_tool"] != "none" ||
		workflowTrace["workflow_mode"] != "terminal" ||
		workflowTrace["first_decision_actor"] != "primary_agent" ||
		workflowTrace["direct_vs_delegate_branch"] != "direct_answer" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	traceSteps := expectRecordList(t, workflowTrace["trace_steps"], "trace_steps")
	if len(traceSteps) != 2 {
		t.Fatalf("trace_steps = %#v, want agent.primary and finalization.write", workflowTrace["trace_steps"])
	}
	if traceSteps[0]["step_id"] != "agent.primary" ||
		traceSteps[0]["span_kind"] != "agent" ||
		traceSteps[0]["parent_step_id"] != "" {
		t.Fatalf("agent.primary trace step = %#v", traceSteps[0])
	}
	if traceSteps[1]["step_id"] != "finalization.write" ||
		traceSteps[1]["span_kind"] != "finalization" ||
		traceSteps[1]["parent_step_id"] != "agent.primary" {
		t.Fatalf("finalization.write trace step = %#v", traceSteps[1])
	}
}

func TestWriteFinalizationActivityProjectsPrimaryAgentToolCallTrace(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 10, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-tool-finalization",
		"conv-primary-agent-tool-finalization",
		now,
		nil,
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:tool"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(
		"run-primary-agent-tool-finalization",
		"agent/primary/result",
	)
	preparePrimaryAgentFinalizationRunForTest(
		t,
		server,
		store,
		"run-primary-agent-tool-finalization",
		now,
		map[string]any{
			"agent_result_ref":     agentResultRef,
			"provider_response_id": "resp-primary-agent-tool-finalization",
			"selected_tools":       []string{"transport_schedule_lookup"},
			"status":               "completed",
			"terminal_envelope": map[string]any{
				"kind":        "answer",
				"answer_text": "当前还不能稳定确认校车时刻。",
			},
			"tool_results": []map[string]any{{
				"arguments_json":    map[string]any{"query_text": "明天去丰台的校车", "intent": "next_departure"},
				"tool":              "transport_schedule_lookup",
				"fail_close_reason": "source_truth_unavailable",
				"payload_kind":      "transport_schedule_lookup",
				"result": map[string]any{
					"outcome": "temporarily_unverifiable",
				},
				"result_ref": "sdk-tool-result:transport-schedule:1",
				"status":     "completed",
				"tool_name":  "transport_schedule_lookup",
			}},
			"terminal_reason": "answer_completed",
		},
	)

	_, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-tool-finalization",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-tool-finalization")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("selected_tool = %#v, want transport_schedule_lookup", finalizationResponse["selected_tool"])
	}
	workflowTrace := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if workflowTrace["selected_tool"] != "transport_schedule_lookup" ||
		workflowTrace["workflow_mode"] != "single_step" ||
		workflowTrace["first_decision_actor"] != "primary_agent" ||
		workflowTrace["direct_vs_delegate_branch"] != "tool" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	toolCalls := expectRecordList(t, workflowTrace["tool_call_summaries"], "tool_call_summaries")
	if len(toolCalls) != 1 {
		t.Fatalf("tool_call_summaries = %#v, want one bounded tool summary", workflowTrace["tool_call_summaries"])
	}
	toolCall := toolCalls[0]
	if toolCall["tool_name"] != "transport_schedule_lookup" ||
		toolCall["tool"] != "transport_schedule_lookup" ||
		toolCall["payload_kind"] != "transport_schedule_lookup" ||
		toolCall["result_status"] != "temporarily_unverifiable" ||
		toolCall["fail_close_reason"] != "source_truth_unavailable" ||
		toolCall["result_projection"] != "bounded_summary" ||
		toolCall["raw_result_included"] != false {
		t.Fatalf("tool call summary = %#v, want bounded transport schedule failure summary", toolCall)
	}
	if _, exists := toolCall["result"]; exists {
		t.Fatalf("tool call summary leaked raw result: %#v", toolCall)
	}
	traceSteps := expectRecordList(t, workflowTrace["trace_steps"], "trace_steps")
	if len(traceSteps) != 3 {
		t.Fatalf("trace_steps = %#v, want agent/tool/finalization steps", workflowTrace["trace_steps"])
	}
	retryCount, ok := numericValue(traceSteps[1]["retry_count"])
	if !ok ||
		traceSteps[1]["span_kind"] != "tool_call" ||
		traceSteps[1]["parent_step_id"] != "agent.primary" ||
		traceSteps[1]["result_status"] != "temporarily_unverifiable" ||
		retryCount != 0 {
		t.Fatalf("tool trace step = %#v, want bounded tool_call timeline fields", traceSteps[1])
	}
}

func TestWriteFinalizationActivityCompletesPrimaryAgentOutOfScopeAsRejected(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 15, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-out-of-scope",
		"conv-primary-agent-out-of-scope",
		now,
		ragHandoffForDurableWorkerTest("帮我订一张机票"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:002"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-out-of-scope", "agent/primary/result")
	preparePrimaryAgentFinalizationRunForTest(
		t,
		server,
		store,
		"run-primary-agent-out-of-scope",
		now,
		map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "这个请求不属于校园问答助手当前可处理的范围。",
			"terminal_envelope":    map[string]any{"kind": "out_of_scope", "reason": "这个请求不属于校园问答助手当前可处理的范围。"},
			"provider_response_id": "resp-primary-agent-out-of-scope",
			"selected_tools":       []string{},
			"status":               "completed",
			"tool_results":         []map[string]any{},
			"terminal_reason":      "out_of_scope",
			"usage": map[string]any{
				"input_tokens":        11,
				"output_tokens":       7,
				"cached_input_tokens": 0,
			},
		},
	)

	_, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-out-of-scope",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	completedRun, err := store.GetRun(context.Background(), "run-primary-agent-out-of-scope")
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.TerminalReason != execution.DurableTerminalReasonPolicyRejected {
		t.Fatalf("terminal reason = %q", completedRun.TerminalReason)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-out-of-scope")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["status"] != "rejected" {
		t.Fatalf("status = %#v", finalizationResponse["status"])
	}
	errorBody, ok := finalizationResponse["error"].(map[string]any)
	if !ok {
		t.Fatalf("error = %#v", finalizationResponse["error"])
	}
	if errorBody["code"] != "request_rejected" || errorBody["retryable"] != false {
		t.Fatalf("error = %#v", errorBody)
	}
	traceSummary, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok || traceSummary["direct_vs_delegate_branch"] != "out_of_scope" {
		t.Fatalf("workflow trace summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
	steps, err := store.ListRunSteps(context.Background(), "run-primary-agent-out-of-scope")
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	var finalizationStep *execution.RunStepProjection
	for index := range steps {
		if steps[index].StepID == "finalization.write" && steps[index].Status == "completed" {
			finalizationStep = &steps[index]
		}
	}
	if finalizationStep == nil {
		t.Fatalf("finalization step missing: %#v", steps)
		return
	}
	response, ok := finalizationStep.SanitizedPayload["finalized_response"].(map[string]any)
	if !ok || response["status"] != "rejected" {
		t.Fatalf("finalization step payload = %#v", finalizationStep.SanitizedPayload)
	}
}

func expectRecordList(t *testing.T, value any, name string) []map[string]any {
	t.Helper()
	switch items := value.(type) {
	case []map[string]any:
		return items
	case []any:
		records := make([]map[string]any, 0, len(items))
		for index, item := range items {
			record, ok := item.(map[string]any)
			if !ok {
				t.Fatalf("%s[%d] missing or wrong type: %#v", name, index, item)
			}
			records = append(records, record)
		}
		return records
	default:
		t.Fatalf("%s missing or wrong type: %#v", name, value)
		return nil
	}
}

func preparePrimaryAgentFinalizationRunForTest(
	t *testing.T,
	server *Server,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
	agentMetadata map[string]any,
) {
	t.Helper()
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		if _, exists := agentMetadata["activity_attempt"]; !exists {
			agentMetadata["activity_attempt"] = 1
		}
		if _, exists := agentMetadata["model_name"]; !exists {
			agentMetadata["model_name"] = "gpt-4.1"
		}
		if _, exists := agentMetadata["model_provider"]; !exists {
			agentMetadata["model_provider"] = "openai"
		}
		if _, exists := agentMetadata["prompt_trace"]; !exists {
			agentMetadata["prompt_trace"] = primaryAgentPromptTraceForFinalizationTest()
		}
		for key, value := range agentMetadata {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}
}
