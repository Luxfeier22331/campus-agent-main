package executionreconciler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"strings"
	"testing"
	"time"
)

func TestTemporalReconcilerRepairsMissingCanceledWorkflowProjection(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leasedStarts, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-before-terminal-canceled", Now: intent.CreatedAt,
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
		LeaseToken: "cancel-terminal-canceled",
		Now:        now.Add(time.Second),
		LeaseUntil: now.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease cancellation command = %#v, err=%v", commands, err)
	}
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-canceled")
	info.Status = execution.WorkflowExecutionStatusCanceled
	starter := &reconcilerStarterForTest{cancelErr: errors.New("workflow already closed"), describe: info}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])

	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("repaired cancellation status = %q, want canceled", run.Status)
	}
	retried, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-terminal-canceled-retry",
		Now:        now.Add(2 * time.Minute),
		LeaseUntil: now.Add(3 * time.Minute),
		Limit:      1,
	})
	if err != nil || len(retried) != 0 {
		t.Fatalf("confirmed cancellation command re-leased = %#v, err=%v", retried, err)
	}
}

func TestTemporalReconcilerAllowsCompletionAfterCancellationRequest(t *testing.T) {
	for _, test := range []struct {
		name                  string
		completeAfterDelivery bool
		wantCancellationCalls int
	}{
		{name: "completed before cancellation delivery"},
		{name: "completed while cancellation delivery was uncertain", completeAfterDelivery: true, wantCancellationCalls: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-completed")
			command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RequestID, now, "cancel-terminal-completed")

			completedInfo := reconcilerWorkflowInfoForIntent(t, intent, "temporal-completed")
			completedInfo.Status = execution.WorkflowExecutionStatusCompleted
			starter := &reconcilerStarterForTest{describe: completedInfo}
			if test.completeAfterDelivery {
				runningInfo := completedInfo
				runningInfo.Status = execution.WorkflowExecutionStatusRunning
				starter.cancelErr = errors.New("cancellation delivery was uncertain")
				starter.describeSeries = []execution.WorkflowExecutionInfo{
					runningInfo,
					completedInfo,
				}
			}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
			reconciler.ReconcileCancellationCommand(context.Background(), store, command)

			if starter.cancellations() != test.wantCancellationCalls {
				t.Fatalf("cancellation calls = %d, want %d", starter.cancellations(), test.wantCancellationCalls)
			}
			run, err := store.GetRun(context.Background(), intent.RequestID)
			if err != nil || run.Status != execution.DurableRunStatusRunning {
				t.Fatalf("completed Temporal workflow was projected as cancellation: run=%#v err=%v", run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)

			finalizationRef := temporalProjectionRef(intent.RequestID, "finalization/write")
			storeFinalizationCompletionProofForTest(
				t,
				store,
				intent.RequestID,
				finalizationRef,
				now.Add(4*time.Second),
			)
			completed, err := store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
				FinalResponseRef: finalizationRef,
				Now:              now.Add(4 * time.Second),
				RequestID:        intent.RequestID,
				TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
			})
			if err != nil || completed.Status != execution.DurableRunStatusCompleted {
				t.Fatalf("completion projection after confirmed cancellation = %#v, err=%v", completed, err)
			}
		})
	}
}

func TestTemporalReconcilerDoesNotSynthesizeCancellationForOtherClosedWorkflows(t *testing.T) {
	for _, test := range []struct {
		name   string
		status execution.WorkflowExecutionStatus
	}{
		{name: "failed", status: execution.WorkflowExecutionStatusFailed},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, intent := createReconcilerStartIntentForTest(t)
			leasedStarts, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "start-before-closed-" + strings.ReplaceAll(test.name, " ", "-"),
				Now:        intent.CreatedAt, LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
			})
			if err != nil || len(leasedStarts) != 1 {
				t.Fatalf("lease start = %#v, err=%v", leasedStarts, err)
			}
			markReconcilerStartDispatchForTest(t, store, leasedStarts[0], intent.CreatedAt)
			now := time.Now().UTC().Truncate(time.Microsecond)
			command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RequestID, now, "cancel-terminal-"+strings.ReplaceAll(test.name, " ", "-"))
			info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-"+strings.ReplaceAll(test.name, " ", "-"))
			info.Status = test.status
			starter := &reconcilerStarterForTest{describe: info}
			reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
			reconciler.ReconcileCancellationCommand(context.Background(), store, command)

			if starter.cancellations() != 0 {
				t.Fatalf("closed status %s delivered %d cancellation calls", test.status, starter.cancellations())
			}
			run, err := store.GetRun(context.Background(), intent.RequestID)
			if err != nil || run.Status != execution.DurableRunStatusCreated {
				t.Fatalf("closed status %s synthesized cancellation: run=%#v err=%v", test.status, run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)
		})
	}
}

