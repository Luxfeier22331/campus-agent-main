package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		ragHandoffForDurableWorkerTest("hi 你是谁"),
	)
	var seenAuthorization string
	var seenBody map[string]any
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		seenAuthorization = request.Header.Get("authorization")
		if request.URL.Path != "/internal/agent-runs/stream" {
			t.Fatalf("agent runtime path = %q", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status": "completed",
			"debug_trace_refs": []map[string]any{
				{
					"sink":      "langfuse_otlp",
					"trace_id":  "trace-executor-001",
					"trace_ref": "langfuse://trace-executor-001",
					"url":       "https://cloud.langfuse.com/project/demo/traces/trace-executor-001",
				},
			},
			"run_id":               "run-primary-agent-001",
			"final_output":         "你好，我是校园问答助手。",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id": "resp-primary-agent-001",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-001",
			"selected_tools":       []string{},
			"stage_timing": map[string]any{
				"agent.runtime_ms": 42,
			},
			"tool_results":    []any{},
			"terminal_reason": "answer_completed",
			"usage": map[string]any{
				"input_tokens":             12,
				"output_tokens":            8,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 42,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:001",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	server.observabilityConfigResolver = staticObservabilityConfigResolver{
		config: llmDebugTraceConfig{
			SchemaVersion:  "llm_debug_trace_config.v1",
			Mode:           "langfuse_otlp",
			IncludeModelIO: false,
			SampleRatio:    0.25,
			LangfuseOTLP: &llmDebugTraceOTLPConfig{
				Endpoint:           "https://cloud.langfuse.com/api/public/otel",
				AuthHeader:         "Basic langfuse-secret",
				PublicTraceBaseURL: "https://cloud.langfuse.com/project/demo/traces",
			},
		},
	}
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:       "conv-primary-agent-001",
		MemoryContext:        &temporalruntime.MemoryContext{ContextBlock: "用户记忆:\n- 用户偏好先看结论", MemoryRef: "projection://runs/run-primary-agent-001/memory/recall", SchemaVersion: "memory_recall_result_v1", SelectedMemoryChars: 18, SelectedMemoryCount: 1},
		MemoryProjectionRefs: []string{"projection://runs/run-primary-agent-001/memory/recall"},
		RequestID:            "req-primary-agent-001",
		RunID:                "run-primary-agent-001",
		TraceID:              "trace-executor-001",
		TurnID:               "turn-primary-agent-001",
		VisibleToolNames:     []string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if seenAuthorization != "Bearer agent-secret" {
		t.Fatalf("authorization = %q", seenAuthorization)
	}
	if seenBody["run_id"] != "run-primary-agent-001" {
		t.Fatalf("agent runtime request = %#v", seenBody)
	}
	providerConfig, ok := seenBody["provider_config"].(map[string]any)
	if !ok {
		t.Fatalf("agent runtime request missing provider_config: %#v", seenBody)
	}
	if providerConfig["profile_id"] != "provider_profile_primary" ||
		providerConfig["api_key"] != "sk-primary-agent" ||
		providerConfig["model"] != "gpt-test" {
		t.Fatalf("provider_config = %#v", providerConfig)
	}
	debugTraceConfig, ok := seenBody["debug_trace_config"].(map[string]any)
	if !ok {
		t.Fatalf("agent runtime request missing debug_trace_config: %#v", seenBody)
	}
	langfuseConfig, _ := debugTraceConfig["langfuse_otlp"].(map[string]any)
	if debugTraceConfig["mode"] != "langfuse_otlp" ||
		debugTraceConfig["include_model_io"] != false ||
		debugTraceConfig["sample_ratio"] != 0.25 ||
		langfuseConfig["auth_header"] != "Basic langfuse-secret" {
		t.Fatalf("debug_trace_config = %#v", debugTraceConfig)
	}
	assertPrimaryAgentMemoryContextForTest(t, seenBody)
	if output.AgentResultRef != "projection://runs/run-primary-agent-001/agent/primary/result" {
		t.Fatalf("agent result ref = %q", output.AgentResultRef)
	}
	if output.FinalOutput != "你好，我是校园问答助手。" || output.ProviderResponseID != "resp-primary-agent-001" {
		t.Fatalf("unexpected output: %#v", output)
	}
	if output.ModelProvider != "openai" || output.ModelName != "gpt-test" {
		t.Fatalf("output model = %q/%q, want openai/gpt-test", output.ModelProvider, output.ModelName)
	}
	if len(output.DebugTraceRefs) != 1 ||
		output.DebugTraceRefs[0].Sink != "langfuse_otlp" ||
		output.StageTiming["agent.runtime_ms"] != float64(42) {
		t.Fatalf("debug refs/timing = %#v / %#v", output.DebugTraceRefs, output.StageTiming)
	}
	if output.TerminalEnvelope["kind"] != "answer" || output.TerminalEnvelope["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("terminal envelope = %#v", output.TerminalEnvelope)
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
	agentMetadata, ok := run.Metadata["temporal_agent"].(map[string]any)
	if !ok {
		t.Fatalf("temporal_agent metadata = %#v", run.Metadata["temporal_agent"])
	}
	if agentMetadata["agent_result_ref"] != output.AgentResultRef {
		t.Fatalf("agent metadata = %#v", agentMetadata)
	}
	debugTraceRefs, ok := agentMetadata["debug_trace_refs"].([]map[string]any)
	if !ok || len(debugTraceRefs) != 1 {
		t.Fatalf("agent metadata debug trace refs = %#v", agentMetadata["debug_trace_refs"])
	}
	envelope, ok := agentMetadata["terminal_envelope"].(map[string]any)
	if !ok || envelope["kind"] != "answer" {
		t.Fatalf("agent metadata missing terminal envelope: %#v", agentMetadata)
	}
	steps, err := store.ListRunSteps(context.Background(), "run-primary-agent-001")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].StepID != "agent.primary" || steps[0].Status != "completed" {
		t.Fatalf("projected steps = %#v", steps)
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
		execution.DurableRunEventTypeAgentCompleted,
	})
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
		ragHandoffForDurableWorkerTest("hi 你是谁"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/internal/agent-runs/stream" {
			t.Fatalf("agent runtime path = %q", request.URL.Path)
		}
		writeAgentRuntimeSSEEvent(t, response, "answer_delta", map[string]any{
			"schema_version":   "agent_runtime_answer_delta.v1",
			"accumulated_text": "你好",
			"chunk_index":      1,
			"delta":            "你好",
		})
		writeAgentRuntimeSSEEvent(t, response, "answer_delta", map[string]any{
			"schema_version":   "agent_runtime_answer_delta.v1",
			"accumulated_text": "你好，我是校园问答助手。",
			"chunk_index":      2,
			"delta":            "，我是校园问答助手。",
		})
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-streaming",
			"final_output":         "你好，我是校园问答助手。",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id": "resp-primary-agent-streaming",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-streaming",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":             12,
				"output_tokens":            8,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 42,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:streaming",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-streaming",
		RequestID:        "req-primary-agent-streaming",
		RunID:            "run-primary-agent-streaming",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-streaming",
		VisibleToolNames: []string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"},
	})
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
		execution.DurableRunEventTypeRunAnswerStarted,
		execution.DurableRunEventTypeRunAnswerDelta,
		execution.DurableRunEventTypeRunAnswerDelta,
		execution.DurableRunEventTypeRunAnswerCompleted,
		execution.DurableRunEventTypeAgentCompleted,
	})
	startedEvent := events[2]
	if startedEvent.Visibility != execution.DurableRunEventVisibilityBrowser ||
		startedEvent.Payload["request_id"] != "req-executor-001" ||
		startedEvent.Payload["trace_id"] != "trace-executor-001" ||
		startedEvent.Payload["message_id"] != "run-primary-agent-streaming:answer" {
		t.Fatalf("answer_started event = %#v", startedEvent)
	}
	firstDelta := events[3]
	if firstDelta.Visibility != execution.DurableRunEventVisibilityBrowser ||
		firstDelta.Payload["delta"] != "你好" ||
		firstDelta.Payload["accumulated_text"] != "你好" ||
		firstDelta.Payload["chunk_index"] != 1 ||
		firstDelta.Payload["message_id"] != "run-primary-agent-streaming:answer" {
		t.Fatalf("first answer_delta event = %#v", firstDelta)
	}
	completedEvent := events[5]
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
		ragHandoffForDurableWorkerTest("hi 你是谁"),
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
			"schema_version":   "agent_runtime_answer_delta.v1",
			"accumulated_text": "你好",
			"chunk_index":      1,
			"delta":            "你好",
		})
		close(deltaFlushed)
		<-completeRuntime
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-live-streaming",
			"final_output":         "你好",
			"model_name":           "gpt-test",
			"model_provider":       "openai",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好"},
			"provider_response_id": "resp-primary-agent-live-streaming",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-live-streaming",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":             12,
				"output_tokens":            1,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 42,
			},
		})
	}))
	defer agentRuntime.Close()
	defer releaseRuntime()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:live-streaming",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	done := make(chan error, 1)
	go func() {
		_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
			ConversationID:   "conv-primary-agent-live-streaming",
			RequestID:        "req-primary-agent-live-streaming",
			RunID:            "run-primary-agent-live-streaming",
			TraceID:          "trace-executor-001",
			TurnID:           "turn-primary-agent-live-streaming",
			VisibleToolNames: []string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"},
		})
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
		ragHandoffForDurableWorkerTest("hi 你是谁"),
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
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
			"provider_response_id": "resp-primary-agent-empty-memory",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-empty-memory",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens":             12,
				"output_tokens":            8,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 42,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:empty-memory",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-empty-memory",
		RequestID:        "req-primary-agent-empty-memory",
		RunID:            "run-primary-agent-empty-memory",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-empty-memory",
		VisibleToolNames: []string{"knowledge_query", "transport_schedule_lookup", "campus_notice_discover"},
	})
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
		ragHandoffForDurableWorkerTest("hi"),
	)
	server := NewServer(config.Config{TemporalWorkerIdentity: "test:agent:001"})
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:   "run-primary-agent-missing",
		TraceID: "trace-executor-001",
	})
	if err == nil {
		t.Fatal("expected missing agent runtime config to fail")
	}
	run, getErr := store.GetRun(context.Background(), "run-primary-agent-missing")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
}

