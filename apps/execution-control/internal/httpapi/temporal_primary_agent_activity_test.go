package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityCallsAgentRuntimeAndProjectsResult(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-001",
		"conv-primary-agent-001",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	var seenAuthorization string
	var seenBody map[string]any
	var seenBodyBytes []byte
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		seenAuthorization = request.Header.Get("authorization")
		if request.URL.Path != "/internal/agent-runs/stream" {
			t.Fatalf("agent runtime path = %q", request.URL.Path)
		}
		var err error
		seenBodyBytes, err = io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read agent runtime request: %v", err)
		}
		if err := json.Unmarshal(seenBodyBytes, &seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status": "completed",
			"run_id": "run-primary-agent-001",
			"context_usage": map[string]any{
				"context_chars":            64,
				"current_input_chars":      7,
				"model_visible_item_count": 1,
			},
			"final_output":         "你好，我是校园问答助手。",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"provider_response_id": "resp-primary-agent-001",
			"stage_timing": map[string]any{
				"agent.runtime_ms": 42,
			},
			"tool_results":    []any{},
			"terminal_reason": "answer_completed",
			"usage": map[string]any{
				"input_tokens":        12,
				"output_tokens":       8,
				"cached_input_tokens": 0,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:001",
	})
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-001",
		RequestID:        "req-primary-agent-001",
		RunID:            "run-primary-agent-001",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-001",
		VisibleToolNames: []string{},
	})
	output, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if seenAuthorization != "Bearer agent-secret" {
		t.Fatalf("authorization = %q", seenAuthorization)
	}
	if seenBody["run_id"] != "run-primary-agent-001" {
		t.Fatalf("agent runtime request = %#v", seenBody)
	}
	if seenBody["expected_model_target_sha256"] != input.AdmissionSnapshot.PrimaryAgentTargetSHA256 {
		t.Fatalf("expected_model_target_sha256 = %#v, want %s", seenBody["expected_model_target_sha256"], input.AdmissionSnapshot.PrimaryAgentTargetSHA256)
	}
	if _, exists := seenBody["provider_config"]; exists {
		t.Fatalf("agent runtime request contains provider_config: %#v", seenBody)
	}
	if _, exists := seenBody["memory_context"]; exists {
		t.Fatalf("agent runtime request contains retired memory_context: %#v", seenBody)
	}
	if output.AgentResultRef != "projection://runs/run-primary-agent-001/agent/primary/result" {
		t.Fatalf("agent result ref = %q", output.AgentResultRef)
	}
	if output.FinalOutput != "你好，我是校园问答助手。" || output.ProviderResponseID != "resp-primary-agent-001" {
		t.Fatalf("unexpected output: %#v", output)
	}
	if output.ModelProvider != "openai" || output.ModelName != "gpt-test" {
		t.Fatalf("output model = %q/%q, want openai/gpt-test", output.ModelProvider, output.ModelName)
	}
	if output.StageTiming["agent.runtime_ms"] != float64(42) {
		t.Fatalf("stage timing = %#v", output.StageTiming)
	}
	if output.FinalOutput != "你好，我是校园问答助手。" {
		t.Fatalf("final output = %#v", output.FinalOutput)
	}
	run, err := store.GetRun(context.Background(), "run-primary-agent-001")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run status = %q, want running", run.Status)
	}
	if run.AdmittedAt.IsZero() || run.StartedAt.IsZero() {
		t.Fatalf("run admission timestamps were not projected: %#v", run)
	}
	receipt, err := store.GetAgentInvocationReceipt(context.Background(), run.RunID+":agent.primary")
	if err != nil {
		t.Fatalf("get provider invocation receipt: %v", err)
	}
	conversationContext, ok := seenBody["conversation_context"].(map[string]any)
	if !ok {
		t.Fatalf("conversation_context = %#v", seenBody["conversation_context"])
	}
	invocationEnvelope, err := newPrimaryAgentProviderInvocationEnvelope(
		run,
		input,
		stringValue(run.Metadata["execution_input_sha256"]),
		conversationContext,
		seenBodyBytes,
		1,
	)
	if err != nil {
		t.Fatalf("rebuild provider invocation envelope: %v", err)
	}
	if receipt.InputSHA256 != sha256AnyValue(invocationEnvelope) ||
		receipt.InputSHA256 == stringValue(run.Metadata["execution_input_sha256"]) {
		t.Fatalf("receipt input hash does not bind canonical provider invocation: receipt=%#v", receipt)
	}
	var summary agentInvocationOutputSummary
	if err := json.Unmarshal(receipt.OutputJSON, &summary); err != nil {
		t.Fatalf("decode receipt summary: %v", err)
	}
	if summary.SchemaVersion != agentInvocationReceiptSchemaVersion ||
		summary.ResultRef != output.AgentResultRef ||
		summary.ProviderInvocationSHA256 != receipt.InputSHA256 {
		t.Fatalf("receipt summary = %#v, output=%#v", summary, output)
	}
	if output.ContextUsage["context_chars"] != float64(64) {
		t.Fatalf("workflow agent output lost context usage: %#v", output.ContextUsage)
	}
	if output.FinalOutput == "" || output.PromptTrace["prompt_id"] != "primary_agent" {
		t.Fatalf("workflow agent output is incomplete: %#v", output)
	}
	steps, err := store.ListRunSteps(context.Background(), "run-primary-agent-001")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].StepID != "agent.primary" || steps[0].Status != "completed" {
		t.Fatalf("projected steps = %#v", steps)
	}
	if _, exists := steps[0].SanitizedPayload["memory_context"]; exists {
		t.Fatalf("agent step payload must not contain raw memory_context: %#v", steps[0].SanitizedPayload)
	}
	if _, exists := steps[0].SanitizedPayload["memory_context_summary"]; exists {
		t.Fatalf("agent step payload contains retired memory_context_summary: %#v", steps[0].SanitizedPayload)
	}
	for _, field := range []string{"final_output", "tool_results", "prompt_trace"} {
		if _, exists := steps[0].SanitizedPayload[field]; exists {
			t.Fatalf("agent step payload must not contain workflow result %s: %#v", field, steps[0].SanitizedPayload)
		}
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-primary-agent-001")
	if err != nil {
		t.Fatalf("list step attempts: %v", err)
	}
	if len(attempts) != 1 ||
		attempts[0].ModelProvider != "openai" ||
		attempts[0].ModelName != "gpt-test" {
		t.Fatalf("projected attempts = %#v, want primary agent model", attempts)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-001")
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeRunProgress,
		execution.DurableRunEventTypeAgentCompleted,
	})
	if events[2].Payload["phase"] != string(execution.DurableRunProgressPhaseGenerating) {
		t.Fatalf("generating progress event = %#v", events[2])
	}
}