func TestTemporalReconcilerProjectsTerminatedWorkflowAfterCancellationRequest(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-terminated-after-cancel")
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		store,
		intent.RequestID,
		now,
		"cancel-terminal-terminated",
	)
	closedAt := now.Add(2 * time.Second)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-terminated-after-cancel")
	info.Status = execution.WorkflowExecutionStatusTerminated
	info.CloseTime = closedAt
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "cancellation-termination-reconciler"},
		store,
		starter,
		nil,
	)
	reconciler.ReconcileCancellationCommand(context.Background(), store, command)

	if starter.cancellations() != 0 {
		t.Fatalf("terminated workflow delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.FailCloseReason != workflowExecutionTerminatedFailure || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("terminated run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)
}

func TestTemporalReconcilerProjectsTimedOutWorkflowAfterCancellationRequest(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-timed-out")
	command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RequestID, now, "cancel-terminal-timed-out")
	closedAt := now.Add(2 * time.Second)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timed-out")
	info.Status = execution.WorkflowExecutionStatusTimedOut
	info.CloseTime = closedAt
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(
		config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "cancellation-timeout-reconciler"},
		store,
		starter,
		nil,
	)
	reconciler.ReconcileCancellationCommand(context.Background(), store, command)

	if starter.cancellations() != 0 {
		t.Fatalf("timed-out workflow delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusExpired || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("timed-out run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)
}

func TestTemporalReconcilerEnsuresAndCancelsMissingDispatchedStart(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leasedStarts, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-before-recovery-cancel", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leasedStarts) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leasedStarts, err)
	}
	markReconcilerStartDispatchForTest(t, store, leasedStarts[0], intent.CreatedAt)

	cancelRequestedAt := intent.CreatedAt.Add(time.Second)
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: intent.RequestID, Reason: "user_requested", Now: cancelRequestedAt,
	}); err != nil {
		t.Fatal(err)
	}
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-recover-missing-start", Now: lifecycleNow(),
		LeaseUntil: lifecycleNow().Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease cancellation = %#v, err=%v", commands, err)
	}
	recoveredRun := reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-recovered")
	recoveredRun.Status = execution.WorkflowExecutionStatusRunning
	starter := &reconcilerStarterForTest{
		startRunID:     recoveredRun.RunID,
		describe:       recoveredRun,
		describeSeries: []execution.WorkflowExecutionInfo{{Found: false}},
		onDescribe: func(runID string) {
			if runID == "" {
				return // Initial discovery before recovery.
			}
			bound, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
			if err != nil || bound.TemporalRunID != runID {
				t.Fatalf("recovery status read preceded durable binding: %#v, err=%v", bound, err)
			}
		},
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])

	if starter.calls() != 0 || starter.recoveryCalls() != 1 {
		t.Fatalf("workflow starts = ordinary:%d recovery:%d, want 0/1", starter.calls(), starter.recoveryCalls())
	}
	if starter.cancellations() != 1 {
		t.Fatalf("recovered start cancellation calls = %d, want 1", starter.cancellations())
	}
	target := starter.cancellationInput()
	if target.WorkflowID != intent.WorkflowID || target.RequestID != intent.RequestID ||
		target.TemporalRunID != recoveredRun.RunID {
		t.Fatalf("recovered cancellation target = %#v", target)
	}
	boundStart, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || boundStart.State != execution.LifecycleIntentStateSuperseded ||
		boundStart.TemporalRunID != target.TemporalRunID {
		t.Fatalf("recovered start binding = %#v, err=%v", boundStart, err)
	}
	var recoveryInputJSON []byte
	recoveryInputJSON, err = json.Marshal(starter.cancellationRecoveryInput())
	if err != nil || string(recoveryInputJSON) != string(intent.WorkflowInputJSON) {
		t.Fatalf("recovery input changed: input=%s durable=%s err=%v", recoveryInputJSON, intent.WorkflowInputJSON, err)
	}
	described := starter.describedTemporalRunIDs()
	wantDescribed := []string{"", recoveredRun.RunID}
	if fmt.Sprint(described) != fmt.Sprint(wantDescribed) {
		t.Fatalf("recovery describes = %#v, want %#v", described, wantDescribed)
	}
	retried, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-recovered-start-projection", Now: lifecycleNow().Add(time.Minute),
		LeaseUntil: lifecycleNow().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(retried) != 1 || retried[0].LastErrorCode != "temporal_cancel_projection_pending" {
		t.Fatalf("recovered cancellation retry = %#v, err=%v", retried, err)
	}
}

