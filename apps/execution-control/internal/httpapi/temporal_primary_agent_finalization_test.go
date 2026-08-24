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
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-finalization", "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(
		t,
		server,
		store,
		"run-primary-agent-finalization",
		now,
		map[string]any{
			"agent_result_ref":      agentResultRef,
			"final_output":          "你好，我是校园问答助手。",
			"provider_response_id":  "resp-primary-agent-finalization",
			"model_name":            "gpt-4.1",
			"model_provider":        "openai",
			"prompt_trace":          primaryAgentPromptTraceForFinalizationTest(),
			"raw_prompt":            "system prompt should never be projected",
			"provider_request_body": map[string]any{"authorization": "Bearer forbidden"},
			"status":                "completed",
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "personal_memory_recall",
				"tool":         "personal_memory_recall",
				"payload_kind": "personal_memory_recall",
				"result_ref":   "agent-runtime://run-primary-agent-finalization/tools/personal_memory_recall",
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
		},
	)

	output, err := server.WriteFinalization(context.Background(), input)
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
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-finalization")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	if _, exists := finalizationResponse["selected_tool"]; exists {
		t.Fatalf("product response must not expose selected_tool: %#v", finalizationResponse)
	}
	observability, ok := finalizationResponse["observability"].(map[string]any)
	if !ok {
		t.Fatalf("observability = %#v", finalizationResponse["observability"])
	}
	if observability["model_name"] != "gpt-4.1" || observability["model_provider"] != "openai" {
		t.Fatalf("model observability = %#v", observability)
	}
	if _, exists := observability["prompt_trace"]; exists {
		t.Fatalf("product observability must not copy prompt_trace: %#v", observability)
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
	if workflowTrace["execution_path"] != "tool_assisted" ||
		workflowTrace["terminal_reason"] != "answer_completed" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
	if _, exists := workflowTrace["tool_call_summaries"]; exists {
		t.Fatalf("product workflow trace must not copy tool details: %#v", workflowTrace)
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

func TestWriteFinalizationActivityCompletesClarificationTextAsAnswer(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-clarification",
		"conv-primary-agent-clarification",
		now,
		agentRequestForDurableWorkerTest("这个申请怎么办"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef("run-primary-agent-clarification", "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(
		t,
		server,
		store,
		"run-primary-agent-clarification",
		now,
		map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "请问你要办理哪一类申请？",
			"provider_response_id": "resp-primary-agent-clarification",
			"model_name":           "gpt-4.1",
			"model_provider":       "openai",
			"prompt_trace":         primaryAgentPromptTraceForFinalizationTest(),
			"status":               "completed",
			"tool_results":         []map[string]any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":        10,
				"output_tokens":       9,
				"cached_input_tokens": 0,
			},
		},
	)

	output, err := server.WriteFinalization(context.Background(), input)
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
	if completedRun.TerminalReason != execution.DurableTerminalReasonAnswerCompleted {
		t.Fatalf("terminal reason = %q", completedRun.TerminalReason)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-clarification")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	finalizationResponse := expectInternalFinalizationResponseForTest(t, events)
	if finalizationResponse["status"] != "completed" {
		t.Fatalf("status = %#v", finalizationResponse["status"])
	}
	if finalizationResponse["answer_text"] != "请问你要办理哪一类申请？" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	traceSummary, ok := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if !ok || traceSummary["execution_path"] != "direct" ||
		traceSummary["terminal_reason"] != "answer_completed" {
		t.Fatalf("workflow trace summary = %#v", finalizationResponse["workflow_trace_summary"])
	}
}

func TestWriteFinalizationActivityCompletesWithFailedAgentToolResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 12, 30, 0, 0, time.UTC)
	const runID = "run-primary-agent-failed-tool-finalization"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-primary-agent-failed-tool-finalization",
		now,
		agentRequestForDurableWorkerTest("你还记得我的回答偏好吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:failed-tool"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref": agentResultRef,
		"final_output":     "可以完成此答案。",
		"status":           "completed",
		"terminal_reason":  "answer_completed",
		"tool_results": []map[string]any{{
			"fail_close_reason": "tool_handler_failed",
			"status":            "failed",
			"tool_name":         "personal_memory_recall",
		}},
	})

	output, err := server.WriteFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("write finalization: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) {
		t.Fatalf("finalization status = %q", output.Status)
	}
	completedRun, getErr := store.GetRun(context.Background(), runID)
	if getErr != nil {
		t.Fatalf("get completed run: %v", getErr)
	}
	if completedRun.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run status = %q, want completed", completedRun.Status)
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
		agentRequestForDurableWorkerTest("你还记得我的回答偏好吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:retry"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref": agentResultRef,
		"final_output":     "你偏好先看结论。",
		"status":           "completed",
		"terminal_reason":  "answer_completed",
		"tool_results":     []map[string]any{},
	})
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
	if _, err := server.WriteFinalization(context.Background(), input); err == nil {
		t.Fatal("first finalization should report the lost callback acknowledgement")
	}
	upsertStageTimingAttempt(
		t,
		store,
		runID,
		99,
		"post.callback.observation",
		230,
		nil,
		now,
	)
	output, err := server.WriteFinalization(context.Background(), input)
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