func TestExecutePrimaryAgentActivityProjectsAgentRuntimeAnswerDelta(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 31, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-streaming",
		"conv-primary-agent-streaming",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/agent-runs/stream" {
			t.Fatalf("agent runtime path = %q", request.URL.Path)
		}
		writeAgentRuntimeSSEEvent(t, response, "answer_delta", map[string]any{
			"schema_version": "agent_runtime_answer_delta.v2",
			"chunk_index":    1,
			"delta":          "你好",
		})
		writeAgentRuntimeSSEEvent(t, response, "answer_delta", map[string]any{
			"schema_version": "agent_runtime_answer_delta.v2",
			"chunk_index":    2,
			"delta":          "，我是校园问答助手。",
		})
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-streaming",
			"final_output":         "你好，我是校园问答助手。",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"provider_response_id": "resp-primary-agent-streaming",
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":        12,
				"output_tokens":       8,
				"cached_input_tokens": 0,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:streaming",
	})
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-streaming",
		RequestID:        "req-primary-agent-streaming",
		RunID:            "run-primary-agent-streaming",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-streaming",
		VisibleToolNames: []string{},
	})
	output, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if output.FinalOutput != "你好，我是校园问答助手。" {
		t.Fatalf("final output = %q", output.FinalOutput)
	}
	run, err := store.GetRun(context.Background(), "run-primary-agent-streaming")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.Status != execution.DurableRunStatusStreaming {
		t.Fatalf("run status = %q, want streaming", run.Status)
	}
	if run.StreamingStartedAt.IsZero() {
		t.Fatalf("streaming_started_at was not projected: %#v", run)
	}
	events, err := store.ListRunEvents(context.Background(), "run-primary-agent-streaming")
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeRunProgress,
		execution.DurableRunEventTypeRunAnswerStarted,
		execution.DurableRunEventTypeRunAnswerDelta,
		execution.DurableRunEventTypeRunAnswerDelta,
		execution.DurableRunEventTypeRunAnswerCompleted,
		execution.DurableRunEventTypeAgentCompleted,
	})
	progressEvent := events[2]
	if progressEvent.Payload["phase"] != string(execution.DurableRunProgressPhaseGenerating) {
		t.Fatalf("generating progress event = %#v", progressEvent)
	}
	startedEvent := events[3]
	if startedEvent.Visibility != execution.DurableRunEventVisibilityBrowser ||
		startedEvent.Payload["request_id"] != "req-executor-001" ||
		startedEvent.Payload["trace_id"] != "trace-executor-001" ||
		startedEvent.Payload["message_id"] != "run-primary-agent-streaming:answer" {
		t.Fatalf("answer_started event = %#v", startedEvent)
	}
	firstDelta := events[4]
	if firstDelta.Visibility != execution.DurableRunEventVisibilityBrowser ||
		firstDelta.Payload["delta"] != "你好" ||
		firstDelta.Payload["chunk_index"] != 1 ||
		firstDelta.Payload["message_id"] != "run-primary-agent-streaming:answer" {
		t.Fatalf("first answer_delta event = %#v", firstDelta)
	}
	completedEvent := events[6]
	if completedEvent.Visibility != execution.DurableRunEventVisibilityBrowser ||
		completedEvent.Payload["accumulated_text"] != "你好，我是校园问答助手。" ||
		completedEvent.Payload["message_id"] != "run-primary-agent-streaming:answer" {
		t.Fatalf("answer_completed event = %#v", completedEvent)
	}
}

