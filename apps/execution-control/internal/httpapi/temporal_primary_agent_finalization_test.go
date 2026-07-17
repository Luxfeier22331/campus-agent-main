package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"strings"
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
			"activity_attempt":      1,
			"agent_result_ref":      agentResultRef,
			"final_output":          "你好，我是校园问答助手。",
			"terminal_envelope":     map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id":  "resp-primary-agent-finalization",
			"model_name":            "gpt-4.1",
			"model_provider":        "openai",
			"prompt_trace":          primaryAgentPromptTraceForFinalizationTest(),
			"raw_prompt":            "system prompt should never be projected",
			"provider_request_body": map[string]any{"authorization": "Bearer forbidden"},
			"selected_tools":        []string{"transport_schedule_lookup"},
			"status":                "completed",
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "transport_schedule_lookup",
				"tool":         "transport_schedule_lookup",
				"payload_kind": "transport_schedule_lookup",
				"result_ref":   "agent-runtime://run-primary-agent-finalization/tools/transport_schedule_lookup",
				"result":       map[string]any{"outcome": "resolved_current"},
			}},
			"terminal_reason": "answer_completed",
			"stage_timing": map[string]any{
				"agent.runtime_ms": float64(42),
			},
			"usage": map[string]any{
				"input_tokens":        12,
				"output_tokens":       8,
				"cached_input_tokens": 0,
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
			FinalizedAt:    now.Add(4 * time.Second),
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
	if completedRun.SelectedTool != "transport_schedule_lookup" {
		t.Fatalf("run selected tool = %q, want transport_schedule_lookup", completedRun.SelectedTool)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	if finalizationResponse["selected_tool"] != "transport_schedule_lookup" {
		t.Fatalf("selected_tool = %#v", finalizationResponse["selected_tool"])
	}
	observability, ok := finalizationResponse["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v", finalizationResponse["observability"])
	}
	if observability["model_name"] != "gpt-4.1" || observability["model_provider"] != "openai" {
		t.Fatalf("model observability = %#v", observability)
	}
	promptTrace, ok := observability["prompt_trace"].(map[string]any)
	if !ok || promptTrace["schema_version"] != "agent_runtime_prompt_trace.v1" ||
		promptTrace["prompt_id"] != "primary_agent" {
		t.Fatalf("prompt_trace = %#v", observability["prompt_trace"])
	}
	encodedResponse, err := json.Marshal(finalizationResponse)
	if err != nil {
		t.Fatalf("encode finalization response: %v", err)
	}
	for _, forbidden := range []string{
		"raw_prompt",
		"provider_request_body",
		"system prompt should never be projected",
		"Bearer forbidden",
	} {
		if strings.Contains(string(encodedResponse), forbidden) {
			t.Fatalf("finalization response leaked %q: %s", forbidden, string(encodedResponse))
		}
	}
	stageTiming, ok := finalizationResponse["stage_timing"].(map[string]any)
	if !ok {
		t.Fatalf("stage_timing = %#v", finalizationResponse["stage_timing"])
	}
	if stageTiming["agent.runtime_ms"] != float64(42) {
		t.Fatalf("agent.runtime_ms = %#v, want 42", stageTiming["agent.runtime_ms"])
	}
	if _, ok := stageTiming["finalization.write_ms"]; ok {
		t.Fatalf("stage_timing must not contain an unmeasured finalization.write_ms placeholder: %#v", stageTiming)
	}
	workflowTrace, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok {
		t.Fatalf("workflow_trace_summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
	if workflowTrace["workflow_mode"] != "single_step" ||
		workflowTrace["first_decision_actor"] != "primary_agent" ||
		workflowTrace["selected_tool"] != "transport_schedule_lookup" {
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
			"activity_attempt":     1,
			"agent_result_ref":     agentResultRef,
			"final_output":         "请问你要查询哪条校车线路或哪个校区？",
			"terminal_envelope":    map[string]any{"kind": "clarification_required", "follow_up_question": "请问你要查询哪条校车线路或哪个校区？"},
			"provider_response_id": "resp-primary-agent-clarification",
			"model_name":           "gpt-4.1",
			"model_provider":       "openai",
			"prompt_trace":         primaryAgentPromptTraceForFinalizationTest(),
			"selected_tools":       []string{},
			"status":               "completed",
			"tool_results":         []map[string]any{},
			"terminal_reason":      "clarification_required",
			"usage": map[string]any{
				"input_tokens":        10,
				"output_tokens":       9,
				"cached_input_tokens": 0,
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
			FinalizedAt:    now.Add(4 * time.Second),
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
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
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

func TestWriteFinalizationActivityFailsClosedOnFailedAgentToolResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 30, 0, 0, time.UTC)
	const runID = "run-primary-agent-failed-tool-finalization"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-primary-agent-failed-tool-finalization",
		now,
		ragHandoffForDurableWorkerTest("今晚还有校车吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:failed-tool"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref":  agentResultRef,
		"final_output":      "不应完成此答案。",
		"selected_tools":    []string{"transport_schedule_lookup"},
		"status":            "completed",
		"terminal_envelope": map[string]any{"kind": "answer", "answer_text": "不应完成此答案。"},
		"terminal_reason":   "answer_completed",
		"tool_results": []map[string]any{{
			"fail_close_reason": "tool_handler_failed",
			"status":            "failed",
			"tool_name":         "transport_schedule_lookup",
		}},
	})

	_, err := server.WriteFinalizationActivity(
		context.Background(),
		temporalruntime.WriteFinalizationActivityInput{
			AgentResultRef: agentResultRef,
			FinalizedAt:    now.Add(4 * time.Second),
			RunID:          runID,
			TraceID:        "trace-executor-001",
		},
	)
	assertTemporalFailureSanitized(t, err, "agent_tool_result_failed", true)
	failedRun, getErr := store.GetRun(context.Background(), runID)
	if getErr != nil {
		t.Fatalf("get failed run: %v", getErr)
	}
	if failedRun.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run status = %q, want workflow-owned active state", failedRun.Status)
	}
	results, listErr := store.ListStepResults(context.Background(), runID)
	if listErr != nil {
		t.Fatalf("list step results: %v", listErr)
	}
	var finalizationResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "finalization.write" {
			finalizationResult = &results[index]
		}
	}
	if finalizationResult == nil {
		t.Fatalf("failed finalization result missing: %#v", results)
		return
	}
	if finalizationResult.ResultKind != "activity_failure" ||
		finalizationResult.SanitizedPayload["failure_kind"] != "agent_tool_result_failed" ||
		finalizationResult.SanitizedPayload["fail_close_reason"] != "tool_handler_failed" {
		t.Fatalf("failed finalization result = %#v", finalizationResult)
	}
}

