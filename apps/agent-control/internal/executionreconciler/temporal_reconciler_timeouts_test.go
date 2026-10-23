package executionreconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"testing"
	"time"
)

func TestTemporalReconcilerConvergesWorkflowTimeoutBeforePublishingExpired(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "confirm-timeout", Now: intent.CreatedAt, LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease timeout start = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, store, leased[0], intent.CreatedAt)
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: intent.RequestID, LeaseToken: leased[0].LeaseToken, TemporalRunID: "temporal-timeout", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	closedAt := time.Date(2026, 7, 23, 9, 10, 11, 123456000, time.UTC)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timeout")
	info.Status = execution.WorkflowExecutionStatusTimedOut
	info.CloseTime = closedAt
	callbackCalls := 0
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-reconciler"},
		store,
		&reconcilerStarterForTest{describe: info},
		func(_ context.Context, _ execution.DurableRun, completedAt time.Time, response map[string]any) error {
			callbackCalls++
			if !completedAt.Equal(closedAt) || execution.StringValue(response["status"]) != "error" {
				t.Errorf("timeout callback completed_at=%s response=%#v", completedAt, response)
			}
			if callbackCalls == 1 {
				return errors.New("callback unavailable")
			}
			return nil
		},
	)
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run became terminal before callback succeeded: %#v err=%v", run, err)
	}
	for _, event := range mustListRunEvents(t, store, intent.RequestID) {
		if event.EventType == execution.DurableRunEventTypeRunExpired {
			t.Fatal("run.expired published before callback succeeded")
		}
	}
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	run, err = store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusExpired ||
		run.TerminalReason != execution.DurableTerminalReasonRunTimeout || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("expired run = %#v err=%v", run, err)
	}
	events := mustListRunEvents(t, store, intent.RequestID)
	if events[len(events)-1].EventType != execution.DurableRunEventTypeRunExpired {
		t.Fatalf("terminal event = %#v", events[len(events)-1])
	}
	attempts, err := store.ListStepAttempts(context.Background(), intent.RequestID)
	if err != nil || len(attempts) != 1 || attempts[0].TimeoutOutcome != execution.TimeoutOutcomeWorkflowTimeout {
		t.Fatalf("timeout attempts = %#v, err=%v", attempts, err)
	}
}

func TestTemporalReconcilerConvergesTerminatedWorkflowBeforePublishingFailed(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-terminated")
	closedAt := time.Date(2026, 7, 23, 10, 11, 12, 654321000, time.UTC)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-terminated")
	info.Status = execution.WorkflowExecutionStatusTerminated
	info.CloseTime = closedAt
	callbackCalls := 0
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "termination-reconciler"},
		store,
		&reconcilerStarterForTest{describe: info},
		func(_ context.Context, _ execution.DurableRun, completedAt time.Time, response map[string]any) error {
			callbackCalls++
			if !completedAt.Equal(closedAt) || execution.StringValue(response["status"]) != "error" {
				t.Errorf("termination callback completed_at=%s response=%#v", completedAt, response)
			}
			if callbackCalls == 1 {
				return errors.New("callback unavailable")
			}
			return nil
		},
	)

	reconciler.ReconcileWorkflowTimeouts(context.Background())
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run became terminal before termination callback succeeded: %#v err=%v", run, err)
	}
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	run, err = store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowExecutionTerminatedFailure || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("terminated run = %#v err=%v", run, err)
	}
	events := mustListRunEvents(t, store, intent.RequestID)
	if events[len(events)-1].EventType != execution.DurableRunEventTypeRunFailed {
		t.Fatalf("terminal event = %#v", events[len(events)-1])
	}
	attempts, err := store.ListStepAttempts(context.Background(), intent.RequestID)
	if err != nil || len(attempts) != 1 || attempts[0].StepID != "workflow.execution" ||
		attempts[0].FailCloseReason != workflowExecutionTerminatedFailure {
		t.Fatalf("termination attempts = %#v, err=%v", attempts, err)
	}
	conflictingCloseTime := closedAt.Add(time.Second)
	if err := reconciler.finalizeTerminatedWorkflow(context.Background(), store, run, conflictingCloseTime); !errors.Is(err, execution.ErrDurableRunFailureConflict) {
		t.Fatalf("conflicting termination replay error = %v, want ErrDurableRunFailureConflict", err)
	}
}

