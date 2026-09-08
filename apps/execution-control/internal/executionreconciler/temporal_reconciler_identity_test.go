package executionreconciler

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
	"testing"
	"time"
)

func TestTemporalReconcilerLeavesUnknownAlreadyStartedIdentityRetryable(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{
		startErr: execution.ErrWorkflowIdentityUnknown,
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileOnce(context.Background())
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("unknown identity run = %#v, err=%v", run, err)
	}
}

func TestTemporalReconcilerPermanentlyFailsDescribeIdentityConflictWithoutCanceling(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-identity-conflict",
		Now:        intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease = %#v, err=%v", leased, err)
	}
	info := reconcilerWorkflowInfoForIntent(t, intent, "foreign-temporal-run")
	info.Identity.PayloadSHA256 = strings.Repeat("c", 64)
	starter := &reconcilerStarterForTest{
		describe: info,
		startErr: fmt.Errorf("%w: conflicting workflow memo", execution.ErrWorkflowIdentityConflict),
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileStartIntent(context.Background(), store, leased[0])
	if starter.calls() != 1 {
		t.Fatalf("start calls = %d, want 1", starter.calls())
	}
	if starter.cancellations() != 0 {
		t.Fatalf("identity conflict delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("identity conflict run = %#v, err=%v", run, err)
	}
	failedIntent, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || failedIntent.State != execution.LifecycleIntentStatePermanentFailed ||
		failedIntent.LastErrorCode != workflowStartRemoteConflictFailure {
		t.Fatalf("identity conflict intent = %#v, err=%v", failedIntent, err)
	}
}

func TestTemporalReconcilerTimesOutBoundRootWithoutLookingForSuccessor(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	callbackCalls := 0
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-timeout-chain-first")
	exact := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timeout-chain-first")
	exact.FirstRunID = "temporal-timeout-chain-first"
	exact.Status = execution.WorkflowExecutionStatusTimedOut
	exact.CloseTime = now
	latest := exact
	latest.RunID = "temporal-timeout-reset-latest"
	latest.Status = execution.WorkflowExecutionStatusRunning
	latest.CloseTime = time.Time{}
	starter := &reconcilerStarterForTest{
		describe:       latest,
		describeSeries: []execution.WorkflowExecutionInfo{exact, latest},
	}
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-chain-reconciler"},
		store,
		starter,
		func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			callbackCalls++
			return nil
		},
	)
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	failed, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || failed.Status != execution.DurableRunStatusExpired ||
		failed.TerminalReason != execution.DurableTerminalReasonRunTimeout || callbackCalls != 1 {
		t.Fatalf("unauthorized successor run = %#v, callbacks=%d, err=%v", failed, callbackCalls, err)
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 1 ||
		described[0] != "temporal-timeout-chain-first" {
		t.Fatalf("different latest workflow timeout describes = %#v", described)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("unauthorized successor received %d cancellation calls", starter.cancellations())
	}
	bound, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || bound.TemporalRunID != exact.RunID {
		t.Fatalf("unauthorized successor changed root binding = %#v, err=%v", bound, err)
	}
}

func TestTemporalReconcilerTimesOutBoundRootDespiteResetEvidence(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-timeout-reset-root")
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timeout-reset-root")
	info.Status = execution.WorkflowExecutionStatusTimedOut
	info.CloseTime = now
	info.LastResetTime = now.Add(-time.Second)
	info.ResetRunID = "temporal-timeout-reset-successor"
	latest := info
	latest.RunID = info.ResetRunID
	latest.FirstRunID = info.RunID
	latest.Status = execution.WorkflowExecutionStatusRunning
	latest.CloseTime = time.Time{}
	callbackCalls := 0
	starter := &reconcilerStarterForTest{
		describe:       latest,
		describeSeries: []execution.WorkflowExecutionInfo{info, latest},
	}
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-reset-reconciler"},
		store,
		starter,
		func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			callbackCalls++
			return nil
		},
	)
	reconciler.ReconcileWorkflowTimeouts(context.Background())
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusExpired ||
		run.TerminalReason != execution.DurableTerminalReasonRunTimeout || callbackCalls != 1 {
		t.Fatalf("reset-marked successor run = %#v, callbacks=%d, err=%v", run, callbackCalls, err)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("reset successor received %d cancellation calls", starter.cancellations())
	}
}