func TestWriteFinalizationActivityRetryKeepsProductCallbackStable(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 13, 0, 0, 0, time.UTC)
	const runID = "run-primary-agent-finalization-retry"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-primary-agent-finalization-retry",
		now,
		ragHandoffForDurableWorkerTest("今晚还有校车吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:retry"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref":  agentResultRef,
		"final_output":      "今晚 22:00 还有一班校车。",
		"selected_tools":    []string{"transport_schedule_lookup"},
		"status":            "completed",
		"terminal_envelope": map[string]any{"kind": "answer", "answer_text": "今晚 22:00 还有一班校车。"},
		"terminal_reason":   "answer_completed",
		"tool_results":      []map[string]any{},
	})
	input := temporalruntime.WriteFinalizationActivityInput{
		AgentResultRef: agentResultRef,
		FinalizedAt:    now.Add(4 * time.Second),
		RunID:          runID,
		TraceID:        "trace-executor-001",
	}
	var callbackTimes []time.Time
	var callbackResponses []map[string]any
	server.productFinalizationWriter = func(
		_ context.Context,
		_ execution.DurableRun,
		completedAt time.Time,
		response map[string]any,
	) error {
		callbackTimes = append(callbackTimes, completedAt)
		callbackResponses = append(callbackResponses, cloneAnyMapFromMetadata(response))
		if len(callbackResponses) == 1 {
			return errors.New("callback response acknowledgement was lost")
		}
		return nil
	}
	if _, err := server.WriteFinalizationActivity(context.Background(), input); err == nil {
		t.Fatal("first finalization should report the lost callback acknowledgement")
	}
	upsertStageTimingAttempt(
		t,
		store,
		runID,
		99,
		"finalization.write",
		230,
		nil,
		now,
	)
	output, err := server.WriteFinalizationActivity(context.Background(), input)
	if err != nil {
		t.Fatalf("retry finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("retry status = %q", output.Status)
	}
	if len(callbackResponses) != 2 || !reflect.DeepEqual(callbackResponses[0], callbackResponses[1]) {
		t.Fatalf("callback response drifted across retry: %#v", callbackResponses)
	}
	if len(callbackTimes) != 2 || !callbackTimes[0].Equal(input.FinalizedAt) || !callbackTimes[1].Equal(input.FinalizedAt) {
		t.Fatalf("callback completed_at drifted across retry: %#v", callbackTimes)
	}
}

