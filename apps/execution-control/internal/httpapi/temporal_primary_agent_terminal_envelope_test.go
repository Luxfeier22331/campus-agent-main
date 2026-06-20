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
		writeJSON(response, http.StatusOK, map[string]any{
			"status":               "completed",
			"run_id":               "run-primary-agent-missing-envelope",
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-missing-envelope",
			"sdk_trace_ref":        "trace://openai-agents/run-primary-agent-missing-envelope",
			"selected_tools":       []string{},
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeTimeoutMS:    1000,
		TemporalWorkerIdentity:   "test:agent:missing-envelope",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	_, err := server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:      "conv-primary-agent-missing-envelope",
		RequestID:           "req-primary-agent-missing-envelope",
		RunID:               "run-primary-agent-missing-envelope",
		TraceID:             "trace-executor-001",
		TurnID:              "turn-primary-agent-missing-envelope",
		VisibleCapabilities: []string{"campus_services"},
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
			"final_output":         "legacy string that must not be consumed",
			"terminal_envelope":    map[string]any{"kind": "answer", "answer_text": "你好，我是校园问答助手。"},
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
	if finalizationResponse["answer_text"] != "你好，我是校园问答助手。" {
		t.Fatalf("answer_text = %#v", finalizationResponse["answer_text"])
	}
	workflowTrace := finalizationResponse["workflow_trace_summary"].(map[string]any)
	if workflowTrace["selected_capability"] != "primary_agent" ||
		workflowTrace["direct_vs_delegate_branch"] != "direct_answer" {
		t.Fatalf("workflow trace = %#v", workflowTrace)
	}
}
