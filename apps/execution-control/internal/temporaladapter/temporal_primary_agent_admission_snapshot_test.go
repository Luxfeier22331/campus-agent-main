package temporaladapter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestExecutePrimaryAgentActivityDelegatesPinnedTargetToAgentRuntime(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 8, 0, 0, 0, time.UTC)
	createQueuedDurableRunForTest(
		t,
		store,
		"run-admission-snapshot",
		"conv-admission-snapshot",
		now,
		agentRequestForDurableWorkerTest("hi"),
	)
	toolContract := toolContractFingerprintForTest(t)
	requests := 0
	agentRuntime := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		requests++
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode agent runtime request: %v", err)
		}
		if payload["expected_model_target_sha256"] != primaryAgentModelTargetSHA256ForTest {
			t.Fatalf("expected target hash = %#v", payload["expected_model_target_sha256"])
		}
		writeAgentRuntimeSSEEvent(t, response, "completed", map[string]any{
			"status":                    "completed",
			"request_id":                "run-admission-snapshot",
			"final_output":              "snapshot answer",
			"tool_results":              []any{},
			"terminal_reason":           "answer_completed",
			"provider_response_id":      "resp-admission-snapshot",
			"runtime_release":           "agent-runtime@different-release",
			"tool_contract_fingerprint": execution.ToolContractFingerprintSnapshotMap(toolContract),
		})
	}))
	defer agentRuntime.Close()

	server := newAdapterForTest(config.Config{
		AgentRuntimeBaseURL:          agentRuntime.URL,
		AgentRuntimeSharedSecret:     "agent-secret",
		AgentRuntimeDeadlineMS:       1000,
		AgentRuntimeContextCharLimit: 12000,
		AgentRuntimeInputCharLimit:   4000,
		AgentRuntimeMaxOutputTokens:  256,
		DeploymentRelease:            "execution-control@current-release",
		TemporalWorkerIdentity:       "test:agent:admission-snapshot",
	})
	attachRunProjectionStoreForAdapterTest(server, store)
	server.admissionService = executionapplication.NewAdmissionService(executionapplication.AdmissionOptions{
		AgentDeadlineMS:       server.config.AgentRuntimeDeadlineMS,
		ContextCharLimit:      server.config.AgentRuntimeContextCharLimit,
		CurrentInputCharLimit: server.config.AgentRuntimeInputCharLimit,
		MaxOutputTokens:       server.config.AgentRuntimeMaxOutputTokens,
		PrimaryAgentTargetResolver: staticPrimaryAgentTargetResolver{
			targetSHA256: primaryAgentModelTargetSHA256ForTest,
		},
	})
	snapshot, err := server.admissionService.BuildAgentAdmissionSnapshot(context.Background(), false)
	if err != nil {
		t.Fatalf("build immutable admission snapshot: %v", err)
	}

	input := temporalruntime.ExecutePrimaryAgentActivityInput{
		AdmissionSnapshot:        snapshot,
		ConversationID:           "conv-admission-snapshot",
		RequestID:                "run-admission-snapshot",
		VisibleFunctionToolNames: append([]string{}, snapshot.ExecutionStrategy.VisibleFunctionToolNames...),
	}
	_, err = server.ExecutePrimaryAgent(context.Background(), input)
	if err != nil || requests != 1 {
		t.Fatalf("activity error = %v, agent runtime requests = %d", err, requests)
	}
}

func TestValidateAdmissionSnapshotRejectsMissingProviderHash(t *testing.T) {
	limits := execution.AgentRuntimeLimitsSnapshot{
		AgentDeadlineMS:       1,
		ContextCharLimit:      1,
		CurrentInputCharLimit: 1,
		MaxOutputTokens:       1,
	}
	strategy := execution.ExecutionStrategyForAdmission(false)
	snapshot := execution.AgentAdmissionSnapshot{
		AgentLimits:             limits,
		AgentLimitsSHA256:       execution.HashAdmissionJSON(limits),
		ExecutionStrategy:       strategy,
		ExecutionStrategySHA256: execution.HashAdmissionJSON(strategy),
	}
	if err := execution.ValidateAdmissionSnapshot(snapshot); err == nil {
		t.Fatal("provider identity without fingerprint was accepted")
	}
}

func TestValidateExecutionStrategyAllowsIndependentBudgetAndToolOrder(t *testing.T) {
	strategy := execution.ExecutionStrategyForAdmission(true)
	strategy.VisibleFunctionToolNames = []string{personalMemoryRecallToolName, campusSearchToolName}
	strategy.MaxFunctionToolCalls = 1
	strategy.MaxModelTurns = 2
	if err := execution.ValidateExecutionStrategy(strategy); err != nil {
		t.Fatalf("validate independent strategy: %v", err)
	}
	toolContractSnapshot := toolContractFingerprintForTest(t)
	snapshot := execution.AgentAdmissionSnapshot{
		AgentLimits:                   execution.AgentRuntimeLimitsSnapshot{AgentDeadlineMS: 1, ContextCharLimit: 1, CurrentInputCharLimit: 1, MaxOutputTokens: 1},
		ExecutionStrategy:             strategy,
		ExecutionStrategySHA256:       execution.HashAdmissionJSON(strategy),
		PrimaryAgentTargetSHA256:      strings.Repeat("a", 64),
		ToolContractFingerprint:       toolContractSnapshot,
		ToolContractFingerprintSHA256: execution.HashAdmissionJSON(toolContractSnapshot),
	}
	snapshot.AgentLimitsSHA256 = execution.HashAdmissionJSON(snapshot.AgentLimits)
	if err := execution.ValidateAdmissionSnapshotForVisibleTools(
		snapshot,
		[]string{campusSearchToolName, personalMemoryRecallToolName},
	); err != nil {
		t.Fatalf("validate reordered visible tools: %v", err)
	}
	if err := execution.ValidateAdmissionSnapshotForVisibleTools(
		snapshot,
		[]string{campusSearchToolName, campusSearchToolName},
	); err == nil {
		t.Fatal("validate visible tools accepted duplicate caller names")
	}
}
