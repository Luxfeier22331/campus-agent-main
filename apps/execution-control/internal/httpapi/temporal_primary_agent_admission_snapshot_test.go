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

func TestExecutePrimaryAgentActivityRejectsProviderSettingRotationAfterAdmission(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 8, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-admission-snapshot",
		"conv-admission-snapshot",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	toolRuntime, err := buildToolRuntimeFingerprint("")
	if err != nil {
		t.Fatalf("build tool runtime fingerprint: %v", err)
	}
	requests := 0
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		var ignored map[string]any
		if err := json.NewDecoder(request.Body).Decode(&ignored); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":                   "completed",
			"run_id":                   "run-admission-snapshot",
			"final_output":             "snapshot answer",
			"tool_results":             []any{},
			"terminal_reason":          "answer_completed",
			"terminal_envelope":        map[string]any{"kind": "answer", "answer_text": "snapshot answer"},
			"provider_response_id":     "resp-admission-snapshot",
			"tool_runtime_fingerprint": toolRuntime.toMap(),
		})
	}))
	defer agentRuntime.Close()

	pinnedProvider := primaryAgentProviderConfigSnapshotForTest()
	pinnedProvider.APIKey = "sk-pinned"
	pinnedProvider.Model = "model-pinned"
	activeProvider := pinnedProvider
	activeProvider.APIKey = "sk-active"
	activeProvider.Model = "model-active"
	embeddingProvider := embeddingProviderConfigSnapshotForTest(
		providerConfigKindEmbedding,
		"https://embedding.example/v1",
		"embedding-test",
		2560,
	)
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:          agentRuntime.URL,
		AgentRuntimeSharedSecret:     "agent-secret",
		AgentRuntimeDeadlineMS:       1000,
		AgentRuntimeContextCharLimit: 12000,
		AgentRuntimeInputCharLimit:   4000,
		AgentRuntimeMaxOutputTokens:  256,
		TemporalWorkerIdentity:       "test:agent:admission-snapshot",
	})
	attachRunProjectionStoreForHandlerTest(server, store)
	server.toolReadModel = knowledgeReadModelForTest()
	server.providerConfigResolver = staticProviderConfigResolver{
		providerConfigKindLLM:       pinnedProvider,
		providerConfigKindEmbedding: embeddingProvider,
	}
	snapshot, err := server.buildAgentAdmissionSnapshot(
		context.Background(),
		false,
		false,
		groundingPlanForTest("hi", "student_rules"),
	)
	if err != nil {
		t.Fatalf("build immutable admission snapshot: %v", err)
	}
	server.providerConfigResolver = staticProviderConfigResolver{
		providerConfigKindLLM:       activeProvider,
		providerConfigKindEmbedding: embeddingProvider,
	}

	input := withGroundingContextForTest(t, server, temporalruntime.ExecutePrimaryAgentActivityInput{
		AdmissionSnapshot: snapshot,
		ConversationID:    "conv-admission-snapshot",
		RequestID:         "req-admission-snapshot",
		RunID:             "run-admission-snapshot",
		TraceID:           "trace-executor-001",
		TurnID:            "turn-admission-snapshot",
		VisibleToolNames:  []string{},
	})
	_, err = server.ExecutePrimaryAgentActivity(context.Background(), input)
	if err == nil || requests != 0 {
		t.Fatalf("rotated provider setting error = %v, agent runtime requests = %d", err, requests)
	}
}

func TestValidateAdmissionSnapshotRejectsMissingProviderHash(t *testing.T) {
	limits := temporalruntime.AgentRuntimeLimitsSnapshot{
		AgentDeadlineMS:       1,
		ContextCharLimit:      1,
		CurrentInputCharLimit: 1,
		MaxOutputTokens:       1,
	}
	strategy := executionStrategyForAdmission(false, false)
	snapshot := temporalruntime.AgentAdmissionSnapshot{
		AgentLimits:             limits,
		AgentLimitsSHA256:       hashAdmissionJSON(limits),
		DocumentScopes:          []temporalruntime.DocumentScope{},
		DocumentScopesSHA256:    hashDocumentScopes(nil),
		ExecutionStrategy:       strategy,
		ExecutionStrategySHA256: hashAdmissionJSON(strategy),
	}
	if err := validateAdmissionSnapshot(snapshot); err == nil {
		t.Fatal("provider identity without fingerprint was accepted")
	}
}

func TestExecutePrimaryAgentActivityRejectsLocalToolRuntimeDriftBeforeAgentCall(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 8, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-local-tool-runtime-drift",
		"conv-local-tool-runtime-drift",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	requests := 0
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		requests++
	}))
	defer agentRuntime.Close()
	server := NewServer(config.Config{
		AgentRuntimeBaseURL:      agentRuntime.URL,
		AgentRuntimeSharedSecret: "agent-secret",
		DeploymentRelease:        "worker-release",
	})
	attachRunProjectionStoreForHandlerTest(server, store)
	attachAgentAdmissionProviderConfigsForTest(server)
	admittedToolRuntime, err := buildToolRuntimeFingerprint("admitted-release")
	if err != nil {
		t.Fatalf("build admitted tool runtime: %v", err)
	}
	snapshot, err := server.buildAgentAdmissionSnapshot(
		context.Background(),
		false,
		false,
		groundingPlanForTest("hi"),
	)
	if err != nil {
		t.Fatalf("build admission snapshot: %v", err)
	}
	snapshot.ToolRuntimeFingerprint = admittedToolRuntime.toAdmissionSnapshot()
	snapshot.ToolRuntimeFingerprintSHA256 = hashAdmissionJSON(snapshot.ToolRuntimeFingerprint)

	_, err = server.ExecutePrimaryAgentActivity(context.Background(), temporalruntime.ExecutePrimaryAgentActivityInput{
		AdmissionSnapshot: snapshot,
		ConversationID:    "conv-local-tool-runtime-drift",
		RunID:             "run-local-tool-runtime-drift",
		TraceID:           "trace-executor-001",
		TurnID:            "turn-local-tool-runtime-drift",
	})
	if err == nil || requests != 0 {
		t.Fatalf("local runtime drift error = %v, agent runtime requests = %d", err, requests)
	}
}
