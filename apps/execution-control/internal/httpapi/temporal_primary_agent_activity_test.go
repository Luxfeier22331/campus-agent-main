package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
		if request.URL.Path != "/internal/agent-runs" {
			t.Fatalf("agent runtime path = %q", request.URL.Path)
		}
		if err := json.NewDecoder(request.Body).Decode(&seenBody); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-001",
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-001",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-001",
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
		TemporalWorkerIdentity:   "test:agent:001",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	output, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:       "conv-primary-agent-001",
		MemoryProjectionRefs: []string{"projection://runs/run-primary-agent-001/memory/recall"},
		RequestID:            "req-primary-agent-001",
		RunID:                "run-primary-agent-001",
		TraceID:              "trace-executor-001",
		TurnID:               "turn-primary-agent-001",
		VisibleCapabilities:  []string{"knowledge", "campus_services", "notice"},
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
	if output.AgentResultRef != "projection://runs/run-primary-agent-001/agent/primary/result" {
		t.Fatalf("agent result ref = %q", output.AgentResultRef)
	}
	if output.FinalOutput != "你好，我是校园问答助手。" || output.ProviderResponseID != "resp-primary-agent-001" {
		t.Fatalf("unexpected output: %#v", output)
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
	steps, err := store.ListRunSteps(context.Background(), "run-primary-agent-001")
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if len(steps) != 1 || steps[0].StepID != "agent.primary" || steps[0].Status != "completed" {
		t.Fatalf("projected steps = %#v", steps)
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
		RunID:               "run-primary-agent-runtime-diagnostic",
		TraceID:             "trace-executor-001",
		VisibleCapabilities: []string{"campus_services"},
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
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-knowledge-signal",
			"final_output":         "",
			"provider_response_id": "resp-primary-agent-knowledge-signal",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-knowledge-signal",
			"selected_tools":       []string{"knowledge_query"},
			"tool_results": []map[string]any{{
				"status":       "completed",
				"tool_name":    "knowledge_query",
				"capability":   "knowledge",
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
		ConversationID:      "conv-primary-agent-knowledge-signal",
		RequestID:           "req-primary-agent-knowledge-signal",
		RunID:               "run-primary-agent-knowledge-signal",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-knowledge-signal",
		VisibleCapabilities: []string{"knowledge"},
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
	if workflowTrace["workflow_mode"] != "agent_loop" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
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

func TestWriteFinalizationActivityKeepsDirectPrimaryAgentCapability(t *testing.T) {
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
	run, err := store.GetRun(context.Background(), "run-primary-agent-direct-finalization")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		for key, value := range map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-direct-finalization",
			"sdk_trace_ref":        "trace://openai-agents/trace-primary-agent-direct-finalization",
			"selected_tools":       []string{},
			"tool_results":         []map[string]any{},
			"terminal_reason":      "answer_completed",
		} {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-direct-finalization",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-direct-finalization",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}

	_, err = server.WriteFinalizationActivity(
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
	if finalizationResponse["selected_capability"] != "primary_agent" {
		t.Fatalf("selected_capability = %#v, want primary_agent for direct no-tool branch", finalizationResponse["selected_capability"])
	}
	workflowTrace := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if workflowTrace["selected_capability"] != "primary_agent" ||
		workflowTrace["direct_vs_delegate_branch"] != "direct_answer" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
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
	run, err := store.GetRun(context.Background(), "run-primary-agent-out-of-scope")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.replaceTemporalAgentMetadata(context.Background(), run, func(metadata map[string]any) {
		for key, value := range map[string]any{
			"agent_result_ref":     agentResultRef,
			"final_output":         "这个请求不属于校园问答助手当前可处理的范围。",
			"provider_response_id": "resp-primary-agent-out-of-scope",
			"sdk_trace_ref":        "trace://openai-agents/trace-primary-agent-out-of-scope",
			"selected_tools":       []string{},
			"tool_results":         []map[string]any{},
			"terminal_reason":      "out_of_scope",
			"usage": map[string]any{
				"input_tokens":             11,
				"output_tokens":            7,
				"cached_input_tokens":      0,
				"estimated_cost_micro_usd": 19,
			},
		} {
			metadata[key] = value
		}
	}); err != nil {
		t.Fatalf("replace temporal agent metadata: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-out-of-scope",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		"run-primary-agent-out-of-scope",
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("run run: %v", err)
	}

	_, err = server.WriteFinalizationActivity(
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
