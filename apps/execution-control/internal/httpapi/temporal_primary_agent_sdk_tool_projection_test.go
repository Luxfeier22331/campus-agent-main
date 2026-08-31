package httpapi

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityProjectsPersonalMemoryToolResult(t *testing.T) {
	runID := "run-primary-agent-memory-tool"
	store, err := executePrimaryAgentSDKToolFixture(t, runID, "completed", map[string]any{
		"status":         "completed",
		"tool_name":      personalMemoryRecallToolName,
		"arguments_json": map[string]any{"query": "我上次说过喜欢哪个食堂？"},
		"result": map[string]any{
			"outcome": "matched", "memory_text": "用户喜欢一食堂。",
		},
	})
	if err != nil {
		t.Fatalf("execute primary agent: %v", err)
	}

	stepID := "sdk_tool.execute.personal_memory_recall.invocation-1"
	steps, err := store.ListRunSteps(context.Background(), runID)
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	var toolStep *execution.RunStepProjection
	for index := range steps {
		if steps[index].StepID == stepID {
			toolStep = &steps[index]
		}
	}
	if toolStep == nil || toolStep.Tool != personalMemoryRecallToolName ||
		toolStep.StepKind != "tool" || toolStep.Status != "completed" {
		t.Fatalf("personal memory tool step = %#v; all steps = %#v", toolStep, steps)
	}
	assertSDKToolAttemptDuration(t, store, runID, stepID, 18)

	results, err := store.ListStepResults(context.Background(), runID)
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var toolResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == stepID {
			toolResult = &results[index]
		}
	}
	if toolResult == nil || toolResult.ResultKind != "typed_tool_result" ||
		toolResult.ProjectionRef != "projection://runs/"+runID+"/sdk-tools/personal_memory_recall/invocation-1" ||
		toolResult.SanitizedPayload["tool_name"] != personalMemoryRecallToolName ||
		toolResult.SanitizedPayload["outcome"] != "matched" {
		t.Fatalf("personal memory tool result = %#v; all results = %#v", toolResult, results)
	}
	assertToolArgumentIdentityForTest(t, toolResult.SanitizedPayload)
	for _, field := range []string{"arguments_json", "memory_text", "result"} {
		if _, exists := toolResult.SanitizedPayload[field]; exists {
			t.Fatalf("tool result leaked %s: %#v", field, toolResult.SanitizedPayload)
		}
	}
	if resultHash, ok := toolResult.SanitizedPayload["result_sha256"].(string); !ok || !validSHA256Ref(resultHash) {
		t.Fatalf("result_sha256 = %#v", toolResult.SanitizedPayload["result_sha256"])
	}

}

func TestExecutePrimaryAgentActivityCompletesWithFailedPersonalMemoryToolResult(t *testing.T) {
	runID := "run-primary-agent-memory-tool-failed"
	store, err := executePrimaryAgentSDKToolFixture(t, runID, "completed", map[string]any{
		"status":         "failed",
		"tool_name":      personalMemoryRecallToolName,
		"arguments_json": map[string]any{"query": "我上次说过喜欢哪个食堂？"},
		"failure": map[string]any{
			"code":      "tool_handler_failed",
			"operation": "tool.personal_memory_recall",
		},
		"result": map[string]any{"error": map[string]any{"code": "memory_unavailable"}},
	})
	if err != nil {
		t.Fatalf("execute primary agent with failed SDK tool: %v", err)
	}

	steps, err := store.ListRunSteps(context.Background(), runID)
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	for _, step := range steps {
		if step.StepID == "sdk_tool.execute.personal_memory_recall.invocation-1" {
			failure, _ := step.SanitizedPayload["failure"].(*temporalruntime.ExecutionFailure)
			if step.Status != "failed" || step.Tool != personalMemoryRecallToolName ||
				failure == nil || failure.Code != "tool_handler_failed" {
				t.Fatalf("failed personal memory tool step = %#v", step)
			}
			return
		}
	}
	t.Fatalf("failed personal memory tool step missing: %#v", steps)
}

