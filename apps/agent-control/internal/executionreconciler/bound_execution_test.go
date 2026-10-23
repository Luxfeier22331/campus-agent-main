package executionreconciler

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

func TestBoundExecutionNeedsNoInitialBindingMetadata(t *testing.T) {
	for _, cancelRun := range []bool{false, true} {
		name := "timeout"
		if cancelRun {
			name = "cancel"
		}
		t.Run(name, func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			const runID = "temporal-bound-root"
			now := confirmAndStartReconcilerRunForTest(t, store, intent, runID)
			// Deliberately omit Memo, FirstRunID and reset metadata. The stored
			// binding, not this metadata, owns all subsequent operations.
			info := execution.WorkflowExecutionInfo{
				Found: true, WorkflowID: intent.WorkflowID, RunID: runID,
				Status: execution.WorkflowExecutionStatusTimedOut, CloseTime: now,
			}
			starter := &reconcilerStarterForTest{
				describe: info,
				onDescribe: func(requestedRunID string) {
					if requestedRunID != runID {
						t.Fatalf("queried an unbound execution: %q", requestedRunID)
					}
				},
			}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
			if cancelRun {
				starter.describe.Status = execution.WorkflowExecutionStatusRunning
				starter.describe.CloseTime = time.Time{}
				command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RequestID, now, "cancel-bound")
				reconciler.ReconcileCancellationCommand(context.Background(), store, command)
				if starter.cancellations() != 1 || starter.cancellationInput().TemporalRunID != runID {
					t.Fatalf("bound root cancellation = %#v, calls=%d", starter.cancellationInput(), starter.cancellations())
				}
			} else {
				reconciler.ReconcileWorkflowTimeouts(context.Background())
				run, err := store.GetRun(context.Background(), intent.RequestID)
				if err != nil || run.Status != execution.DurableRunStatusExpired {
					t.Fatalf("bound root timeout = %#v, err=%v", run, err)
				}
			}
			if described := starter.describedTemporalRunIDs(); len(described) != 1 {
				t.Fatalf("repeated binding proof: %#v", described)
			}
		})
	}
}

func TestRecoveryMustSucceedAndBindBeforeReadingStatusOrCanceling(t *testing.T) {
	for _, test := range []struct {
		name       string
		startErr   error
		bindingErr error
		wantCode   string
	}{
		{name: "unverified root", startErr: execution.ErrWorkflowOwnershipUnsafe, wantCode: "temporal_cancel_recovery_identity_conflict"},
		{name: "binding unavailable", bindingErr: errors.New("binding unavailable"), wantCode: "temporal_cancel_recovery_binding_unavailable"},
	} {
		t.Run(test.name, func(t *testing.T) {
			base, intent := createReconcilerStartIntentForTest(t)
			leased, err := base.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "recovery-start", Now: intent.CreatedAt, LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
			})
			if err != nil || len(leased) != 1 {
				t.Fatalf("start lease = %#v, err=%v", leased, err)
			}
			markReconcilerStartDispatchForTest(t, base, leased[0], intent.CreatedAt)
			command := requestAndLeaseReconcilerCancellationForTest(t, base, intent.RequestID, intent.CreatedAt.Add(time.Second), "recovery-cancel")
			var store executionapplication.RunStore = base
			if test.bindingErr != nil {
				store = &failingWorkflowStartExecutionBindingStore{InMemoryRunProjectionStore: base, err: test.bindingErr}
			}
			starter := &reconcilerStarterForTest{startRunID: "recovery-root", startErr: test.startErr}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
			reconciler.ReconcileCancellationCommand(context.Background(), store, command)
			if starter.recoveryCalls() != 1 || starter.cancellations() != 0 {
				t.Fatalf("recovery starts=%d cancels=%d", starter.recoveryCalls(), starter.cancellations())
			}
			if described := starter.describedTemporalRunIDs(); len(described) != 1 || described[0] != "" {
				t.Fatalf("read status before binding: %#v", described)
			}
			bound, err := base.GetWorkflowStartIntent(context.Background(), intent.RequestID)
			if err != nil || bound.TemporalRunID != "" {
				t.Fatalf("failed recovery changed binding: %#v, err=%v", bound, err)
			}
			retry, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "retry-recovery", Now: lifecycleNow().Add(time.Minute), LeaseUntil: lifecycleNow().Add(2 * time.Minute), Limit: 1,
			})
			if err != nil || len(retry) != 1 || retry[0].LastErrorCode != test.wantCode {
				t.Fatalf("recovery retry = %#v, err=%v", retry, err)
			}
		})
	}
}

func TestCancellationDeliveryFailureRechecksOnlyBoundExecution(t *testing.T) {
	for _, closedStatus := range []execution.WorkflowExecutionStatus{
		execution.WorkflowExecutionStatusContinuedAsNew,
		execution.WorkflowExecutionStatusTimedOut,
		execution.WorkflowExecutionStatusTerminated,
		execution.WorkflowExecutionStatusCanceled,
	} {
		t.Run(closedStatus.String(), func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			const runID = "cancel-rpc-root"
			now := confirmAndStartReconcilerRunForTest(t, store, intent, runID)
			command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RequestID, now, "cancel-rpc")
			running := execution.WorkflowExecutionInfo{
				Found: true, WorkflowID: intent.WorkflowID, RunID: runID, Status: execution.WorkflowExecutionStatusRunning,
			}
			closed := running
			closed.Status, closed.CloseTime = closedStatus, now
			starter := &reconcilerStarterForTest{
				cancelErr: errors.New("cancel response lost"), describeSeries: []execution.WorkflowExecutionInfo{running, closed},
			}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
			reconciler.ReconcileCancellationCommand(context.Background(), store, command)
			if starter.cancellations() != 1 || starter.cancellationInput().TemporalRunID != runID {
				t.Fatalf("cancel target = %#v, calls=%d", starter.cancellationInput(), starter.cancellations())
			}
			if described := starter.describedTemporalRunIDs(); len(described) != 2 || described[0] != runID || described[1] != runID {
				t.Fatalf("cancel retry describes = %#v", described)
			}
			run, err := store.GetRun(context.Background(), intent.RequestID)
			wantStatus := execution.DurableRunStatusFailed
			switch closedStatus {
			case execution.WorkflowExecutionStatusTimedOut:
				wantStatus = execution.DurableRunStatusExpired
			case execution.WorkflowExecutionStatusCanceled:
				wantStatus = execution.DurableRunStatusCanceled
			}
			if err != nil || run.Status != wantStatus {
				t.Fatalf("closed root = %#v, err=%v", run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)
		})
	}
}