func TestTemporalReconcilerBindsVerifiedRecoveryRootBeforeClosingIt(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leasedStarts, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-before-recovery-successor", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leasedStarts) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leasedStarts, err)
	}
	markReconcilerStartDispatchForTest(t, store, leasedStarts[0], intent.CreatedAt)
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		store,
		intent.RequestID,
		intent.CreatedAt.Add(time.Second),
		"cancel-recovery-successor",
	)
	root := reconcilerWorkflowInfoForIntent(t, intent, "temporal-recovery-root")
	root.Status = execution.WorkflowExecutionStatusContinuedAsNew
	root.CloseTime = intent.CreatedAt.Add(2 * time.Second)
	successor := root
	successor.RunID = "temporal-recovery-successor"
	successor.FirstRunID = root.RunID
	successor.Status = execution.WorkflowExecutionStatusRunning
	successor.CloseTime = time.Time{}
	starter := &reconcilerStarterForTest{
		startRunID: root.RunID,
		describe:   successor,
		describeSeries: []execution.WorkflowExecutionInfo{
			{Found: false},
			root,
			successor,
		},
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, command)

	if starter.recoveryCalls() != 1 || starter.cancellations() != 0 {
		t.Fatalf("successor recovery calls = starts:%d cancels:%d", starter.recoveryCalls(), starter.cancellations())
	}
	start, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || start.TemporalRunID != root.RunID {
		t.Fatalf("verified recovery root was not bound: start=%#v err=%v", start, err)
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowExecutionClosedInvariantFailure {
		t.Fatalf("successor recovery product run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, intent.CreatedAt.Add(time.Second))
}

func TestTemporalReconcilerDoesNotBindResetMarkedSupersededExecution(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-before-reset-marked-cancel", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, store, leased[0], intent.CreatedAt)
	now := intent.CreatedAt.Add(time.Second)
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		store,
		intent.RequestID,
		now,
		"cancel-reset-marked-unbound",
	)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-reset-marked-candidate")
	info.Status = execution.WorkflowExecutionStatusRunning
	info.ResetRunID = "temporal-reset-successor"
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, command)
	if starter.cancellations() != 0 {
		t.Fatalf("reset-marked unbound execution received %d cancellation calls", starter.cancellations())
	}
	start, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || start.TemporalRunID != "" {
		t.Fatalf("reset-marked candidate was bound: start=%#v err=%v", start, err)
	}
}

func TestTemporalReconcilerNeverCancelsUnknownOrConflictingWorkflowIdentity(t *testing.T) {
	for _, test := range []struct {
		name      string
		mutate    func(*execution.WorkflowExecutionInfo)
		wantRun   execution.DurableRunStatus
		wantRetry bool
	}{
		{
			name: "unknown", wantRun: execution.DurableRunStatusCreated, wantRetry: true,
			mutate: func(info *execution.WorkflowExecutionInfo) {
				info.IdentityState = execution.WorkflowIdentityUnknown
				info.Identity = execution.WorkflowIdentity{}
			},
		},
		{
			name: "conflict", wantRun: execution.DurableRunStatusCanceled,
			mutate: func(info *execution.WorkflowExecutionInfo) {
				info.Identity.PayloadSHA256 = strings.Repeat("c", 64)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			leasedStarts, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "start-before-identity-" + test.name, Now: intent.CreatedAt,
				LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
			})
			if err != nil || len(leasedStarts) != 1 {
				t.Fatalf("lease start = %#v, err=%v", leasedStarts, err)
			}
			markReconcilerStartDispatchForTest(t, store, leasedStarts[0], intent.CreatedAt)
			now := time.Now().UTC().Truncate(time.Microsecond)
			if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
				RequestID: intent.RequestID, Reason: "user_requested", Now: now,
			}); err != nil {
				t.Fatal(err)
			}
			commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "cancel-identity-" + test.name, Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
			})
			if err != nil || len(commands) != 1 {
				t.Fatalf("lease = %#v, err=%v", commands, err)
			}
			info := reconcilerWorkflowInfoForIntent(t, intent, "foreign-temporal-run")
			info.Status = execution.WorkflowExecutionStatusRunning
			test.mutate(&info)
			starter := &reconcilerStarterForTest{describe: info}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
			reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])
			if starter.cancellations() != 0 {
				t.Fatalf("identity %s delivered %d cancellation calls", test.name, starter.cancellations())
			}
			run, err := store.GetRun(context.Background(), intent.RequestID)
			if err != nil || run.Status != test.wantRun {
				t.Fatalf("identity %s run = %#v, err=%v", test.name, run, err)
			}
			if test.wantRetry {
				retry, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
					LeaseToken: "identity-retry", Now: now.Add(time.Minute), LeaseUntil: now.Add(2 * time.Minute), Limit: 1,
				})
				if err != nil || len(retry) != 1 || retry[0].LastErrorCode != "temporal_cancel_identity_unavailable" {
					t.Fatalf("identity retry = %#v, err=%v", retry, err)
				}
			}
		})
	}
}