func TestExecutePrimaryAgentActivityRejectsUnadmittedSDKToolResult(t *testing.T) {
	tests := []struct {
		name     string
		toolName string
		want     string
	}{
		{name: "unknown tool", toolName: "unregistered_fixture_tool", want: "was not visible"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			runID := "run-primary-agent-unadmitted-" + strings.ReplaceAll(test.name, " ", "-")
			store, err := executePrimaryAgentSDKToolFixture(t, runID, "completed", map[string]any{
				"status":         "completed",
				"tool_name":      test.toolName,
				"arguments_json": map[string]any{},
				"result":         map[string]any{},
			})
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("unadmitted tool error = %v", err)
			}
			steps, listErr := store.ListRunSteps(context.Background(), runID)
			if listErr != nil {
				t.Fatalf("list run steps: %v", listErr)
			}
			for _, step := range steps {
				if strings.HasPrefix(step.StepID, "sdk_tool.execute."+test.toolName) {
					t.Fatalf("unadmitted tool was projected: %#v", step)
				}
			}
		})
	}
}
func executePrimaryAgentSDKToolFixture(
	t *testing.T,
	runID string,
	runtimeStatus string,
	toolResult map[string]any,
) (*execution.InMemoryRunProjectionStore, error) {
	t.Helper()
	toolResult["duration_ms"] = 17.25
	toolResult["invocation_id"] = "invocation-1"
	store := execution.NewInMemoryRunProjectionStore()
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		"conv-"+runID,
		time.Date(2026, 7, 25, 12, 0, 0, 0, time.UTC),
		agentRequestForDurableWorkerTest("我上次说过喜欢哪个食堂？"),
	)
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		payload := map[string]any{
			"status":               runtimeStatus,
			"request_id":           runID,
			"final_output":         "你之前提到喜欢一食堂。",
			"provider_response_id": "resp-" + runID,
			"tool_results":         []map[string]any{toolResult},
			"terminal_reason":      "answer_completed",
			"usage": map[string]any{
				"input_tokens": 12, "output_tokens": 6, "cached_input_tokens": 0,
			},
		}
		if runtimeStatus != "completed" {
			payload["final_output"] = ""
			payload["terminal_reason"] = "agent_runtime_failed"
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", payload)
	}))
	t.Cleanup(agentRuntime.Close)
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		AgentRuntimeDeadlineMS:   1000,
		TemporalWorkerIdentity:   "test:agent:sdk-tool",
	})
	attachPrimaryAgentProviderConfigForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	input := withAgentAdmissionSnapshotForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		ConversationID:           "conv-" + runID,
		RequestID:                runID,
		VisibleFunctionToolNames: []string{personalMemoryRecallToolName},
	})
	_, err := server.ExecutePrimaryAgent(context.Background(), input)
	return store, err
}

func assertSDKToolProjectionFailure(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	wantReason string,
) {
	t.Helper()
	attempts, err := store.ListStepAttempts(context.Background(), runID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	for _, attempt := range attempts {
		if attempt.StepID == "sdk_tool.execute.personal_memory_recall.invocation-1" {
			if attempt.Status != "failed" || attempt.FailCloseReason != wantReason {
				t.Fatalf("tool attempt = %#v, want failed %s", attempt, wantReason)
			}
			if attempt.DurationMS != 18 {
				t.Fatalf("tool attempt duration_ms = %d, want 18", attempt.DurationMS)
			}
			assertToolArgumentIdentityForTest(t, attempt.SanitizedPayload)
			return
		}
	}
	t.Fatalf("personal memory tool failure attempt missing: %#v", attempts)
}

func assertSDKToolAttemptDuration(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	stepID string,
	want int64,
) {
	t.Helper()
	attempts, err := store.ListStepAttempts(context.Background(), runID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	for _, attempt := range attempts {
		if attempt.StepID == stepID {
			if attempt.DurationMS != want {
				t.Fatalf("tool attempt duration_ms = %d, want %d", attempt.DurationMS, want)
			}
			return
		}
	}
	t.Fatalf("tool attempt %s missing: %#v", stepID, attempts)
}

func TestPrimaryAgentToolDurationMSRejectsInvalidRuntimeValues(t *testing.T) {
	var missing agentToolResult
	if err := json.Unmarshal([]byte(`{}`), &missing); err != nil {
		t.Fatalf("decode missing duration fixture: %v", err)
	}
	tests := []struct {
		name  string
		value float64
	}{
		{name: "missing", value: missing.DurationMS},
		{name: "zero", value: 0},
		{name: "negative", value: -1},
		{name: "NaN", value: math.NaN()},
		{name: "positive infinity", value: math.Inf(1)},
		{name: "negative infinity", value: math.Inf(-1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := primaryAgentToolDurationMS(test.value); err == nil {
				t.Fatalf("duration_ms %v unexpectedly accepted", test.value)
			}
		})
	}

	durationMS, err := primaryAgentToolDurationMS(17.25)
	if err != nil || durationMS != 18 {
		t.Fatalf("duration_ms = %d, err = %v, want 18", durationMS, err)
	}
}
