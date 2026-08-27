package httpapi

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	"strings"
	"testing"
	"time"
)

func TestTemporalReconcilerLeavesUnknownAlreadyStartedIdentityRetryable(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{
		startErr: temporalruntime.ErrWorkflowIdentityUnknown,
	}
	server := &Server{config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter}
	server.ReconcileTemporalRunsOnce(context.Background())
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
		startErr: fmt.Errorf("%w: conflicting workflow memo", temporalruntime.ErrWorkflowIdentityConflict),
	}
	server := &Server{
		config:               config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore:   store,
		temporalStarter:      starter,
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(
			context.Context,
			execution.DurableRun,
			time.Time,
			map[string]any,
		) error {
			return nil
		},
	}

	(&temporalReconciler{server: server}).reconcileStartIntent(context.Background(), store, leased[0])
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

func TestTemporalReconcilerFailClosesUnauthorizedSuccessor(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	callbackCalls := 0
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-timeout-chain-first")
	exact := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timeout-chain-first")
	exact.FirstRunID = "temporal-timeout-chain-first"
	exact.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT
	exact.CloseTime = now
	latest := exact
	latest.RunID = "temporal-timeout-reset-latest"
	latest.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	latest.CloseTime = time.Time{}
	starter := &reconcilerStarterForTest{
		describe:       latest,
		describeSeries: []temporalruntime.WorkflowExecutionInfo{exact, latest},
	}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-chain-reconciler"},
		runProjectionStore: store, temporalStarter: starter,
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			callbackCalls++
			return nil
		},
	}

	(&temporalReconciler{server: server}).reconcileWorkflowTimeouts(context.Background())
	failed, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || failed.Status != execution.DurableRunStatusFailed ||
		failed.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		failed.FailCloseReason != workflowUnauthorizedSuccessorFailure || callbackCalls != 1 {
		t.Fatalf("unauthorized successor run = %#v, callbacks=%d, err=%v", failed, callbackCalls, err)
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 3 ||
		described[0] != "temporal-timeout-chain-first" || described[1] != "" || described[2] != "" {
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

func TestTemporalReconcilerFailClosesResetSuccessorWithoutFollowingIt(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-timeout-reset-root")
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timeout-reset-root")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT
	info.CloseTime = now
	info.LastResetTime = now.Add(-time.Second)
	info.ResetRunID = "temporal-timeout-reset-successor"
	latest := info
	latest.RunID = info.ResetRunID
	latest.FirstRunID = info.RunID
	latest.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	latest.CloseTime = time.Time{}
	callbackCalls := 0
	starter := &reconcilerStarterForTest{
		describe:       latest,
		describeSeries: []temporalruntime.WorkflowExecutionInfo{info, latest},
	}
	server := &Server{
		config: config.Config{
			TemporalStartTimeoutMS: 1000,
			TemporalWorkerIdentity: "timeout-reset-reconciler",
		},
		runProjectionStore:   store,
		temporalStarter:      starter,
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			callbackCalls++
			return nil
		},
	}

	(&temporalReconciler{server: server}).reconcileWorkflowTimeouts(context.Background())
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowUnauthorizedSuccessorFailure || callbackCalls != 1 {
		t.Fatalf("reset-marked successor run = %#v, callbacks=%d, err=%v", run, callbackCalls, err)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("reset successor received %d cancellation calls", starter.cancellations())
	}
}

func TestTemporalReconcilerDoesNotBindRecoveryStartWithSuccessor(t *testing.T) {
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
	root.Status = enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW
	root.CloseTime = intent.CreatedAt.Add(2 * time.Second)
	successor := root
	successor.RunID = "temporal-recovery-successor"
	successor.FirstRunID = root.RunID
	successor.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	successor.CloseTime = time.Time{}
	starter := &reconcilerStarterForTest{
		startRunID: root.RunID,
		describe:   successor,
		describeSeries: []temporalruntime.WorkflowExecutionInfo{
			{Found: false},
			root,
			successor,
		},
	}
	server := &Server{
		config:               config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore:   store,
		temporalStarter:      starter,
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			return nil
		},
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)

	if starter.recoveryCalls() != 1 || starter.cancellations() != 0 {
		t.Fatalf("successor recovery calls = starts:%d cancels:%d", starter.recoveryCalls(), starter.cancellations())
	}
	start, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || start.TemporalRunID != "" {
		t.Fatalf("successor recovery was bound: start=%#v err=%v", start, err)
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowUnauthorizedSuccessorFailure {
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
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	info.ResetRunID = "temporal-reset-successor"
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)
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
		mutate    func(*temporalruntime.WorkflowExecutionInfo)
		wantRun   execution.DurableRunStatus
		wantRetry bool
	}{
		{
			name: "unknown", wantRun: execution.DurableRunStatusCreated, wantRetry: true,
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
				info.IdentityState = temporalruntime.WorkflowIdentityUnknown
				info.Identity = temporalruntime.ToolExecutionWorkflowIdentity{}
			},
		},
		{
			name: "conflict", wantRun: execution.DurableRunStatusCanceled,
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
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
			info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
			test.mutate(&info)
			starter := &reconcilerStarterForTest{describe: info}
			server := &Server{
				config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store,
				temporalStarter: starter, executionInputLoader: noOpExecutionInputLoader{},
				productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error { return nil },
			}
			(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, commands[0])
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
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, commands[0])
	if starter.cancellations() != 1 {
		t.Fatalf("cancellation calls = %d, want 1", starter.cancellations())
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 2 ||
		described[0] != "temporal-run-owned" || described[1] != "" {
		t.Fatalf("cancellation describe Temporal run ids = %#v", described)
	}
	target := starter.cancellationInput()
	if target.WorkflowID != intent.WorkflowID || target.TemporalRunID != "temporal-run-owned" ||
		target.RequestID != intent.RequestID {
		t.Fatalf("cancellation target = %#v", target)
	}
}

func TestTemporalReconcilerRejectsResetEvidenceForCancellation(t *testing.T) {
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
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	info.ResetRunID = "temporal-cancel-reset-successor"
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}

	(&temporalReconciler{server: server}).reconcileCancellationCommand(context.Background(), store, command)
	if starter.cancellations() != 0 {
		t.Fatalf("reset-marked execution received %d cancellation calls", starter.cancellations())
	}
	retried, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-reset-marked-retry", Now: lifecycleNow().Add(time.Minute),
		LeaseUntil: lifecycleNow().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(retried) != 1 || retried[0].LastErrorCode != "temporal_cancel_identity_unavailable" {
		t.Fatalf("reset-marked cancellation retry = %#v, err=%v", retried, err)
	}
}