func TestExecutePrimaryAgentActivityFailsClosedWhenProviderProfileMissing(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 35, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-provider-missing",
		"conv-primary-agent-provider-missing",
		now,
		ragHandoffForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("agent runtime must not be called without active primary_agent provider profile")
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:provider-missing",
	})
	server.providerConfigResolver = staticProviderConfigResolver{}
	server.observabilityConfigResolver = staticObservabilityConfigResolver{
		config: llmDebugTraceConfig{
			SchemaVersion: "llm_debug_trace_config.v1",
			Mode:          "off",
			SampleRatio:   1,
		},
	}
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:   "run-primary-agent-provider-missing",
		TraceID: "trace-executor-001",
	})
	if err == nil {
		t.Fatal("expected missing provider profile to fail")
	}
	run, getErr := store.GetRun(context.Background(), "run-primary-agent-provider-missing")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-provider-missing")
	if listErr != nil {
		t.Fatalf("list steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["failure_kind"] != "provider_profile_missing" {
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
		ragHandoffForDurableWorkerTest("hi"),
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
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:diagnostic",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-runtime-diagnostic",
		TraceID:          "trace-executor-001",
		VisibleToolNames: []string{"transport_schedule_lookup"},
	})
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
	if steps[0].SanitizedPayload["agent_runtime_error_code"] != "agent_runtime_failed" ||
		steps[0].SanitizedPayload["message"] != "provider request aborted" {
		t.Fatalf("agent failure payload missing runtime diagnostic: %#v", steps[0].SanitizedPayload)
	}
}