func TestExecutePrimaryAgentActivityProjectsAnswerDeltaBeforeRuntimeCompleted(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 31, 30, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-live-streaming",
		"conv-primary-agent-live-streaming",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	deltaFlushed := make(chan struct{})
	completeRuntime := make(chan struct{})
	var releaseRuntimeOnce sync.Once
	releaseRuntime := func() {
		releaseRuntimeOnce.Do(func() {
			close(completeRuntime)
		})
	}
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/agent-runs/stream" {
			t.Fatalf("agent runtime path = %q", request.URL.Path)
		}
		writeAgentRuntimeSSEEvent(t, response, "answer_delta", map[string]any{
			"schema_version": "agent_runtime_answer_delta.v2",
			"chunk_index":    1,
			"delta":          "你好",
		})
		close(deltaFlushed)
		<-completeRuntime
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-live-streaming",
			"final_output":         "你好",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"provider_response_id": "resp-primary-agent-live-streaming",
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":        12,
				"output_tokens":       1,
				"cached_input_tokens": 0,
			},
		})
	}))
	defer agentRuntime.Close()
	defer releaseRuntime()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:live-streaming",
	})
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-live-streaming",
		RequestID:        "req-primary-agent-live-streaming",
		RunID:            "run-primary-agent-live-streaming",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-live-streaming",
		VisibleToolNames: []string{},
	})
	done := make(chan error, 1)
	go func() {
		_, err := server.ExecutePrimaryAgent(context.Background(), input)
		done <- err
	}()
	select {
	case <-deltaFlushed:
	case err := <-done:
		t.Fatalf("activity returned before runtime completed: %v", err)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for agent runtime delta")
	}
	var deltaEvent execution.DurableRunEvent
	deltaEventFound := false
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		events, err := store.ListRunEvents(context.Background(), "run-primary-agent-live-streaming")
		if err != nil {
			t.Fatalf("list run events: %v", err)
		}
		for index := range events {
			if events[index].EventType == execution.DurableRunEventTypeRunAnswerDelta {
				deltaEvent = events[index]
				deltaEventFound = true
				break
			}
		}
		if deltaEventFound {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !deltaEventFound {
		events, err := store.ListRunEvents(context.Background(), "run-primary-agent-live-streaming")
		if err != nil {
			t.Fatalf("list run events: %v", err)
		}
		t.Fatalf("answer delta was not projected before completed event: %#v", events)
	}
	if deltaEvent.Visibility != execution.DurableRunEventVisibilityBrowser ||
		deltaEvent.Payload["delta"] != "你好" {
		t.Fatalf("answer delta event = %#v", deltaEvent)
	}
	releaseRuntime()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("execute primary agent: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for primary agent activity to complete")
	}
}