func TestTemporalReconcilerFailClosesDifferentLatestRunWithoutCancelingSuccessor(t *testing.T) {
	for _, test := range []struct {
		name        string
		exactStatus enumspb.WorkflowExecutionStatus
	}{
		{
			name: "continue as new", exactStatus: enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW,
		},
		{
			name: "reset can preserve first run id", exactStatus: enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED,
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
			latest.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
			latest.CloseTime = time.Time{}
			starter := &reconcilerStarterForTest{
				describe:       latest,
				describeSeries: []temporalruntime.WorkflowExecutionInfo{exact, latest},
			}
			server := &Server{
				config:               config.Config{TemporalStartTimeoutMS: 1000},
				runProjectionStore:   store,
				temporalStarter:      starter,
				executionInputLoader: noOpExecutionInputLoader{},
				productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
					return nil
				},
			}

			(&temporalReconciler{server: server}).reconcileCancellationCommand(
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
				run.FailCloseReason != workflowUnauthorizedSuccessorFailure {
				t.Fatalf("successor cancellation product run = %#v, err=%v", run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RequestID, now)
			if described := starter.describedTemporalRunIDs(); len(described) != 3 ||
				described[0] != exact.RunID || described[1] != "" || described[2] != "" {
				t.Fatalf("continuation cancellation describes = %#v", described)
			}
		})
	}
}
