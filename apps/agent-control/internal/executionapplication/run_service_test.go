package executionapplication

import (
	"context"
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"strings"
	"testing"
	"time"
)

var applicationTestNow = time.Date(2026, 9, 4, 1, 2, 3, 0, time.UTC)

type applicationTestInputLoader struct {
	wire contracts.ExecutionPayloadWire
}

func (loader applicationTestInputLoader) Load(
	context.Context,
	execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	return loader.wire, nil
}

type applicationTestAdmissionBuilder struct {
	personalMemoryRecallAvailable bool
}

func (builder *applicationTestAdmissionBuilder) BuildAgentAdmissionSnapshot(
	_ context.Context,
	personalMemoryRecallAvailable bool,
) (execution.AgentAdmissionSnapshot, error) {
	builder.personalMemoryRecallAvailable = personalMemoryRecallAvailable
	return validApplicationTestAdmissionSnapshot(personalMemoryRecallAvailable), nil
}

type applicationTestWaker struct{ count int }

func (waker *applicationTestWaker) Wake() { waker.count++ }

func TestDurableRunFromCreateRequestPersistsOnlyInputReferenceMetadata(t *testing.T) {
	wire := contracts.ExecutionRunCreateRequestWire{
		ConversationID: "conversation-v3-metadata-001",
		RequestID:      "request-v3-metadata-001",
		OwnerUserID:    "user-v3-metadata-001",
		Surface:        "campus-web",
		Metadata: contracts.ExecutionRunMetadataWire{
			ExecutionContractVersion: contracts.ExecutionContractVersion,
			ExecutionInputRef:        "app-api://execution-inputs/request-v3-metadata-001",
			ExecutionInputSHA256:     strings.Repeat("a", 64),
		},
	}
	run := durableRunFromCreateRequest(
		wire,
		applicationTestNow,
		execution.WorkflowTaskQueue,
	)
	if len(run.Metadata) != 3 {
		t.Fatalf("metadata fields = %#v, want exactly three input reference fields", run.Metadata)
	}
	want := map[string]any{
		"execution_contract_version": contracts.ExecutionContractVersion,
		"execution_input_ref":        "app-api://execution-inputs/request-v3-metadata-001",
		"execution_input_sha256":     strings.Repeat("a", 64),
	}
	for key, value := range want {
		if run.Metadata[key] != value {
			t.Fatalf("metadata[%q] = %#v, want %#v", key, run.Metadata[key], value)
		}
	}
	if _, exists := run.Metadata["execution_payload"]; exists {
		t.Fatalf("metadata must not contain raw execution payload: %#v", run.Metadata)
	}
}

