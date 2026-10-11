package agentruntimetest_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/agenttest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/httpapi"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type recallAdmission struct {
	snapshot execution.AgentAdmissionSnapshot
}

func (a recallAdmission) BuildAgentAdmissionSnapshot(context.Context, bool) (execution.AgentAdmissionSnapshot, error) {
	return a.snapshot, nil
}

type memoryRecaller struct {
	facts   []string
	request memoryruntime.RecallRequest
}

func (r *memoryRecaller) Recall(_ context.Context, request memoryruntime.RecallRequest) (memoryruntime.RecallResult, error) {
	r.request = request
	return memoryruntime.RecallResult{Facts: r.facts, ContextCharBudget: 16}, nil
}

func TestNodeGoPersonalMemoryRecallTransport(t *testing.T) {
	for _, matched := range []bool{true, false} {
		name := "empty"
		if matched {
			name = "matched"
		}
		t.Run(name, func(t *testing.T) {
			now := time.Now().UTC()
			wire := contracts.ExecutionRunCreateRequestWire{
				RequestID: "recall-transport", ConversationID: "recall-conversation", OwnerUserID: "recall-owner", Surface: "campus-web",
				PersonalMemoryRecallAllowed: true,
				RuntimeVersions:             map[string]any{"contract": "test"},
				Metadata:                    contracts.ExecutionRunMetadataWire{ExecutionContractVersion: contracts.ExecutionContractVersion, ExecutionInputRef: "app-api://execution-inputs/recall-transport", ExecutionInputSHA256: strings.Repeat("a", 64)},
			}
			input := agenttest.Input{Wire: contracts.ExecutionPayloadWire{
				ExecutionContractVersion: contracts.ExecutionContractVersion, ResponseContract: contracts.ResponseContract,
				RequestID: wire.RequestID, ConversationID: wire.ConversationID, TenantID: "recall-tenant", UserGoal: "回忆偏好",
				Context: map[string]any{"memory": map[string]any{"owner_generation": int64(2)}, "conversation": map[string]any{"current_user_message": map[string]any{"created_at": now.Format(time.RFC3339)}}},
			}}
			store := executionpersistence.NewInMemoryRunProjectionStore()
			service := executionapplication.NewRunService(executionapplication.RunServiceOptions{
				Store: store, InputLoader: input, PersonalMemoryRecallAvailable: true,
				AdmissionSnapshotBuilder: recallAdmission{snapshot: agenttest.AdmissionSnapshot(t, true)},
			})
			if _, err := service.CreateRun(t.Context(), executionapplication.CreateRunRequest{Wire: wire}); err != nil {
				t.Fatal(err)
			}
			for _, status := range []execution.DurableRunStatus{execution.DurableRunStatusQueued, execution.DurableRunStatusAdmitted, execution.DurableRunStatusRunning} {
				if _, err := store.TransitionRun(t.Context(), wire.RequestID, status, "", now); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := store.UpsertRunStep(t.Context(), execution.RunStepProjection{
				RequestID: wire.RequestID, ConversationID: wire.ConversationID, StepID: "task.step.memory", StepKind: "executor", Status: "started", ActivityAttempt: 1,
				PayloadSchemaVersion: "run-step-projection-v1", TaskQueue: "campus-agent.activity.agent.v3", WorkerID: "test:agent:001",
				StartedAt: now, UpdatedAt: now, SanitizedPayload: map[string]any{"visible_function_tool_names": []string{"personal_memory_recall"}},
			}); err != nil {
				t.Fatal(err)
			}
			recaller := &memoryRecaller{}
			if matched {
				recaller.facts = []string{"这条事实无法放入剩余预算", "😀"}
			}
			server := httptest.NewServer(httpapi.NewServerWithOptions(config.Config{AgentRuntimeSharedSecret: "integration-secret"}, httpapi.ServerOptions{
				PersonalMemoryRecallTool: executionapplication.NewPersonalMemoryRecallToolService(executionapplication.PersonalMemoryRecallToolServiceOptions{Authorizer: executionapplication.NewRunToolAuthorizer(executionapplication.RunToolAuthorizerOptions{Store: store, InputLoader: input}), PersonalMemoryExecutor: recaller}),
			}))
			defer server.Close()
			script, err := filepath.Abs("recall.ts")
			if err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--experimental-strip-types", script, server.URL)
			cmd.Dir = "../.."
			output, err := cmd.Output()
			if err != nil {
				t.Fatalf("Node recall: %v", err)
			}
			var result struct {
				Status string         `json:"status"`
				Result map[string]any `json:"result"`
			}
			if err := json.Unmarshal(output, &result); err != nil {
				t.Fatal(err)
			}
			wantText, wantOutcome := "", "no_match"
			if matched {
				wantText, wantOutcome = "用户记忆:\n相关事实:\n- 😀", "matched"
			}
			if result.Status != "completed" || result.Result["memory_text"] != wantText || result.Result["outcome"] != wantOutcome || len(result.Result) != 2 {
				t.Fatalf("Node result: %s", output)
			}
			if recaller.request.UserID != wire.OwnerUserID || recaller.request.OwnerGeneration != 2 || recaller.request.UserGoal != "偏好" {
				t.Fatalf("recall input: %+v", recaller.request)
			}
		})
	}
}
