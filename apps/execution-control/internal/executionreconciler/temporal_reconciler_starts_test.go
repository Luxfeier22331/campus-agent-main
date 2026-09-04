package executionreconciler

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"testing"
	"time"
)

func TestTemporalReconcilerConfirmsStartAndQueuesRunAtomically(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{describe: reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-reconciler-test")}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileOnce(context.Background())
	if starter.calls() != 1 {
		t.Fatalf("start calls = %d, want 1", starter.calls())
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run status = %q, want queued", run.Status)
	}
	events, err := store.ListRunEvents(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[1].EventType != execution.DurableRunEventTypeWorkflowStarted ||
		events[2].EventType != execution.DurableRunEventTypeRunQueued {
		t.Fatalf("events = %#v", events)
	}
}

func TestTemporalReconcilerDoesNotConfirmStartWithoutWorkflowIdentityControl(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	delegate := &reconcilerStarterForTest{}
	starter := &reconcilerStarterWithoutControlForTest{delegate: delegate}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileOnce(context.Background())
	if delegate.calls() != 1 {
		t.Fatalf("start calls = %d, want 1", delegate.calls())
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("unverified start changed run = %#v", run)
	}
	retry, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if retry.State != execution.LifecycleIntentStatePending ||
		retry.LastErrorCode != "temporal_start_identity_unavailable" || retry.TemporalRunID != "" {
		t.Fatalf("unverified start intent = %#v", retry)
	}
}

func TestTemporalReconcilerCancelsOnlyIdentityVerifiedLateStartAfterSupersession(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	starter := &reconcilerStarterForTest{describe: reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-late-start")}
	starter.onStart = func() {
		current, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
		if err != nil || !current.DispatchAttempted {
			t.Errorf("workflow start RPC ran without durable dispatch fence: intent=%#v err=%v", current, err)
			return
		}
		if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
			RequestID: intent.RequestID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("request racing cancellation: %v", err)
			return
		}
		commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
			LeaseToken: "cancel-before-start-confirm", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
		})
		if err != nil || len(commands) != 1 {
			t.Errorf("lease racing cancellation = %#v, err=%v", commands, err)
			return
		}
		if _, err := store.CancelRunProjection(context.Background(), execution.DurableRunCancelRequest{
			RequestID: intent.RequestID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("project racing cancellation: %v", err)
			return
		}
		if err := store.ConfirmRunCancellationCommand(context.Background(), execution.RunCancellationCommandResult{
			RequestID: intent.RequestID, LeaseToken: commands[0].LeaseToken, Now: now,
		}); err != nil {
			t.Errorf("confirm racing cancellation: %v", err)
		}
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileOnce(context.Background())
	if starter.cancellations() != 1 {
		t.Fatalf("late start cancellation calls = %d, want 1", starter.cancellations())
	}
	if got := starter.cancellationInput().TemporalRunID; got != "temporal-run-late-start" {
		t.Fatalf("late start cancellation Temporal run id = %q", got)
	}
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-after-late-start", Now: now.Add(time.Second), LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 || commands[0].LastErrorCode != "late_workflow_start" {
		t.Fatalf("requeued late-start cancellation = %#v, err=%v", commands, err)
	}
}

func TestTemporalReconcilerLateStartCompensationRechecksTerminalWinnerBeforeExternalRPC(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	starter := &reconcilerStarterForTest{
		describe: reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-late-terminal-winner"),
	}
	starter.onStart = func() {
		if _, err := base.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
			RequestID: intent.RequestID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("request racing cancellation: %v", err)
		}
	}
	store := &terminalOnCancellationRecheckStore{RunProjectionStore: base}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileStarts(context.Background())

	if store.reads != 2 {
		t.Fatalf("durable run reads = %d, want initial and late-start pre-cancel recheck", store.reads)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("late start compensation sent %d external RPCs after terminal winner", starter.cancellations())
	}
	bound, err := base.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || bound.TemporalRunID != "temporal-run-late-terminal-winner" {
		t.Fatalf("late start binding = %#v, err=%v", bound, err)
	}
}

