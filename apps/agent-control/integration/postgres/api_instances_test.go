//go:build postgres_integration

package postgres_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionpersistence"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionreconciler"
)

type instanceInputs struct{}

func (instanceInputs) Load(_ context.Context, run execution.DurableRun) (contracts.ExecutionPayloadWire, error) {
	return contracts.ExecutionPayloadWire{ExecutionContractVersion: contracts.ExecutionContractVersion, ResponseContract: contracts.ResponseContract, RequestID: run.RequestID, ConversationID: run.ConversationID, UserGoal: "校园服务指南", Context: map[string]any{}}, nil
}
func (instanceInputs) BuildAgentAdmissionSnapshot(context.Context, bool) (execution.AgentAdmissionSnapshot, error) {
	snapshot := execution.AgentAdmissionSnapshot{AgentCapabilities: execution.AgentCapabilitiesSnapshot{SchemaVersion: execution.AgentCapabilitiesSchemaVersion, HostedWebSearch: true, VisibleFunctionToolNames: []string{"campus_search"}}, AgentBudget: execution.AgentRuntimeBudgetSnapshot{SchemaVersion: execution.AgentRuntimeBudgetSchemaVersion, MaxFunctionToolCalls: 8, MaxModelTurns: 8, MaxPlanSteps: 4, MaxReplans: 2}}
	snapshot.AgentLimits.AgentDeadlineMS = 1000
	snapshot.AgentLimits.ContextCharLimit = 1000
	snapshot.AgentLimits.CurrentInputCharLimit = 1000
	snapshot.AgentLimits.MaxOutputTokens = 1000
	snapshot.ModelTargetSHA256 = strings.Repeat("a", 64)
	snapshot.ToolContractFingerprint = execution.ToolContractFingerprintSnapshot{SchemaVersion: execution.ToolContractFingerprintSchemaVersion, FunctionSchemaSHA256: "sha256:" + strings.Repeat("b", 64), ToolsSHA256: "sha256:" + strings.Repeat("c", 64)}
	return snapshot, nil
}

type instanceStarter struct{ starts atomic.Int32 }

func (s *instanceStarter) StartToolExecutionWorkflow(context.Context, execution.WorkflowStartInput) (string, error) {
	s.starts.Add(1)
	return "root-run", nil
}
func (*instanceStarter) CancelToolExecutionWorkflow(context.Context, execution.WorkflowCancelInput) error {
	return nil
}

