package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestWriteFinalizationActivityCompletesPrimaryAgentResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 11, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-finalization",
		"conv-primary-agent-finalization",
		now,
		ragHandoffForDurableWorkerTest("hi 你是谁"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-finalization", "agent/primary/result")
	run, err := store.GetRun(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		for key, value := range map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "你好，我是校园问答助手。",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id": "resp-primary-agent-finalization",
			"sdk_trace_ref":        "trace://openai-agents/trace-primary-agent-finalization",
			"selected_tools":       []string{"transport_schedule_lookup"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "transport_schedule_lookup",
				"capability":   "campus_services",
				"payload_kind": "transport_schedule_lookup",
				"result_ref":   "agent-runtime://run-primary-agent-finalization/tools/transport_schedule_lookup",
				"result":       map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
			"usage": map[string]any{
				"input_tokens":             12,
				"output_tokens":            8,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 42,
			},
		} {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-finalization",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-finalization",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}

	output, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-finalization",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, err := store.GetRun(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.FinalResponseRef != output.ProjectionRef {
		t.Fatalf("final response ref = %q, want %q", completedRun.FinalResponseRef, output.ProjectionRef)
	}
	if completedRun.SelectedCapability != "campus_services" {
		t.Fatalf("run selected capability = %q, want campus_services", completedRun.SelectedCapability)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var finalizationResponse map[string]any
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted {
			var ok bool
			finalizationResponse, ok = event.Payload["response"].(map[string]any)
			if !ok {
				t.Fatalf("finalization response payload = %#v", event.Payload["response"])
			}
		}
	}
	if finalizationResponse == nil {
		t.Fatal("finalization.completed event missing")
	}
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	if finalizationResponse["selected_capability"] != "campus_services" {
		t.Fatalf("selected_capability = %#v", finalizationResponse["selected_capability"])
	}
	workflowTrace, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok {
		t.Fatalf("workflow_trace_summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
	if workflowTrace["workflow_mode"] != "single_step" ||
		workflowTrace["first_decision_actor"] != "primary_agent" ||
		workflowTrace["selected_capability"] != "campus_services" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	toolCalls := expectRecordList(t, workflowTrace["tool_call_summaries"], "tool_call_summaries")
	if len(toolCalls) != 1 || toolCalls[0]["result_projection"] != "bounded_summary" {
		t.Fatalf("tool_call_summaries = %#v, want bounded primary-agent tool summary", workflowTrace["tool_call_summaries"])
	}
	results, err := store.ListStepResults(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var finalizationResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "finalization.write" {
			finalizationResult = &results[index]
		}
	}
	if finalizationResult == nil {
		t.Fatal("finalization.write result missing")
		return
	}
	projectedResponse, ok := finalizationResult.SanitizedPayload["finalized_response"].(map[string]any)
	if !ok {
		t.Fatalf("finalization result payload = %#v", finalizationResult.SanitizedPayload)
	}
	if projectedResponse["answer_text"] != finalizationResponse["answer_text"] ||
		projectedResponse["trace_id"] != finalizationResponse["trace_id"] {
		t.Fatalf("projected response drifted from event: %#v", projectedResponse)
	}
}

func TestWriteFinalizationActivityCompletesPrimaryAgentClarification(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-clarification",
		"conv-primary-agent-clarification",
		now,
		ragHandoffForDurableWorkerTest("校车怎么走"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-clarification", "agent/primary/result")
	run, err := store.GetRun(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		for key, value := range map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "请问你要查询哪条校车线路或哪个校区？",
			"terminal_envelope":    map[string]any{"kind": "clarification_required", "follow_up_question": "请问你要查询哪条校车线路或哪个校区？"},
			"provider_response_id": "resp-primary-agent-clarification",
			"sdk_trace_ref":        "trace://openai-agents/trace-primary-agent-clarification",
			"selected_tools":       []string{},
			"tool_results":         []map[string]any{},
			"terminal_reason":      "clarification_required",
			"usage": map[string]any{
				"input_tokens":             10,
				"output_tokens":            9,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 18,
			},
		} {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-clarification",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-clarification",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}

	output, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			RunID:          "run-primary-agent-clarification",
			TraceID:        "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, err := store.GetRun(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("get completed run: %v", err)
	}
	if completedRun.TerminalReason != execution.DurableTerminalReasonClarificationRequired {
		t.Fatalf("terminal reason = %q", completedRun.TerminalReason)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var finalizationResponse map[string]any
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted {
			var ok bool
			finalizationResponse, ok = event.Payload["response"].(map[string]any)
			if !ok {
				t.Fatalf("finalization response payload = %#v", event.Payload["response"])
			}
		}
	}
	if finalizationResponse["status"] != "needs_clarification" {
		t.Fatalf("status = %#v", finalizationResponse["status"])
	}
	if finalizationResponse["follow_up_question"] != "请问你要查询哪条校车线路或哪个校区？" {
		t.Fatalf("follow_up_question = %#v", finalizationResponse["follow_up_question"])
	}
	traceSummary, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok || traceSummary["direct_vs_delegate_branch"] != "clarification" {
		t.Fatalf("workflow trace summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
}

func writeAgentRuntimeSSEEvent(
	t *testing.T,
	response http.ResponseWriter,
	event string,
	payload map[string]any,
) {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("encode agent runtime SSE payload: %v", err)
	}
	response.Header().Set("content-type", "text/event-stream; charset=utf-8")
	if _, err := fmt.Fprintf(response, "event: %s\ndata: %s\n\n", event, encoded); err != nil {
		t.Fatalf("write agent runtime SSE event: %v", err)
	}
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
}