func TestTemporalReconcilerFailClosesClosedWorkflowWithoutProductTerminalProjection(t *testing.T) {
	for _, test := range []struct {
		name        string
		status      execution.WorkflowExecutionStatus
		failureKind string
	}{
		{
			name:        "completed",
			status:      execution.WorkflowExecutionStatusCompleted,
			failureKind: workflowCompletedUnprojectedFailure,
		},
		{
			name:        "failed",
			status:      execution.WorkflowExecutionStatusFailed,
			failureKind: workflowFailedUnprojectedFailure,
		},
		{
			name:        "canceled without durable cancellation command",
			status:      execution.WorkflowExecutionStatusCanceled,
			failureKind: workflowCanceledUnprojectedFailure,
		},
		{
			name:        "continued as new without successor visibility",
			status:      execution.WorkflowExecutionStatusContinuedAsNew,
			failureKind: workflowExecutionClosedInvariantFailure,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-closed-unprojected")
			closedAt := now.Add(time.Second)
			info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-closed-unprojected")
			info.Status = test.status
			info.CloseTime = closedAt
			callbackCalls := 0
			reconciler := newReconcilerForTest(
				config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "closed-workflow-reconciler"},
				store,
				&reconcilerStarterForTest{describe: info},
				func(_ context.Context, _ execution.DurableRun, completedAt time.Time, response map[string]any) error {
					callbackCalls++
					if !completedAt.Equal(closedAt) || execution.StringValue(execution.NestedMap(response, "error")["code"]) != test.failureKind {
						t.Errorf("closed callback completed_at=%s response=%#v", completedAt, response)
					}
					return nil
				},
			)

			reconciler.ReconcileWorkflowTimeouts(context.Background())

			run, err := store.GetRun(context.Background(), intent.RequestID)
			if err != nil || run.Status != execution.DurableRunStatusFailed ||
				run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
				run.FailCloseReason != test.failureKind || !run.CompletedAt.Equal(closedAt) {
				t.Fatalf("closed workflow run = %#v, err=%v", run, err)
			}
			if callbackCalls != 1 {
				t.Fatalf("closed workflow callback calls = %d, want 1", callbackCalls)
			}
		})
	}
}

func TestTemporalReconcilerTimeoutScanPaginatesPastFailedBatchAndWraps(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	leased, err := base.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "confirm-paginated-timeout", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, base, leased[0], intent.CreatedAt)
	if err := base.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: intent.RequestID, LeaseToken: leased[0].LeaseToken,
		TemporalRunID: "temporal-paginated-timeout", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	confirmedIntent, err := base.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	run, err := base.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	bindings := make([]execution.ActiveWorkflowRun, 0, temporalReconcileBatch+1)
	for index := range temporalReconcileBatch {
		runID := fmt.Sprintf("run-%03d", index)
		bindings = append(bindings, execution.ActiveWorkflowRun{
			Run: execution.DurableRun{RequestID: runID},
			StartIntent: execution.WorkflowStartIntent{
				RequestID: runID, WorkflowInputJSON: json.RawMessage(`{}`),
			},
		})
	}
	bindings = append(bindings, execution.ActiveWorkflowRun{Run: run, StartIntent: confirmedIntent})
	store := &pagedActiveWorkflowStore{
		RunStore: base, bindings: bindings,
	}
	closedAt := time.Date(2026, 7, 23, 10, 11, 12, 123456000, time.UTC)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-paginated-timeout")
	info.Status = execution.WorkflowExecutionStatusTimedOut
	info.CloseTime = closedAt
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-page-reconciler"},
		store,
		starter,
		nil,
	)

	reconciler.ReconcileWorkflowTimeouts(context.Background())
	if firstPageRun, err := base.GetRun(context.Background(), intent.RequestID); err != nil ||
		firstPageRun.Status != execution.DurableRunStatusQueued {
		t.Fatalf("later-page run changed during first page: %#v err=%v", firstPageRun, err)
	}
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	expired, err := base.GetRun(context.Background(), intent.RequestID)
	if err != nil || expired.Status != execution.DurableRunStatusExpired || !expired.CompletedAt.Equal(closedAt) {
		t.Fatalf("later-page timeout did not converge: %#v err=%v", expired, err)
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 1 ||
		described[0] != "temporal-paginated-timeout" {
		t.Fatalf("timeout describe Temporal run ids = %#v", described)
	}
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	if len(store.cursors) != 3 || store.cursors[0] != "" || store.cursors[1] != "run-031" || store.cursors[2] != "" {
		t.Fatalf("active scan cursors = %#v", store.cursors)
	}
}