func TestWriteFinalizationActivityRepairsCompletedRunEventWithVerifiedStep(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 13, 30, 0, 0, time.UTC)
	const runID = "run-primary-agent-finalization-repair"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-primary-agent-finalization-repair",
		now,
		agentRequestForDurableWorkerTest("你还记得我的回答偏好吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:repair"})
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(t, server, store, runID, now, map[string]any{
		"agent_result_ref": agentResultRef,
		"final_output":     "你偏好先看结论。",
		"status":           "completed",
		"terminal_reason":  "answer_completed",
		"tool_results":     []map[string]any{},
	})
	finalizedAt := input.FinalizedAt
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
	projectionRun := run
	projectionRun.FinalResponseRef = temporalProjectionRef(runID, "finalization/write")
	if err := server.projectPrimaryAgentFinalizationStep(
		context.Background(),
		projectionRun,
		input,
		finalizedAt,
		finalizedAt,
		finalizedResponse,
	); err != nil {
		t.Fatalf("store finalization step before terminal commit: %v", err)
	}
	completedRun, err := store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
		FinalResponseRef: temporalProjectionRef(runID, "finalization/write"),
		Now:              finalizedAt,
		RunID:            runID,
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
	})
	if err != nil {
		t.Fatalf("complete run with finalization result: %v", err)
	}
	output, err := server.WriteFinalization(context.Background(), input)
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
	var finalizationResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "finalization.write" {
			finalizationResult = &results[index]
			break
		}
	}
	if finalizationResult == nil || finalizationResult.Status != "completed" {
		t.Fatalf("verified finalization step result is missing: %#v", results)
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
		agentRequestForDurableWorkerTest("你还记得我的回答偏好吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:step-failure"})
	store := &finalizationResultFailingStore{RunProjectionStore: baseStore}
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(t, server, baseStore, runID, now, map[string]any{
		"agent_result_ref": agentResultRef,
		"final_output":     "你偏好先看结论。",
		"status":           "completed",
		"terminal_reason":  "answer_completed",
		"tool_results":     []map[string]any{},
	})
	_, err := server.WriteFinalization(context.Background(), input)
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