func TestTemporalReconcilerCancelsExactIdentityVerifiedTemporalRun(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "confirm-before-exact-cancel", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("start lease = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, store, leased[0], intent.CreatedAt)
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: intent.RequestID, LeaseToken: leased[0].LeaseToken,
		TemporalRunID: "temporal-run-owned", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: intent.RequestID, Reason: "user_requested", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-exact-temporal-run", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease = %#v, err=%v", commands, err)
	}
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-owned")
	info.Status = execution.WorkflowExecutionStatusRunning
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 1 {
		t.Fatalf("cancellation calls = %d, want 1", starter.cancellations())
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 1 ||
		described[0] != "temporal-run-owned" {
		t.Fatalf("cancellation describe Temporal run ids = %#v", described)
	}
	target := starter.cancellationInput()
	if target.WorkflowID != intent.WorkflowID || target.TemporalRunID != "temporal-run-owned" ||
		target.RequestID != intent.RequestID {
		t.Fatalf("cancellation target = %#v", target)
	}
}

func TestTemporalReconcilerCancelsBoundRootDespiteResetEvidence(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-cancel-reset-root")
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		store,
		intent.RequestID,
		now,
		"cancel-reset-marked-root",
	)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cancel-reset-root")
	info.Status = execution.WorkflowExecutionStatusRunning
	info.ResetRunID = "temporal-cancel-reset-successor"
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, command)
	if starter.cancellations() != 1 || starter.cancellationInput().TemporalRunID != info.RunID {
		t.Fatalf("bound root cancellation = %#v, calls=%d", starter.cancellationInput(), starter.cancellations())
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 1 || described[0] != info.RunID {
		t.Fatalf("bound root describes = %#v", described)
	}
	retried, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-reset-marked-retry", Now: lifecycleNow().Add(time.Minute),
		LeaseUntil: lifecycleNow().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(retried) != 1 || retried[0].LastErrorCode != "temporal_cancel_projection_pending" {
		t.Fatalf("reset-marked cancellation retry = %#v, err=%v", retried, err)
	}
}

func TestTemporalReconcilerClosesBoundRootWithoutCancelingSuccessor(t *testing.T) {
	for _, test := range []struct {
		name        string
		exactStatus execution.WorkflowExecutionStatus
		failureKind string
	}{
		{
			name: "continue as new", exactStatus: execution.WorkflowExecutionStatusContinuedAsNew, failureKind: workflowExecutionClosedInvariantFailure,
		},
		{
			name: "reset can preserve first run id", exactStatus: execution.WorkflowExecutionStatusTerminated, failureKind: workflowExecutionTerminatedFailure,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-cancel-chain-first")
			command := requestAndLeaseReconcilerCancellationForTest(
				t,
				store,
				intent.RequestID,
				now,
				"cancel-continuation-chain",
			)
			exact := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cancel-chain-first")
			exact.FirstRunID = "temporal-cancel-chain-first"
			exact.Status = test.exactStatus
			exact.CloseTime = now
			latest := exact
			latest.RunID = "temporal-cancel-chain-latest"
			latest.FirstRunID = exact.FirstRunID
			latest.Status = execution.WorkflowExecutionStatusRunning
			latest.CloseTime = time.Time{}
			starter := &reconcilerStarterForTest{
				describe:       latest,
				describeSeries: []execution.WorkflowExecutionInfo{exact, latest},
			}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)

			reconciler.ReconcileCancellationCommand(
				context.Background(),
				store,
				command,
			)
			if starter.cancellations() != 0 {
				t.Fatalf("different latest execution received %d cancellation calls", starter.cancellations())
			}
			bound, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
			if err != nil || bound.TemporalRunID != exact.RunID {
				t.Fatalf("immutable start binding = %#v, err=%v", bound, err)
			}
			run, err := store.GetRun(context.Background(), intent.RequestID)
			if err != nil || run.Status != execution.DurableRunStatusFailed ||
				run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
				run.FailCloseReason != test.failureKind {
				t.Fatalf("successor cancellation product run = %#v, err=%v", run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)
			if described := starter.describedTemporalRunIDs(); len(described) != 1 || described[0] != exact.RunID {
				t.Fatalf("continuation cancellation describes = %#v", described)
			}
		})
	}
}