func TestWriteFinalizationActivityRepairsCompletedRunEventAndStep(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 13, 30, 0, 0, time.UTC)
	const runID = "run-primary-agent-finalization-repair"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-primary-agent-finalization-repair",
		now,
		ragHandoffForDurableWorkerTest("今晚还有校车吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:repair"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref":  agentResultRef,
		"final_output":      "今晚 22:00 还有一班校车。",
		"selected_tools":    []string{"transport_schedule_lookup"},
		"status":            "completed",
		"terminal_envelope": map[string]any{"kind": "answer", "answer_text": "今晚 22:00 还有一班校车。"},
		"terminal_reason":   "answer_completed",
		"tool_results":      []map[string]any{},
	})
	finalizedAt := now.Add(4 * time.Second)
	run, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	finalizedResponse := map[string]any{"status": "completed", "trace_id": run.TraceID}
	if err := server.appendTemporalFinalizationCompletedEvents(
		context.Background(),
		run,
		finalizedAt,
		finalizedResponse,
		map[string]any{"agent_result_ref": agentResultRef, "request_id": run.RequestID, "trace_id": run.TraceID},
	); err != nil {
		t.Fatalf("append finalization events: %v", err)
	}
	completedRun, err := store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
		FinalResponseRef: temporalProjectionRef(runID, "finalization/write"),
		Now:              finalizedAt,
		RunID:            runID,
		SelectedTool:     "transport_schedule_lookup",
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
	})
	if err != nil {
		t.Fatalf("complete run without terminal event: %v", err)
	}
	output, err := server.WriteFinalizationActivity(context.Background(), temporalruntime.WriteFinalizationActivityInput{
		AgentResultRef: agentResultRef,
		FinalizedAt:    finalizedAt,
		RunID:          runID,
		TraceID:        run.TraceID,
	})
	if err != nil {
		t.Fatalf("repair completed finalization: %v", err)
	}
	if output.ProjectionRef != completedRun.FinalResponseRef {
		t.Fatalf("projection ref = %q, want %q", output.ProjectionRef, completedRun.FinalResponseRef)
	}
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	runCompletedFound := false
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCompleted {
			runCompletedFound = true
			break
		}
	}
	if !runCompletedFound {
		t.Fatalf("run.completed event was not repaired: %#v", events)
	}
	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	if len(results) != 1 || results[0].StepID != "finalization.write" || results[0].Status != "completed" {
		t.Fatalf("finalization step result was not repaired: %#v", results)
	}
}