func TestTemporalReconcilerFinalizesUndispatchedCancellationWithoutTemporalExecution(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leasedStarts, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-never-dispatched", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leasedStarts) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leasedStarts, err)
	}
	cancelRequestedAt := intent.CreatedAt.Add(time.Second)
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: intent.RequestID, Reason: "user_requested", Now: cancelRequestedAt,
	}); err != nil {
		t.Fatal(err)
	}
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-never-dispatched", Now: cancelRequestedAt,
		LeaseUntil: cancelRequestedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease cancellation = %#v, err=%v", commands, err)
	}
	starter := &reconcilerStarterForTest{describe: execution.WorkflowExecutionInfo{Found: false}}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 0 {
		t.Fatalf("undispatched start delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("undispatched cancellation run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, cancelRequestedAt)
}

func TestTemporalReconcilerDoesNotCancelBeforeLateExecutionBindingCommits(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	leasedStarts, err := base.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-before-binding-failure", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leasedStarts) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leasedStarts, err)
	}
	markReconcilerStartDispatchForTest(t, base, leasedStarts[0], intent.CreatedAt)
	cancelRequestedAt := intent.CreatedAt.Add(time.Second)
	if _, err := base.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: intent.RequestID, Reason: "user_requested", Now: cancelRequestedAt,
	}); err != nil {
		t.Fatal(err)
	}
	commands, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-binding-failure", Now: lifecycleNow(),
		LeaseUntil: lifecycleNow().Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease cancellation = %#v, err=%v", commands, err)
	}
	store := &failingWorkflowStartExecutionBindingStore{
		InMemoryRunProjectionStore: base,
		err:                        errors.New("binding store unavailable"),
	}
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-unbound")
	info.Status = execution.WorkflowExecutionStatusRunning
	starter := &reconcilerStarterForTest{describe: info}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 0 {
		t.Fatalf("binding failure delivered %d cancellation calls", starter.cancellations())
	}
	start, err := base.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || start.TemporalRunID != "" {
		t.Fatalf("failed binding changed start = %#v, err=%v", start, err)
	}
	retried, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-binding-failure-retry", Now: lifecycleNow().Add(time.Minute),
		LeaseUntil: lifecycleNow().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(retried) != 1 || retried[0].LastErrorCode != "temporal_start_binding_unavailable" {
		t.Fatalf("binding failure retry = %#v, err=%v", retried, err)
	}
}

func TestTemporalCancellationRechecksTerminalWinnerBeforeExternalRPC(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, base, intent, "temporal-cancel-stale-worker")
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		base,
		intent.RequestID,
		now,
		"cancel-stale-worker",
	)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cancel-stale-worker")
	info.Status = execution.WorkflowExecutionStatusRunning
	starter := &reconcilerStarterForTest{describe: info}
	store := &terminalOnCancellationRecheckStore{RunStore: base}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, command)

	if store.reads != 2 {
		t.Fatalf("durable run reads = %d, want initial and pre-RPC recheck", store.reads)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("stale cancellation worker sent %d external RPCs", starter.cancellations())
	}
	assertReconcilerCancellationConfirmedForTest(t, base, intent.RequestID, now)
}

func TestTemporalCancellationReadFailureCannotSendUsingStaleState(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, err := base.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: intent.RequestID, Reason: "user_requested", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	commands, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-read-failure", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease = %#v, err=%v", commands, err)
	}
	starter := &reconcilerStarterForTest{}
	store := failingGetRunStore{RunStore: base, err: errors.New("projection read unavailable")}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 0 {
		t.Fatalf("cancellation calls after GetRun failure = %d", starter.cancellations())
	}
}