func TestExecutePrimaryAgentActivityProjectsAgentRuntimeTimeoutTerminalEvent(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 42, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-runtime-timeout",
		"conv-primary-agent-runtime-timeout",
		now,
		ragHandoffForDurableWorkerTest("hi"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		time.Sleep(50 * time.Millisecond)
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    5,
		TemporalWorkerIdentity:   "test:agent:timeout",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		RunID:            "run-primary-agent-runtime-timeout",
		TraceID:          "trace-executor-001",
		VisibleToolNames: []string{"transport_schedule_lookup"},
	})
	if err == nil {
		t.Fatal("expected agent runtime timeout")
	}
	steps, listErr := store.ListRunSteps(context.Background(), "run-primary-agent-runtime-timeout")
	if listErr != nil {
		t.Fatalf("list run steps: %v", listErr)
	}
	if len(steps) != 1 || steps[0].SanitizedPayload["failure_kind"] != "agent_runtime_timeout" {
		t.Fatalf("agent timeout failure payload = %#v", steps)
	}
	if steps[0].SanitizedPayload["fail_close_reason"] != "agent_runtime_timeout" {
		t.Fatalf("step fail_close_reason = %v, want agent_runtime_timeout", steps[0].SanitizedPayload["fail_close_reason"])
	}
	events, eventsErr := store.ListRunEvents(context.Background(), "run-primary-agent-runtime-timeout")
	if eventsErr != nil {
		t.Fatalf("list run events: %v", eventsErr)
	}
	var failedEvent *execution.DurableRunEvent
	for index := range events {
		if events[index].EventType == execution.DurableRunEventTypeRunFailed {
			failedEvent = &events[index]
			break
		}
	}
	if failedEvent == nil {
		t.Fatalf("run.failed event not projected: %#v", events)
		return
	}
	if failedEvent.Payload["request_id"] != "req-executor-001" ||
		failedEvent.Payload["trace_id"] != "trace-executor-001" ||
		failedEvent.Payload["failure_kind"] != "agent_runtime_timeout" {
		t.Fatalf("run.failed payload missing correlation: %#v", failedEvent.Payload)
	}
	errorPayload, ok := failedEvent.Payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("run.failed error payload missing: %#v", failedEvent.Payload)
	}
	if errorPayload["code"] != "agent_runtime_timeout" ||
		errorPayload["message"] != "Agent runtime request timed out." ||
		errorPayload["retryable"] != true {
		t.Fatalf("run.failed error payload = %#v", errorPayload)
	}
}