func TestExecutePrimaryAgentActivityOmitsEmptyMemoryContextForAgentRuntime(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 32, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-empty-memory",
		"conv-primary-agent-empty-memory",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-empty-memory",
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-empty-memory",
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":        12,
				"output_tokens":       8,
				"cached_input_tokens": 0,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:empty-memory",
	})
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-empty-memory",
		RequestID:        "req-primary-agent-empty-memory",
		RunID:            "run-primary-agent-empty-memory",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-empty-memory",
		VisibleToolNames: []string{},
	})
	_, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if _, ok := seenBody["memory_context"]; ok {
		t.Fatalf("agent runtime request must omit empty memory_context: %#v", seenBody)
	}
}

func TestExecutePrimaryAgentActivityFailsClosedWhenRuntimeNotConfigured(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-missing",
		"conv-primary-agent-missing",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:agent:001"})
	attachRunProjectionStoreForHandlerTest(server, store)
	server.productFinalizationWriter = func(
		context.Context,
		execution.DurableRun,
		time.Time,
		map[string]any,
	) error {
		t.Fatal("agent activity must not call the product finalization writer")
		return nil
	}

	_, err := server.ExecutePrimaryAgent(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:   "run-primary-agent-missing",
		TraceID: "trace-executor-001",
	})
	if err == nil {
		t.Fatal("expected missing agent runtime config to fail")
	}
	assertTemporalFailureSanitized(t, err, "agent_runtime_not_configured", true)
	run, getErr := store.GetRun(context.Background(), "run-primary-agent-missing")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run status = %q, want workflow-owned active state", run.Status)
	}
}

func TestExecutePrimaryAgentActivityFailsClosedWithoutAdmissionSnapshot(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 34, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-admission-missing",
		"conv-primary-agent-admission-missing",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("agent runtime must not be called without a frozen admission snapshot")
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:admission-missing",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgent(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-admission-missing",
		TraceID:          "trace-executor-001",
		VisibleToolNames: []string{},
	})
	if err == nil {
		t.Fatal("expected missing admission snapshot to fail closed")
	}
	assertTemporalFailureSanitized(t, err, "admission_snapshot_invalid", true)
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-admission-missing")
	if listErr != nil {
		t.Fatalf("list steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["failure_kind"] != "admission_snapshot_invalid" {
		t.Fatalf("steps = %#v", steps)
	}
}

