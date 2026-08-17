package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
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
		RunID: intent.RunID, Reason: "user_requested", Now: now,
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
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED
	starter := &reconcilerStarterForTest{cancelErr: errors.New("workflow already closed"), describe: info}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store,
		temporalStarter: starter, executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
	}
	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, commands[0])

	run, err := store.GetRun(context.Background(), intent.RunID)
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
			command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RunID, now, "cancel-terminal-completed")

			completedInfo := reconcilerWorkflowInfoForIntent(t, intent, "temporal-completed")
			completedInfo.Status = enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED
			starter := &reconcilerStarterForTest{describe: completedInfo}
			if test.completeAfterDelivery {
				runningInfo := completedInfo
				runningInfo.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
				starter.cancelErr = errors.New("cancellation delivery was uncertain")
				starter.describeSeries = []temporalruntime.WorkflowExecutionInfo{
					runningInfo,
					runningInfo,
					completedInfo,
					completedInfo,
				}
			}
			server := &Server{
				config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store,
				temporalStarter: starter, executionInputLoader: noOpExecutionInputLoader{},
				productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
			}
			(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)

			if starter.cancellations() != test.wantCancellationCalls {
				t.Fatalf("cancellation calls = %d, want %d", starter.cancellations(), test.wantCancellationCalls)
			}
			run, err := store.GetRun(context.Background(), intent.RunID)
			if err != nil || run.Status != execution.DurableRunStatusRunning {
				t.Fatalf("completed Temporal workflow was projected as cancellation: run=%#v err=%v", run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, now)

			finalizationRef := temporalProjectionRef(intent.RunID, "finalization/write")
			storeFinalizationCompletionProofForTest(
				t,
				store,
				intent.RunID,
				finalizationRef,
				now.Add(4*time.Second),
			)
			completed, err := store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
				FinalResponseRef: finalizationRef,
				Now:              now.Add(4 * time.Second),
				RunID:            intent.RunID,
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
		status enumspb.WorkflowExecutionStatus
	}{
		{name: "failed", status: enumspb.WORKFLOW_EXECUTION_STATUS_FAILED},
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
			command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RunID, now, "cancel-terminal-"+strings.ReplaceAll(test.name, " ", "-"))
			info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-"+strings.ReplaceAll(test.name, " ", "-"))
			info.Status = test.status
			starter := &reconcilerStarterForTest{describe: info}
			server := &Server{
				config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store,
				temporalStarter: starter, executionInputLoader: noOpExecutionInputLoader{},
				productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
			}

			(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)

			if starter.cancellations() != 0 {
				t.Fatalf("closed status %s delivered %d cancellation calls", test.status, starter.cancellations())
			}
			run, err := store.GetRun(context.Background(), intent.RunID)
			if err != nil || run.Status != execution.DurableRunStatusCreated {
				t.Fatalf("closed status %s synthesized cancellation: run=%#v err=%v", test.status, run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, now)
		})
	}
}

func TestTemporalReconcilerProjectsTerminatedWorkflowAfterCancellationRequest(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-terminated-after-cancel")
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		store,
		intent.RunID,
		now,
		"cancel-terminal-terminated",
	)
	closedAt := now.Add(2 * time.Second)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-terminated-after-cancel")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED
	info.CloseTime = closedAt
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config:               config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "cancellation-termination-reconciler"},
		runProjectionStore:   store,
		temporalStarter:      starter,
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			return nil
		},
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)

	if starter.cancellations() != 0 {
		t.Fatalf("terminated workflow delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.FailCloseReason != workflowExecutionTerminatedFailure || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("terminated run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, now)
}

func TestTemporalReconcilerProjectsTimedOutWorkflowAfterCancellationRequest(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-timed-out")
	command := requestAndLeaseReconcilerCancellationForTest(t, store, intent.RunID, now, "cancel-terminal-timed-out")
	closedAt := now.Add(2 * time.Second)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timed-out")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT
	info.CloseTime = closedAt
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "cancellation-timeout-reconciler"},
		runProjectionStore: store, temporalStarter: starter, executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)

	if starter.cancellations() != 0 {
		t.Fatalf("timed-out workflow delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusExpired || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("timed-out run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, now)
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
		RunID: intent.RunID, Reason: "user_requested", Now: cancelRequestedAt,
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
	recoveredRun.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	starter := &reconcilerStarterForTest{
		startRunID:     recoveredRun.RunID,
		describe:       recoveredRun,
		describeSeries: []temporalruntime.WorkflowExecutionInfo{{Found: false}},
	}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}
	reconciler := &temporalReconciler{server: server}
	reconciler.reconcileCancellationCommand(context.Background(), store, commands[0])

	if starter.calls() != 0 || starter.recoveryCalls() != 1 {
		t.Fatalf("workflow starts = ordinary:%d recovery:%d, want 0/1", starter.calls(), starter.recoveryCalls())
	}
	if starter.cancellations() != 1 {
		t.Fatalf("recovered start cancellation calls = %d, want 1", starter.cancellations())
	}
	target := starter.cancellationInput()
	if target.WorkflowID != intent.WorkflowID || target.RunID != intent.RunID ||
		target.TemporalRunID != recoveredRun.RunID {
		t.Fatalf("recovered cancellation target = %#v", target)
	}
	boundStart, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
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
	wantDescribed := []string{"", recoveredRun.RunID, "", ""}
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
		RunID: intent.RunID, Reason: "user_requested", Now: cancelRequestedAt,
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
	starter := &reconcilerStarterForTest{describe: temporalruntime.WorkflowExecutionInfo{Found: false}}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store,
		temporalStarter: starter, executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 0 {
		t.Fatalf("undispatched start delivered %d cancellation calls", starter.cancellations())
	}
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("undispatched cancellation run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, cancelRequestedAt)
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
		RunID: intent.RunID, Reason: "user_requested", Now: cancelRequestedAt,
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
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 0 {
		t.Fatalf("binding failure delivered %d cancellation calls", starter.cancellations())
	}
	start, err := base.GetWorkflowStartIntent(context.Background(), intent.RunID)
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
		intent.RunID,
		now,
		"cancel-stale-worker",
	)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cancel-stale-worker")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	starter := &reconcilerStarterForTest{describe: info}
	store := &terminalOnCancellationRecheckStore{RunProjectionStore: base}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)

	if store.reads != 2 {
		t.Fatalf("durable run reads = %d, want initial and pre-RPC recheck", store.reads)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("stale cancellation worker sent %d external RPCs", starter.cancellations())
	}
	assertReconcilerCancellationConfirmedForTest(t, base, intent.RunID, now)
}

func TestTemporalCancellationReadFailureCannotSendUsingStaleState(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	if _, err := base.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RunID: intent.RunID, Reason: "user_requested", Now: now,
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
	store := failingGetRunProjectionStore{RunProjectionStore: base, err: errors.New("projection read unavailable")}
	server := &Server{config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter}
	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 0 {
		t.Fatalf("cancellation calls after GetRun failure = %d", starter.cancellations())
	}
}