func TestWriteFinalizationActivityRepairsTransientInternalProjectionFailure(t *testing.T) {
	baseStore := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 14, 0, 0, 0, time.UTC)
	const runID = "run-primary-agent-finalization-internal-repair"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		baseStore,
		runID,
		"conv-primary-agent-finalization-internal-repair",
		now,
		agentRequestForDurableWorkerTest("你还记得我的回答偏好吗"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:finalization:internal-repair"})
	store := &finalizationResultFailOnceStore{
		finalizationResultFailingStore: &finalizationResultFailingStore{RunProjectionStore: baseStore},
	}
	attachRunProjectionStoreForHandlerTest(server, store)
	agentResultRef := temporalProjectionRef(runID, "agent/primary/result")
	input := preparePrimaryAgentFinalizationRunForTest(t, server, baseStore, runID, now, map[string]any{
		"agent_result_ref": agentResultRef,
		"final_output":     "你偏好先看结论。",
		"status":           "completed",
		"terminal_reason":  "answer_completed",
		"tool_results":     []map[string]any{},
	})
	callbackCount := 0
	server.productFinalizationWriter = func(
		_ context.Context,
		_ execution.DurableRun,
		_ time.Time,
		_ map[string]any,
	) error {
		callbackCount++
		return nil
	}
	if _, err := server.WriteFinalization(context.Background(), input); err == nil ||
		!strings.Contains(err.Error(), "finalization result storage unavailable") {
		t.Fatalf("first finalization error = %v, want injected internal projection failure", err)
	}
	output, err := server.WriteFinalization(context.Background(), input)
	if err != nil {
		t.Fatalf("repair internal finalization projection: %v", err)
	}
	if output.Status != string(execution.DurableRunStatusCompleted) || callbackCount != 2 {
		t.Fatalf("repaired output=%#v callback count=%d", output, callbackCount)
	}
	results, err := baseStore.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list repaired finalization results: %v", err)
	}
	finalizationResults := 0
	for _, result := range results {
		if result.StepID == "finalization.write" && result.Status == "completed" {
			finalizationResults++
		}
	}
	if finalizationResults != 1 {
		t.Fatalf("completed finalization result count = %d, results=%#v", finalizationResults, results)
	}
}

type finalizationResultFailingStore struct {
	execution.RunProjectionStore
}

func storeFinalizationCompletionProofForTest(
	t *testing.T,
	store execution.RunProjectionStore,
	runID string,
	projectionRef string,
	createdAt time.Time,
) {
	t.Helper()
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             temporalStepResultID(runID, "finalization.write", 1),
		StepID:               "finalization.write",
		RunID:                runID,
		AttemptID:            temporalStepAttemptID(runID, "finalization.write", 1),
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        projectionRef,
		CreatedAt:            createdAt,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	}); err != nil {
		t.Fatalf("store finalization completion proof: %v", err)
	}
}

type finalizationResultFailOnceStore struct {
	*finalizationResultFailingStore
	failed bool
}

func (s *finalizationResultFailOnceStore) FinalizeRunProjection(
	ctx context.Context,
	request execution.RunProjectionFinalizeRequest,
) (execution.RunProjectionFinalizeResult, error) {
	if !s.failed {
		s.failed = true
		return execution.RunProjectionFinalizeResult{}, errors.New("finalization result storage unavailable")
	}
	return s.RunProjectionStore.FinalizeRunProjection(ctx, request)
}

func (s *finalizationResultFailOnceStore) UpsertStepResult(
	ctx context.Context,
	result execution.StepResultProjection,
) (execution.StepResultProjection, error) {
	if !s.failed && result.StepID == "finalization.write" && result.Status == "completed" {
		s.failed = true
		return execution.StepResultProjection{}, errors.New("finalization result storage unavailable")
	}
	return s.RunProjectionStore.UpsertStepResult(ctx, result)
}

func (s *finalizationResultFailingStore) FinalizeRunProjection(
	context.Context,
	execution.RunProjectionFinalizeRequest,
) (execution.RunProjectionFinalizeResult, error) {
	return execution.RunProjectionFinalizeResult{}, errors.New("finalization result storage unavailable")
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
	fingerprint, err := buildToolRuntimeFingerprint("")
	if err != nil {
		panic(fmt.Sprintf("build test tool runtime fingerprint: %v", err))
	}
	return fingerprint.toMap()
}

func TestValidatePrimaryAgentResultRejectsToolRuntimeFingerprintDrift(t *testing.T) {
	expected := testToolRuntimeFingerprintMap()
	actual := cloneAnyMapFromMetadata(expected)
	actual["combined_sha256"] = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
	_, failCloseReason, err := validatePrimaryAgentResultSucceeded(map[string]any{
		"admitted_tool_runtime_fingerprint": expected,
		"status":                            "completed",
		"tool_results":                      []any{},
		"tool_runtime_fingerprint":          actual,
	})
	if err == nil || failCloseReason != "agent_runtime_fingerprint_mismatch" {
		t.Fatalf("fingerprint validation = (%q, %v), want fail closed", failCloseReason, err)
	}
}