func testAPIInstances(t *testing.T, harness *postgresHarness) {
	_, databaseURL := harness.ownerDatabase(t)
	stores := []*executionpersistence.PostgresRunProjectionStore{newRunProjectionStore(t, databaseURL, true), newRunProjectionStore(t, databaseURL, true)}
	services := make([]*executionapplication.RunService, 2)
	starter := &instanceStarter{}
	reconcilers := make([]*executionreconciler.Reconciler, 2)
	for i, store := range stores {
		services[i] = executionapplication.NewRunService(executionapplication.RunServiceOptions{Store: store, Namespace: "campus-agent-test", InputLoader: instanceInputs{}, AdmissionSnapshotBuilder: instanceInputs{}})
		reconcilers[i] = executionreconciler.New(executionreconciler.Options{Store: store, Starter: starter})
	}
	request := executionapplication.CreateRunRequest{Wire: contracts.ExecutionRunCreateRequestWire{RequestID: "request-two-api", ConversationID: "conversation-two-api", OwnerUserID: "user-two-api", Surface: "campus-web", Metadata: contracts.ExecutionRunMetadataWire{ExecutionContractVersion: contracts.ExecutionContractVersion, ExecutionInputRef: "app-api://execution-inputs/request-two-api", ExecutionInputSHA256: strings.Repeat("a", 64)}}}
	failures := make(chan error, 2)
	raceInstances(func(i int) { _, err := services[i].CreateRun(t.Context(), request); failures <- err })
	for range 2 {
		if err := <-failures; err != nil {
			t.Fatalf("idempotent create: %v", err)
		}
	}
	saved, err := stores[0].GetWorkflowStartIntent(t.Context(), request.Wire.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	savedRun, err := stores[0].GetRun(t.Context(), request.Wire.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := execution.DecodeAndValidateWorkflowStartInput(saved, savedRun); err != nil {
		t.Fatalf("invalid fixture: %v", err)
	}
	raceInstances(func(i int) { reconcilers[i].ReconcileStarts(t.Context()) })
	if starter.starts.Load() != 1 {
		t.Fatalf("start calls = %d, want 1", starter.starts.Load())
	}
	intent, err := stores[1].GetWorkflowStartIntent(t.Context(), request.Wire.RequestID)
	if err != nil || intent.TemporalRunID != "root-run" {
		t.Fatalf("confirmed start = %#v, %v", intent, err)
	}
	raceInstances(func(i int) {
		_, err := services[i].RequestRunCancellation(t.Context(), executionapplication.RequestRunCancellationRequest{RequestID: request.Wire.RequestID, Reason: "user_requested"})
		failures <- err
	})
	for range 2 {
		if err := <-failures; err != nil {
			t.Fatalf("idempotent cancel: %v", err)
		}
	}
	leased := make(chan int, 2)
	raceInstances(func(i int) {
		now := time.Now().UTC()
		commands, err := stores[i].LeaseRunCancellationCommands(t.Context(), execution.LifecycleLeaseRequest{LeaseToken: []string{"api-one", "api-two"}[i], Now: now, LeaseUntil: now.Add(time.Minute), Limit: 10})
		failures <- err
		leased <- len(commands)
	})
	for range 2 {
		if err := <-failures; err != nil {
			t.Fatalf("lease cancellation: %v", err)
		}
	}
	if count := <-leased + <-leased; count != 1 {
		t.Fatalf("cancel leases = %d, want 1", count)
	}
	t.Run("cancel fences a competing start from another instance", func(t *testing.T) {
		request.Wire.RequestID = "request-start-cancel"
		request.Wire.ConversationID = "conversation-start-cancel"
		request.Wire.Metadata.ExecutionInputRef = "app-api://execution-inputs/request-start-cancel"
		if _, err := services[0].CreateRun(t.Context(), request); err != nil {
			t.Fatal(err)
		}
		now := time.Now().UTC()
		starts, err := stores[0].LeaseWorkflowStartIntents(t.Context(), execution.LifecycleLeaseRequest{LeaseToken: "start-owner", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1})
		if err != nil || len(starts) != 1 {
			t.Fatalf("lease: %#v %v", starts, err)
		}
		var dispatchErr, cancelErr error
		raceInstances(func(i int) {
			if i == 0 {
				dispatchErr = stores[0].MarkWorkflowStartDispatchAttempt(t.Context(), execution.WorkflowStartIntentResult{RequestID: request.Wire.RequestID, LeaseToken: "start-owner", Now: now})
			} else {
				_, cancelErr = services[1].RequestRunCancellation(t.Context(), executionapplication.RequestRunCancellationRequest{RequestID: request.Wire.RequestID, Reason: "user_requested"})
			}
		})
		if cancelErr != nil || (dispatchErr != nil && !errors.Is(dispatchErr, execution.ErrLifecycleLeaseConflict)) {
			t.Fatalf("start/cancel: %v / %v", dispatchErr, cancelErr)
		}
		if err := stores[0].MarkWorkflowStartDispatchAttempt(t.Context(), execution.WorkflowStartIntentResult{RequestID: request.Wire.RequestID, LeaseToken: "start-owner", Now: now}); !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
			t.Fatalf("canceled dispatch not fenced: %v", err)
		}
		intent, err := stores[0].GetWorkflowStartIntent(t.Context(), request.Wire.RequestID)
		if err != nil || intent.State != execution.LifecycleIntentStateSuperseded {
			t.Fatalf("canceled intent: %#v %v", intent, err)
		}
	})

}
func raceInstances(run func(int)) {
	start := make(chan struct{})
	var group sync.WaitGroup
	for i := range 2 {
		group.Add(1)
		go func() { defer group.Done(); <-start; run(i) }()
	}
	close(start)
	group.Wait()
}