func TestRunServiceCreatesRunAndStartIntentBeforeWakingReconciler(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	builder := &applicationTestAdmissionBuilder{}
	waker := &applicationTestWaker{}
	wire := applicationTestCreateRequest("request-application-create", false)
	service := NewRunService(RunServiceOptions{
		AdmissionSnapshotBuilder:     builder,
		InputLoader:                  applicationTestInputLoader{wire: applicationTestPayload(wire)},
		Namespace:                    "campus-agent-test",
		Now:                          func() time.Time { return applicationTestNow },
		PersonalMemoryTimeoutSeconds: 10,
		ReconcilerWaker:              waker,
		Store:                        store,
		TaskQueue:                    execution.WorkflowTaskQueue,
	})

	result, err := service.CreateRun(context.Background(), CreateRunRequest{
		TraceParent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		Wire:        wire,
	})
	if err != nil {
		t.Fatalf("CreateRun returned error: %v", err)
	}
	if !result.Created || result.Run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("create result = %#v", result)
	}
	intent, err := store.GetWorkflowStartIntent(context.Background(), wire.RequestID)
	if err != nil {
		t.Fatalf("get workflow start intent: %v", err)
	}
	input, err := execution.DecodeAndValidateWorkflowStartInput(intent, result.Run)
	if err != nil {
		t.Fatalf("decode persisted workflow input: %v", err)
	}
	if input.Namespace != "campus-agent-test" || input.PersonalMemoryTimeoutSeconds != 10 ||
		input.TraceParent == "" {
		t.Fatalf("workflow input = %#v", input)
	}
	if builder.personalMemoryRecallAvailable {
		t.Fatal("personal memory recall was admitted for a request that did not allow it")
	}
	for _, field := range []string{"agent_limits_sha256", "agent_capabilities_sha256", "agent_budget_sha256", "tool_contract_fingerprint_sha256"} {
		if strings.Contains(string(intent.WorkflowInputJSON), field) {
			t.Fatalf("new workflow input contains retired field %s", field)
		}
	}
	for name, mutate := range map[string]func(*execution.AgentAdmissionSnapshot){
		"limits": func(s *execution.AgentAdmissionSnapshot) { s.AgentLimits.MaxOutputTokens++ },
		"capabilities": func(s *execution.AgentAdmissionSnapshot) {
			s.AgentCapabilities.HostedWebSearch = !s.AgentCapabilities.HostedWebSearch
		},
		"budget": func(s *execution.AgentAdmissionSnapshot) { s.AgentBudget.MaxModelTurns++ },
		"tool contract": func(s *execution.AgentAdmissionSnapshot) {
			s.ToolContractFingerprint.ToolsSHA256 = "sha256:" + strings.Repeat("f", 64)
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := input
			mutate(&changed.AdmissionSnapshot)
			if execution.SHA256JSONRef(changed.AdmissionSnapshot) == input.AdmissionSnapshotSHA256 {
				t.Fatal("top-level hash did not cover snapshot mutation")
			}
			changedIntent := intent
			encoded, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			changedIntent.WorkflowInputJSON = encoded
			if _, err := execution.DecodeAndValidateWorkflowStartInput(changedIntent, result.Run); err == nil {
				t.Fatal("workflow accepted mutation with stale top-level hash")
			}
		})
	}
	if waker.count != 1 {
		t.Fatalf("reconciler wake count = %d, want 1", waker.count)
	}
}

func applicationTestCreateRequest(
	requestID string,
	personalMemoryRecallAllowed bool,
) contracts.ExecutionRunCreateRequestWire {
	return contracts.ExecutionRunCreateRequestWire{
		ConversationID:              "conversation-" + requestID,
		RequestID:                   requestID,
		OwnerUserID:                 "user-application-test",
		PersonalMemoryRecallAllowed: personalMemoryRecallAllowed,
		Surface:                     "campus-web",
		RuntimeVersions:             map[string]any{"contract": "test"},
		Metadata: contracts.ExecutionRunMetadataWire{
			ExecutionContractVersion: contracts.ExecutionContractVersion,
			ExecutionInputRef:        "app-api://execution-inputs/" + requestID,
			ExecutionInputSHA256:     strings.Repeat("a", 64),
		},
	}
}

func applicationTestPayload(
	wire contracts.ExecutionRunCreateRequestWire,
) contracts.ExecutionPayloadWire {
	return contracts.ExecutionPayloadWire{
		ExecutionContractVersion: contracts.ExecutionContractVersion,
		ResponseContract:         contracts.ResponseContract,
		UserGoal:                 "原始用户目标",
		ConversationID:           wire.ConversationID,
		TenantID:                 "tenant-application-test",
		RequestID:                wire.RequestID,
		Context: map[string]any{
			"actor": map[string]any{
				"user_id": wire.OwnerUserID,
			},
			"memory": map[string]any{
				"owner_generation": int64(2),
				"owner_sequence":   int64(7),
			},
			"conversation": map[string]any{
				"current_user_message": map[string]any{
					"created_at": applicationTestNow.Format(time.RFC3339),
				},
			},
		},
	}
}

