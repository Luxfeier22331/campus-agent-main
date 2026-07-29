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
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-missing-envelope",
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-missing-envelope",
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"model_request_count": 2,
				"input_tokens":        12,
				"output_tokens":       8,
				"cached_input_tokens": 3,
				"usage_observed":      true,
			},
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

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-missing-envelope",
		RequestID:        "req-primary-agent-missing-envelope",
		RunID:            "run-primary-agent-missing-envelope",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-missing-envelope",
		VisibleToolNames: []string{},
	})
	_, err := server.ExecutePrimaryAgentActivity(context.Background(), input)
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
	attempts, listAttemptsErr := store.ListStepAttempts(context.Background(), "run-primary-agent-missing-envelope")
	if listAttemptsErr != nil {
		t.Fatalf("list attempts: %v", listAttemptsErr)
	}
	if len(attempts) != 1 ||
		attempts[0].Status != "failed" ||
		attempts[0].ModelRequestCount != 2 ||
		attempts[0].InputTokens != 12 ||
		attempts[0].OutputTokens != 8 ||
		attempts[0].CachedInputTokens != 3 ||
		!attempts[0].UsageObserved {
		t.Fatalf("failed agent attempt lost observed usage: %#v", attempts)
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
			"status":               "completed",
			"tool_results":         []map[string]any{},
			"terminal_reason":      "answer_completed",
		},
	)

	_, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			FinalizedAt:    now.Add(4 * time.Second),
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
	if _, exists := finalizationResponse["selected_tool"]; exists {
		t.Fatalf("direct product response must not expose selected_tool: %#v", finalizationResponse)
	}
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	workflowTrace := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if workflowTrace["execution_path"] != "direct" ||
		workflowTrace["terminal_reason"] != "answer" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	if _, exists := workflowTrace["trace_steps"]; exists {
		t.Fatalf("product workflow trace must not expose internal steps: %#v", workflowTrace)
	}
}

func TestWriteFinalizationActivityKeepsToolCallTraceInternal(t *testing.T) {
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
			FinalizedAt:    now.Add(4 * time.Second),
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
	if _, exists := finalizationResponse["selected_tool"]; exists {
		t.Fatalf("product response must not expose selected_tool: %#v", finalizationResponse)
	}
	workflowTrace := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if workflowTrace["execution_path"] != "tool_assisted" ||
		workflowTrace["terminal_reason"] != "answer" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	for _, field := range []string{"tool_call_summaries", "trace_steps", "selected_tool"} {
		if _, exists := workflowTrace[field]; exists {
			t.Fatalf("product workflow trace must not expose %s: %#v", field, workflowTrace)
		}
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
		agentRequestForDurableWorkerTest("帮我订一张机票"),
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
			FinalizedAt:    now.Add(4 * time.Second),
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
	if !ok || traceSummary["execution_path"] != "rejected" ||
		traceSummary["terminal_reason"] != "out_of_scope" {
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
