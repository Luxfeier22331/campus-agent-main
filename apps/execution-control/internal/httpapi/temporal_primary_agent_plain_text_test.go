package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityAcceptsPlainTextFinalOutput(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 6, 12, 10, 32, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-primary-agent-plain-text",
		"conv-primary-agent-plain-text",
		now,
		agentRequestForDurableWorkerTest("hi 你是谁"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":               "completed",
			"request_id":           "run-primary-agent-plain-text",
			"final_output":         "你好，我是校园问答助手。",
			"provider_response_id": "resp-primary-agent-plain-text",
			"tool_results":         []any{},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"model_request_count": 1,
				"input_tokens":        12,
				"output_tokens":       8,
				"usage_observed":      true,
			},
		})
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:plain-text",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:   "conv-primary-agent-plain-text",
		RequestID:        "run-primary-agent-plain-text",
		VisibleToolNames: []string{},
	})
	output, err := server.ExecutePrimaryAgent(context.Background(), input)
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}
	if output.FinalOutput != "你好，我是校园问答助手。" ||
		output.TerminalReason != string(execution.DurableTerminalReasonAnswerCompleted) {
		t.Fatalf("output = %#v", output)
	}
}

func preparePrimaryAgentFinalizationRunForTest(
	t *testing.T,
	server *Server,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
	agentMetadata map[string]any,
) temporalruntime.WriteFinalizationActivityInput {
	t.Helper()
	_, err := store.GetRun(context.Background(), runID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	snapshot := temporalruntime.AgentAdmissionSnapshot{}
	usageObserved, _ := nestedAny(agentMetadata, "usage", "usage_observed").(bool)
	output := temporalruntime.ExecutePrimaryAgentActivityOutput{
		AgentResultRef:     strings.TrimSpace(stringValue(agentMetadata["agent_result_ref"])),
		FinalOutput:        stringValue(agentMetadata["final_output"]),
		ModelName:          firstNonEmptyText(stringValue(agentMetadata["model_name"]), "gpt-4.1"),
		ModelProvider:      firstNonEmptyText(stringValue(agentMetadata["model_provider"]), "openai"),
		PromptTrace:        cloneAnyMapFromMetadata(agentMetadata["prompt_trace"]),
		ProviderResponseID: strings.TrimSpace(stringValue(agentMetadata["provider_response_id"])),
		RequestID:          runID,
		StageTiming:        cloneAnyMapFromMetadata(agentMetadata["stage_timing"]),
		Status:             firstNonEmptyText(stringValue(agentMetadata["status"]), "completed"),
		TerminalReason:     strings.TrimSpace(stringValue(agentMetadata["terminal_reason"])),
		ToolResults:        []temporalruntime.AgentToolResult{},
		Usage: temporalruntime.AgentUsageSummary{
			ModelRequestCount: int64(intFromAny(nestedAny(agentMetadata, "usage", "model_request_count"))),
			CachedInputTokens: int64(intFromAny(nestedAny(agentMetadata, "usage", "cached_input_tokens"))),
			InputTokens:       int64(intFromAny(nestedAny(agentMetadata, "usage", "input_tokens"))),
			OutputTokens:      int64(intFromAny(nestedAny(agentMetadata, "usage", "output_tokens"))),
			UsageObserved:     usageObserved,
		},
	}
	if len(output.PromptTrace) == 0 {
		output.PromptTrace = primaryAgentPromptTraceForFinalizationTest()
	}
	for _, result := range primaryAgentToolResultMaps(agentMetadata["tool_results"]) {
		output.ToolResults = append(output.ToolResults, temporalruntime.AgentToolResult{
			ArgumentsJSON:   cloneAnyMapFromMetadata(result["arguments_json"]),
			DurationMS:      numericProjectionValue(result["duration_ms"]),
			FailCloseReason: strings.TrimSpace(stringValue(result["fail_close_reason"])),
			Result:          cloneAnyMapFromMetadata(result["result"]),
			Status:          strings.TrimSpace(stringValue(result["status"])),
			ToolName:        strings.TrimSpace(stringValue(result["tool_name"])),
		})
	}
	if _, err := store.TransitionRun(context.Background(), runID, execution.DurableRunStatusAdmitted, "", now.Add(2*time.Second)); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(context.Background(), runID, execution.DurableRunStatusRunning, "", now.Add(3*time.Second)); err != nil {
		t.Fatalf("run run: %v", err)
	}
	return temporalruntime.WriteFinalizationActivityInput{
		AdmissionSnapshot: snapshot,
		AgentResult:       output,
		FinalizedAt:       now.Add(4 * time.Second),
		RequestID:         runID,
	}
}