func TestExecutePrimaryAgentActivityProjectsAgentRuntimeDiagnosticFailure(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 40, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-runtime-diagnostic",
		"conv-primary-agent-runtime-diagnostic",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeJSON(response, http.StatusInternalServerError, map[string]any{
			"error": map[string]any{
				"code":    "agent_runtime_failed",
				"message": "provider request aborted",
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:diagnostic",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-runtime-diagnostic",
		TraceID:          "trace-executor-001",
		VisibleToolNames: []string{},
	})
	_, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err == nil {
		t.Fatal("expected agent runtime diagnostic failure")
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-runtime-diagnostic")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].StepID != "agent.primary" || steps[0].Status != "failed" {
		t.Fatalf("projected steps = %#v", steps)
	}
	if steps[0].SanitizedPayload["failure_kind"] != "agent_runtime_request_failed" {
		t.Fatalf("agent failure payload = %#v", steps[0].SanitizedPayload)
	}
	if _, exposed := steps[0].SanitizedPayload["agent_runtime_error_code"]; exposed {
		t.Fatalf("agent failure payload exposed unadmitted runtime error code: %#v", steps[0].SanitizedPayload)
	}
	if steps[0].SanitizedPayload["message"] != defaultExecutionFailureMessage ||
		!validTemporalFailureHash(stringValue(steps[0].SanitizedPayload["failure_hash"])) {
		t.Fatalf("agent failure payload missing runtime diagnostic: %#v", steps[0].SanitizedPayload)
	}
	if strings.Contains(stringValue(steps[0].SanitizedPayload["message"]), "provider request aborted") {
		t.Fatalf("agent failure payload leaked provider error: %#v", steps[0].SanitizedPayload)
	}
}

func TestPrimaryAgentRuntimeFailureKindPreservesStableCodes(t *testing.T) {
	for _, code := range []string{
		"invalid_request",
		"context_budget_exceeded",
		"agent_deadline_exceeded",
		"max_turns_exceeded",
		"provider_unavailable",
		"tool_execution_failed",
		"run_failed",
	} {
		t.Run(code, func(t *testing.T) {
			cause := agentRuntimeHTTPError{StatusCode: http.StatusInternalServerError, Code: code}
			if got := primaryAgentRuntimeFailureKind(cause); got != code {
				t.Fatalf("failure kind = %q, want %q", got, code)
			}
		})
	}
}

func TestExecutePrimaryAgentActivityClassifiesUnauthorizedRuntimeAsNonRetryable(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 41, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-runtime-unauthorized",
		"conv-primary-agent-runtime-unauthorized",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid runtime auth.", false)
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:unauthorized",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-runtime-unauthorized",
		TraceID:          "trace-executor-001",
		VisibleToolNames: []string{},
	})
	_, err := server.ExecutePrimaryAgent(context.Background(), input)

	assertTemporalFailureSanitized(t, err, "agent_runtime_unauthorized", true)
	steps, listErr := store.ListRunSteps(context.Background(), input.RunID)
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["failure_kind"] != "agent_runtime_unauthorized" {
		t.Fatalf("unauthorized agent failure projection = %#v", steps)
	}
	if _, exposed := steps[0].SanitizedPayload["agent_runtime_error_code"]; exposed {
		t.Fatalf("unauthorized internal code must not enter the public payload: %#v", steps[0])
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), input.RunID)
	if listErr != nil {
		t.Fatalf("list step attempts: %v", listErr)
	}
	if len(attempts) != 1 || attempts[0].FailCloseReason != "agent_runtime_unauthorized" {
		t.Fatalf("unauthorized agent attempt = %#v", attempts)
	}
}

func TestExecutePrimaryAgentActivityLeavesAgentRuntimeTimeoutTerminalStateToWorkflow(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 42, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-runtime-timeout",
		"conv-primary-agent-runtime-timeout",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		time.Sleep(50 * time.Millisecond)
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   5,
		TemporalWorkerIdentity:   "test:agent:timeout",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-runtime-timeout",
		TraceID:          "trace-executor-001",
		VisibleToolNames: []string{},
	})
	_, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err == nil {
		t.Fatal("expected agent runtime timeout")
	}
	assertTemporalFailureSanitized(t, err, "agent_attempt_uncertain", true)
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-runtime-timeout")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["failure_kind"] != "agent_attempt_uncertain" {
		t.Fatalf("agent timeout failure payload = %#v", steps)
	}
	if _, exists := steps[0].SanitizedPayload["fail_close_reason"]; exists {
		t.Fatalf("uncertain agent attempt must not be projected as a terminal timeout: %#v", steps[0].SanitizedPayload)
	}
	events, eventsErr := store.ListRunEvents(context.Background(), "run-primary-agent-runtime-timeout")
	if eventsErr != nil {
		t.Fatalf("list run events: %v", eventsErr)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunFailed {
			t.Fatalf("agent activity emitted workflow-owned run.failed event: %#v", events)
		}
	}
	run, getErr := store.GetRun(context.Background(), "run-primary-agent-runtime-timeout")
	if getErr != nil || run.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run after agent timeout = %#v err=%v, want active until finalizer", run, getErr)
	}
}