func TestTemporalReconcilerLateStartCompensationReadFailureKeepsCancellationRetryable(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	starter := &reconcilerStarterForTest{
		describe: reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-late-read-failure"),
	}
	starter.onStart = func() {
		if _, err := base.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
			RequestID: intent.RequestID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("request racing cancellation: %v", err)
		}
	}
	store := &failingAfterFirstGetRunProjectionStore{
		RunProjectionStore: base,
		err:                errors.New("late start projection unavailable"),
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileStarts(context.Background())

	if store.reads != 2 {
		t.Fatalf("durable run reads = %d, want initial and late-start pre-cancel recheck", store.reads)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("late start compensation sent %d external RPCs after read failure", starter.cancellations())
	}
	commands, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "late-start-read-retry", Now: now.Add(time.Second), LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 || commands[0].RequestID != intent.RequestID {
		t.Fatalf("retryable late-start cancellation = %#v, err=%v", commands, err)
	}
}

func TestTemporalReconcilerMarksLocalStartValidationFailureAsNotDispatched(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-not-dispatched", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease = %#v, err=%v", leased, err)
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	reconciler := newReconcilerForTest(config.Config{TemporalWorkerIdentity: "start-validation-test"}, store, nil, nil)
	reconciler.PermanentlyFailStartIntent(
		context.Background(),
		store,
		leased[0],
		run,
		workflowStartNotDispatchedFailure,
		errors.New("workflow input is invalid"),
	)

	failedRun, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || failedRun.Status != execution.DurableRunStatusFailed ||
		failedRun.FailCloseReason != workflowStartNotDispatchedFailure {
		t.Fatalf("local validation failure run = %#v, err=%v", failedRun, err)
	}
	failedIntent, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || failedIntent.State != execution.LifecycleIntentStatePermanentFailed ||
		failedIntent.LastErrorCode != workflowStartNotDispatchedFailure {
		t.Fatalf("local validation failure intent = %#v, err=%v", failedIntent, err)
	}
}

func TestTemporalReconcilerRetainsPayloadAfterPostDispatchValidationFailure(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-post-dispatch-invalid", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, store, leased[0], intent.CreatedAt)
	leased[0].DispatchAttempted = true
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	reconciler := newReconcilerForTest(config.Config{TemporalWorkerIdentity: "post-dispatch-validation-test"}, store, nil, nil)
	failureKind := WorkflowStartValidationFailure(leased[0])
	if failureKind != workflowStartPostDispatchFailure {
		t.Fatalf("post-dispatch failure kind = %q", failureKind)
	}
	reconciler.PermanentlyFailStartIntent(
		context.Background(),
		store,
		leased[0],
		run,
		failureKind,
		errors.New("workflow input became invalid after an ambiguous dispatch"),
	)
	failedRun, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || failedRun.Status != execution.DurableRunStatusFailed ||
		failedRun.FailCloseReason != workflowStartPostDispatchFailure {
		t.Fatalf("post-dispatch validation failure run = %#v, err=%v", failedRun, err)
	}
	failedIntent, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || !failedIntent.DispatchAttempted ||
		failedIntent.LastErrorCode != workflowStartPostDispatchFailure {
		t.Fatalf("post-dispatch validation failure intent = %#v, err=%v", failedIntent, err)
	}
}