func applicationTestRunningRun(
	t *testing.T,
	personalMemoryRecallAvailable bool,
) (*executionpersistence.InMemoryRunProjectionStore, execution.DurableRun, execution.InputLoader) {
	t.Helper()
	requestID := "request-application-campus-search"
	if personalMemoryRecallAvailable {
		requestID = "request-application-memory-recall"
	}
	wire := applicationTestCreateRequest(requestID, personalMemoryRecallAvailable)
	inputLoader := applicationTestInputLoader{wire: applicationTestPayload(wire)}
	store := executionpersistence.NewInMemoryRunProjectionStore()
	service := NewRunService(RunServiceOptions{
		AdmissionSnapshotBuilder:      &applicationTestAdmissionBuilder{},
		InputLoader:                   inputLoader,
		Now:                           func() time.Time { return applicationTestNow },
		PersonalMemoryRecallAvailable: personalMemoryRecallAvailable,
		Store:                         store,
	})
	result, err := service.CreateRun(context.Background(), CreateRunRequest{Wire: wire})
	if err != nil {
		t.Fatalf("create application test run: %v", err)
	}
	for index, status := range []execution.DurableRunStatus{
		execution.DurableRunStatusQueued,
		execution.DurableRunStatusAdmitted,
		execution.DurableRunStatusRunning,
	} {
		if _, err := store.TransitionRun(
			context.Background(),
			wire.RequestID,
			status,
			"",
			applicationTestNow.Add(time.Duration(index+1)*time.Second),
		); err != nil {
			t.Fatalf("transition application test run to %s: %v", status, err)
		}
	}
	capabilities := execution.AgentCapabilitiesForAdmission(personalMemoryRecallAvailable, true)
	if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
		StepID:               "task.step.step.lookup",
		RequestID:            wire.RequestID,
		ConversationID:       wire.ConversationID,
		StepKind:             "executor",
		Status:               "started",
		ActivityAttempt:      1,
		TaskQueue:            "campus-agent.agent.model.v1",
		WorkerID:             "test:agent:001",
		StartedAt:            applicationTestNow.Add(3 * time.Second),
		UpdatedAt:            applicationTestNow.Add(3 * time.Second),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"visible_function_tool_names": capabilities.VisibleFunctionToolNames,
		},
	}); err != nil {
		t.Fatalf("upsert application test agent step: %v", err)
	}
	run, err := store.GetRun(context.Background(), result.Run.RequestID)
	if err != nil {
		t.Fatalf("get running application test run: %v", err)
	}
	return store, run, inputLoader
}

func validApplicationTestAdmissionSnapshot(
	personalMemoryRecallAvailable bool,
) execution.AgentAdmissionSnapshot {
	limits := execution.AgentRuntimeLimitsSnapshot{
		AgentDeadlineMS:       1,
		ContextCharLimit:      1,
		CurrentInputCharLimit: 1,
		MaxOutputTokens:       1,
	}
	capabilities := execution.AgentCapabilitiesForAdmission(personalMemoryRecallAvailable, true)
	budget := execution.AgentRuntimeBudgetSnapshot{
		MaxFunctionToolCalls: 8,
		MaxModelTurns:        8,
		MaxPlanSteps:         6,
		MaxReplans:           3,
		SchemaVersion:        execution.AgentRuntimeBudgetSchemaVersion,
	}
	toolContract := execution.ToolContractFingerprintSnapshot{
		FunctionSchemaSHA256: "sha256:" + strings.Repeat("b", 64),
		SchemaVersion:        execution.ToolContractFingerprintSchemaVersion,
		ToolsSHA256:          "sha256:" + strings.Repeat("c", 64),
	}
	return execution.AgentAdmissionSnapshot{
		AgentLimits:             limits,
		AgentCapabilities:       capabilities,
		AgentBudget:             budget,
		ModelTargetSHA256:       strings.Repeat("d", 64),
		ToolContractFingerprint: toolContract,
	}
}