func TestWriteFinalizationActivityKeepsRunActiveWhenStepProjectionFails(t *testing.T) {
	baseStore := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 14, 0, 0, 0, time.UTC)
	const runID = "run-primary-agent-finalization-step-failure"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		baseStore,
		runID,
		"conv-primary-agent-finalization-step-failure",
		now,
		ragHandoffForDurableWorkerTest("今晚还有校车吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:step-failure"})
	store := &finalizationResultFailingStore{RunProjectionStore: baseStore}
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	preparePrimaryAgentFinalizationRunForTest(t, server, baseStore, runID, now, map[string]any{
		"agent_result_ref":  agentResultRef,
		"final_output":      "今晚 22:00 还有一班校车。",
		"selected_tools":    []string{"transport_schedule_lookup"},
		"status":            "completed",
		"terminal_envelope": map[string]any{"kind": "answer", "answer_text": "今晚 22:00 还有一班校车。"},
		"terminal_reason":   "answer_completed",
		"tool_results":      []map[string]any{},
	})
	_, err := server.WriteFinalizationActivity(context.Background(), temporalruntime.WriteFinalizationActivityInput{
		AgentResultRef: agentResultRef,
		FinalizedAt:    now.Add(4 * time.Second),
		RunID:          runID,
		TraceID:        "trace-executor-001",
	})
	if err == nil || !strings.Contains(err.Error(), "finalization result storage unavailable") {
		t.Fatalf("finalization error = %v, want step projection failure", err)
	}
	run, err := baseStore.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run status = %q, want running until finalization projection succeeds", run.Status)
	}
	events, err := baseStore.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCompleted {
			t.Fatalf("run.completed became visible before finalization projection succeeded: %#v", events)
		}
	}
}

type finalizationResultFailingStore struct {
	execution.RunProjectionStore
}

func (s *finalizationResultFailingStore) UpsertStepResult(
	ctx context.Context,
	result execution.StepResultProjection,
) (execution.StepResultProjection, error) {
	if result.StepID == "finalization.write" && result.Status == "completed" {
		return execution.StepResultProjection{}, errors.New("finalization result storage unavailable")
	}
	return s.RunProjectionStore.UpsertStepResult(ctx, result)
}

func primaryAgentPromptTraceForFinalizationTest() map[string]any {
	return map[string]any{
		"schema_version":         "agent_runtime_prompt_trace.v1",
		"prompt_id":              "primary_agent",
		"prompt_template_sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"rendered_prompt_sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
	}
}

func writeAgentRuntimeSSEEvent(
	t *testing.T,
	response http.ResponseWriter,
	event string,
	payload map[string]any,
) {
	t.Helper()
	if event == "completed" {
		addDefaultAgentRuntimeAttestationForTest(payload)
	}
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

func addDefaultAgentRuntimeAttestationForTest(payload map[string]any) {
	if _, exists := payload["prompt_trace"]; !exists {
		payload["prompt_trace"] = map[string]any{
			"schema_version":         "agent_runtime_prompt_trace.v1",
			"prompt_id":              "primary_agent",
			"prompt_template_sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			"rendered_prompt_sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
		}
	}
	if _, exists := payload["tool_runtime_fingerprint"]; !exists {
		payload["tool_runtime_fingerprint"] = testToolRuntimeFingerprintMap()
	}
}

func testToolRuntimeFingerprintMap() map[string]any {
	return map[string]any{
		"schema_version":                     "tool_runtime_fingerprint.v1",
		"tools_schema_version":               "tool-registry-v5",
		"tools_registry_version":             "2026-06-26",
		"tools_sha256":                       "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		"function_schema_version":            "tool-function-schemas-v2",
		"function_schema_sha256":             "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
		"workflow_artifact_schema_version":   "workflow-artifact-registry-v2",
		"workflow_artifact_registry_version": "2026-05-07",
		"workflow_artifact_sha256":           "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
		"combined_sha256":                    "sha256:9999999999999999999999999999999999999999999999999999999999999999",
	}
}