func TestTemporalReconcilerRecoversNotDispatchedStartRetirementAfterLeaseExpiry(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	store := &failWorkflowStartIntentOnceStore{InMemoryRunProjectionStore: base}
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-retirement-first", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("first lease = %#v, err=%v", leased, err)
	}
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	reconciler := newReconcilerForTest(config.Config{TemporalWorkerIdentity: "start-retirement-test"}, store, nil, nil)
	reconciler.PermanentlyFailStartIntent(
		context.Background(),
		store,
		leased[0],
		run,
		workflowStartNotDispatchedFailure,
		errors.New("workflow input is invalid"),
	)
	failedRun, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil || failedRun.Status != execution.DurableRunStatusFailed ||
		failedRun.FailCloseReason != workflowStartNotDispatchedFailure {
		t.Fatalf("failed run before retirement recovery = %#v, err=%v", failedRun, err)
	}

	recovered, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-retirement-recovered", Now: time.Now().UTC().Add(time.Minute),
		LeaseUntil: time.Now().UTC().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(recovered) != 1 {
		t.Fatalf("recovered lease = %#v, err=%v", recovered, err)
	}
	reconciler.ReconcileStartIntent(context.Background(), store, recovered[0])
	retired, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || retired.State != execution.LifecycleIntentStatePermanentFailed ||
		retired.LastErrorCode != workflowStartNotDispatchedFailure {
		t.Fatalf("recovered start retirement = %#v, err=%v", retired, err)
	}
}

func TestTemporalReconcilerRetriesUncertainStartWithoutQueueing(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{startErr: errors.New("transport unavailable")}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileOnce(context.Background())
	run, err := store.GetRun(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("uncertain start changed run status to %q", run.Status)
	}
	recovered, err := store.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.State != execution.LifecycleIntentStatePending || recovered.LastErrorCode != "temporal_workflow_start_uncertain" {
		t.Fatalf("recovered intent = %#v", recovered)
	}
}

func TestTemporalReconcilerRunReadFailureCannotStartWorkflow(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	leased, err := base.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-read-failure",
		Now:        intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease = %#v, err=%v", leased, err)
	}
	starter := &reconcilerStarterForTest{}
	store := failingGetRunProjectionStore{
		RunProjectionStore: base,
		err:                errors.New("projection read unavailable"),
	}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileStartIntent(context.Background(), store, leased[0])
	if starter.calls() != 0 {
		t.Fatalf("start calls after GetRun failure = %d", starter.calls())
	}
	if starter.cancellations() != 0 {
		t.Fatalf("cancellation calls after GetRun failure = %d", starter.cancellations())
	}
	retry, err := base.GetWorkflowStartIntent(context.Background(), intent.RequestID)
	if err != nil || retry.State != execution.LifecycleIntentStatePending || retry.LastErrorCode != "run_unavailable" {
		t.Fatalf("retried intent = %#v, err=%v", retry, err)
	}
}

func TestTemporalReconcilerDoesNotStartSupersededLease(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-lease",
		Now:        intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease = %#v, err=%v", leased, err)
	}
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: intent.RequestID, Reason: "user_requested", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	starter := &reconcilerStarterForTest{}
	reconciler := newReconcilerForTest(config.Config{TemporalStartTimeoutMS: 1000}, store, starter, nil)
	reconciler.ReconcileStartIntent(context.Background(), store, leased[0])
	if starter.calls() != 0 {
		t.Fatalf("superseded lease invoked Temporal start %d times", starter.calls())
	}
}

func TestDecodeWorkflowStartInputAllowsToolBudgetIndependentOfVisibility(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	run, err := store.GetRun(t.Context(), intent.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	var input execution.WorkflowStartInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		t.Fatal(err)
	}
	input.AdmissionSnapshot.ExecutionStrategy.VisibleFunctionToolNames = []string{campusSearchToolName, personalMemoryRecallToolName}
	input.AdmissionSnapshot.ExecutionStrategySHA256 = execution.HashAdmissionJSON(
		input.AdmissionSnapshot.ExecutionStrategy,
	)
	input.AdmissionSnapshotSHA256 = execution.SHA256JSONRef(input.AdmissionSnapshot)
	intent.WorkflowInputJSON, err = json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := execution.DecodeAndValidateWorkflowStartInput(intent, run); err != nil {
		t.Fatalf("decode strategy with independent tool budget: %v", err)
	}
}