func TestExecutePrimaryAgentActivityAllowsKnowledgeSignalWithoutFinalOutput(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 45, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-knowledge-signal",
		"conv-primary-agent-knowledge-signal",
		now,
		ragHandoffForDurableWorkerTest("学籍管理规定是什么"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-knowledge-signal",
			"final_output":         "",
			"provider_response_id": "resp-primary-agent-knowledge-signal",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-knowledge-signal",
			"selected_tools":       []string{"knowledge_query"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "knowledge_query",
				"tool":         "knowledge_query",
				"payload_kind": "knowledge_query",
				"result_ref":   "agent-runtime://run-primary-agent-knowledge-signal/tools/knowledge_query",
				"result":       map[string]any{"workflow_signal": "knowledge_query"},
			}},
			"terminal_reason": "tool_selected",
			"usage": map[string]any{
				"input_tokens":             18,
				"output_tokens":            4,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 19,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:knowledge-signal",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-knowledge-signal",
		RequestID:        "req-primary-agent-knowledge-signal",
		RunID:            "run-primary-agent-knowledge-signal",
		TraceID:          "trace-executor-001",
		TurnID:           "turn-primary-agent-knowledge-signal",
		VisibleToolNames: []string{"knowledge_query"},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if output.FinalOutput != "" {
		t.Fatalf("final output = %q, want empty workflow signal", output.FinalOutput)
	}
	if len(output.SelectedTools) != 1 || output.SelectedTools[0] != "knowledge_query" {
		t.Fatalf("selected tools = %#v", output.SelectedTools)
	}
	if output.TerminalReason != "tool_selected" {
		t.Fatalf("terminal reason = %q", output.TerminalReason)
	}
	run, err := store.GetRun(context.Background(), "run-primary-agent-knowledge-signal")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	agentMetadata, ok := run.Metadata["temporal_agent"].(map[string]any)
	if !ok {
		t.Fatalf("temporal_agent metadata = %#v", run.Metadata["temporal_agent"])
	}
	if agentMetadata["terminal_reason"] != "tool_selected" {
		t.Fatalf("agent metadata = %#v", agentMetadata)
	}
}
