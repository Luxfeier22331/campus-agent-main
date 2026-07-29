package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
)

type reconcilerStarterForTest struct {
	mu             sync.Mutex
	startCalls     int
	recoveryStarts int
	startRunID     string
	startErr       error
	recoveryInput  temporalruntime.ToolExecutionWorkflowInput
	cancelErr      error
	describe       temporalruntime.WorkflowExecutionInfo
	describeSeries []temporalruntime.WorkflowExecutionInfo
	describeErr    error
	describeRunIDs []string
	cancelCalls    int
	cancelInput    temporalruntime.ToolExecutionWorkflowCancelInput
	onStart        func()
}

// reconcilerStarterWithoutControlForTest models a command client that can
// start workflows but cannot bind a successful RPC to a concrete execution.
type reconcilerStarterWithoutControlForTest struct {
	delegate *reconcilerStarterForTest
}

type failingWorkflowStartExecutionBindingStore struct {
	*execution.InMemoryRunProjectionStore
	err error
}

func (s *failingWorkflowStartExecutionBindingStore) BindSupersededWorkflowStartExecution(
	context.Context,
	execution.WorkflowStartExecutionBinding,
) (execution.WorkflowStartIntent, error) {
	return execution.WorkflowStartIntent{}, s.err
}

func (f *reconcilerStarterWithoutControlForTest) StartToolExecutionWorkflow(
	ctx context.Context,
	input temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	return f.delegate.StartToolExecutionWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) StartPersonalMemoryCommandWorkflow(
	ctx context.Context,
	input temporalruntime.PersonalMemoryCommandWorkflowInput,
) error {
	return f.delegate.StartPersonalMemoryCommandWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) CancelToolExecutionWorkflow(
	ctx context.Context,
	input temporalruntime.ToolExecutionWorkflowCancelInput,
) error {
	return f.delegate.CancelToolExecutionWorkflow(ctx, input)
}

func (f *reconcilerStarterWithoutControlForTest) CheckReadiness(
	ctx context.Context,
) temporalruntime.RuntimeReadiness {
	return f.delegate.CheckReadiness(ctx)
}

func (f *reconcilerStarterForTest) StartToolExecutionWorkflow(
	context.Context,
	temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	f.mu.Lock()
	f.startCalls++
	temporalRunID := f.startRunID
	if temporalRunID == "" {
		temporalRunID = f.describe.RunID
	}
	err := f.startErr
	onStart := f.onStart
	f.mu.Unlock()
	if onStart != nil {
		onStart()
	}
	return temporalRunID, err
}

func (f *reconcilerStarterForTest) EnsureToolExecutionWorkflowForCancellation(
	_ context.Context,
	input temporalruntime.ToolExecutionWorkflowInput,
) (string, error) {
	f.mu.Lock()
	f.recoveryStarts++
	f.recoveryInput = input
	temporalRunID := f.startRunID
	if temporalRunID == "" {
		temporalRunID = f.describe.RunID
	}
	err := f.startErr
	onStart := f.onStart
	f.mu.Unlock()
	if onStart != nil {
		onStart()
	}
	return temporalRunID, err
}

func (f *reconcilerStarterForTest) StartPersonalMemoryCommandWorkflow(
	context.Context,
	temporalruntime.PersonalMemoryCommandWorkflowInput,
) error {
	return nil
}

func (f *reconcilerStarterForTest) CancelToolExecutionWorkflow(
	_ context.Context,
	input temporalruntime.ToolExecutionWorkflowCancelInput,
) error {
	f.mu.Lock()
	f.cancelCalls++
	f.cancelInput = input
	f.mu.Unlock()
	return f.cancelErr
}

func (f *reconcilerStarterForTest) CheckReadiness(context.Context) temporalruntime.RuntimeReadiness {
	return temporalruntime.RuntimeReadiness{Healthy: true}
}

func (f *reconcilerStarterForTest) DescribeToolExecutionWorkflow(
	_ context.Context,
	_ string,
	temporalRunID string,
) (temporalruntime.WorkflowExecutionInfo, error) {
	f.mu.Lock()
	describeIndex := len(f.describeRunIDs)
	f.describeRunIDs = append(f.describeRunIDs, temporalRunID)
	info := f.describe
	if describeIndex < len(f.describeSeries) {
		info = f.describeSeries[describeIndex]
	}
	err := f.describeErr
	f.mu.Unlock()
	return info, err
}

func (f *reconcilerStarterForTest) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.startCalls
}

func (f *reconcilerStarterForTest) cancellations() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cancelCalls
}

func (f *reconcilerStarterForTest) recoveryCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recoveryStarts
}

func (f *reconcilerStarterForTest) cancellationRecoveryInput() temporalruntime.ToolExecutionWorkflowInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recoveryInput
}

func (f *reconcilerStarterForTest) cancellationInput() temporalruntime.ToolExecutionWorkflowCancelInput {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cancelInput
}

func (f *reconcilerStarterForTest) describedTemporalRunIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.describeRunIDs...)
}

func TestTemporalReconcilerConfirmsStartAndQueuesRunAtomically(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{describe: reconcilerWorkflowInfoForIntent(t, intent, "temporal-run-reconciler-test")}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}

	server.ReconcileTemporalRunsOnce(context.Background())
	if starter.calls() != 1 {
		t.Fatalf("start calls = %d, want 1", starter.calls())
	}
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run status = %q, want queued", run.Status)
	}
	events, err := store.ListRunEvents(context.Background(), intent.RunID)
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
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}

	server.ReconcileTemporalRunsOnce(context.Background())
	if delegate.calls() != 1 {
		t.Fatalf("start calls = %d, want 1", delegate.calls())
	}
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("unverified start changed run = %#v", run)
	}
	retry, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
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
		current, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
		if err != nil || !current.DispatchAttempted {
			t.Errorf("workflow start RPC ran without durable dispatch fence: intent=%#v err=%v", current, err)
			return
		}
		if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
			RunID: intent.RunID, Reason: "user_requested", Now: now,
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
			RunID: intent.RunID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("project racing cancellation: %v", err)
			return
		}
		if err := store.ConfirmRunCancellationCommand(context.Background(), execution.RunCancellationCommandResult{
			RunID: intent.RunID, LeaseToken: commands[0].LeaseToken, Now: now,
		}); err != nil {
			t.Errorf("confirm racing cancellation: %v", err)
		}
	}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}
	server.ReconcileTemporalRunsOnce(context.Background())
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
			RunID: intent.RunID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("request racing cancellation: %v", err)
		}
	}
	store := &terminalOnCancellationRecheckStore{RunProjectionStore: base}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}

	(&temporalReconciler{server: server}).reconcileStarts(context.Background())

	if store.reads != 2 {
		t.Fatalf("durable run reads = %d, want initial and late-start pre-cancel recheck", store.reads)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("late start compensation sent %d external RPCs after terminal winner", starter.cancellations())
	}
	bound, err := base.GetWorkflowStartIntent(context.Background(), intent.RunID)
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
			RunID: intent.RunID, Reason: "user_requested", Now: now,
		}); err != nil {
			t.Errorf("request racing cancellation: %v", err)
		}
	}
	store := &failingAfterFirstGetRunProjectionStore{
		RunProjectionStore: base,
		err:                errors.New("late start projection unavailable"),
	}
	server := &Server{
		config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter,
	}

	(&temporalReconciler{server: server}).reconcileStarts(context.Background())

	if store.reads != 2 {
		t.Fatalf("durable run reads = %d, want initial and late-start pre-cancel recheck", store.reads)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("late start compensation sent %d external RPCs after read failure", starter.cancellations())
	}
	commands, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "late-start-read-retry", Now: now.Add(time.Second), LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 || commands[0].RunID != intent.RunID {
		t.Fatalf("retryable late-start cancellation = %#v, err=%v", commands, err)
	}
}

func TestTemporalReconcilerLeavesUnknownAlreadyStartedIdentityRetryable(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{
		startErr: temporalruntime.ErrWorkflowIdentityUnknown,
	}
	server := &Server{config: config.Config{TemporalStartTimeoutMS: 1000}, runProjectionStore: store, temporalStarter: starter}
	server.ReconcileTemporalRunsOnce(context.Background())
	run, err := store.GetRun(context.Background(), intent.RunID)
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
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("identity conflict run = %#v, err=%v", run, err)
	}
	failedIntent, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || failedIntent.State != execution.LifecycleIntentStatePermanentFailed ||
		failedIntent.LastErrorCode != workflowStartRemoteConflictFailure {
		t.Fatalf("identity conflict intent = %#v, err=%v", failedIntent, err)
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "remote-conflict-cleanup", Now: time.Now().UTC().Add(time.Minute),
		LeaseUntil: time.Now().UTC().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(cleanups) != 0 {
		t.Fatalf("remote identity conflict cleanup = %#v, err=%v", cleanups, err)
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
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		config:               config.Config{TemporalWorkerIdentity: "start-validation-test"},
		executionInputLoader: noOpExecutionInputLoader{},
		runProjectionStore:   store,
		productFinalizationWriter: func(
			context.Context,
			execution.DurableRun,
			time.Time,
			map[string]any,
		) error {
			return nil
		},
	}
	(&temporalReconciler{server: server}).permanentlyFailStartIntent(
		context.Background(),
		store,
		leased[0],
		run,
		workflowStartNotDispatchedFailure,
		errors.New("workflow input is invalid"),
	)

	failedRun, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || failedRun.Status != execution.DurableRunStatusFailed ||
		failedRun.FailCloseReason != workflowStartNotDispatchedFailure {
		t.Fatalf("local validation failure run = %#v, err=%v", failedRun, err)
	}
	failedIntent, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || failedIntent.State != execution.LifecycleIntentStatePermanentFailed ||
		failedIntent.LastErrorCode != workflowStartNotDispatchedFailure {
		t.Fatalf("local validation failure intent = %#v, err=%v", failedIntent, err)
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "local-validation-cleanup", Now: time.Now().UTC().Add(time.Minute),
		LeaseUntil: time.Now().UTC().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(cleanups) != 1 {
		t.Fatalf("not-dispatched cleanup = %#v, err=%v", cleanups, err)
	}
	(&temporalReconciler{server: server}).reconcileRunCleanup(context.Background(), store, cleanups[0])
	cleanup, err := store.GetRunCleanup(context.Background(), intent.RunID)
	if err != nil || cleanup.State != execution.LifecycleIntentStateConfirmed {
		t.Fatalf("not-dispatched cleanup confirmation = %#v, err=%v", cleanup, err)
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
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		config:             config.Config{TemporalWorkerIdentity: "post-dispatch-validation-test"},
		runProjectionStore: store,
		productFinalizationWriter: func(
			context.Context,
			execution.DurableRun,
			time.Time,
			map[string]any,
		) error {
			return nil
		},
	}
	failureKind := workflowStartValidationFailure(leased[0])
	if failureKind != workflowStartPostDispatchFailure {
		t.Fatalf("post-dispatch failure kind = %q", failureKind)
	}
	(&temporalReconciler{server: server}).permanentlyFailStartIntent(
		context.Background(),
		store,
		leased[0],
		run,
		failureKind,
		errors.New("workflow input became invalid after an ambiguous dispatch"),
	)
	failedRun, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || failedRun.Status != execution.DurableRunStatusFailed ||
		failedRun.FailCloseReason != workflowStartPostDispatchFailure {
		t.Fatalf("post-dispatch validation failure run = %#v, err=%v", failedRun, err)
	}
	failedIntent, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || !failedIntent.DispatchAttempted ||
		failedIntent.LastErrorCode != workflowStartPostDispatchFailure {
		t.Fatalf("post-dispatch validation failure intent = %#v, err=%v", failedIntent, err)
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "post-dispatch-cleanup", Now: time.Now().UTC().Add(time.Minute),
		LeaseUntil: time.Now().UTC().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(cleanups) != 0 {
		t.Fatalf("post-dispatch cleanup = %#v, err=%v", cleanups, err)
	}
}

type failWorkflowStartIntentOnceStore struct {
	*execution.InMemoryRunProjectionStore
	failed bool
}

func (s *failWorkflowStartIntentOnceStore) FailWorkflowStartIntent(
	ctx context.Context,
	result execution.WorkflowStartIntentResult,
) error {
	if !s.failed {
		s.failed = true
		return errors.New("workflow start retirement unavailable")
	}
	return s.InMemoryRunProjectionStore.FailWorkflowStartIntent(ctx, result)
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
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{
		config:             config.Config{TemporalWorkerIdentity: "start-retirement-test"},
		runProjectionStore: store,
		productFinalizationWriter: func(
			context.Context,
			execution.DurableRun,
			time.Time,
			map[string]any,
		) error {
			return nil
		},
	}
	reconciler := &temporalReconciler{server: server}
	reconciler.permanentlyFailStartIntent(
		context.Background(),
		store,
		leased[0],
		run,
		workflowStartNotDispatchedFailure,
		errors.New("workflow input is invalid"),
	)
	failedRun, err := store.GetRun(context.Background(), intent.RunID)
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
	reconciler.reconcileStartIntent(context.Background(), store, recovered[0])
	retired, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || retired.State != execution.LifecycleIntentStatePermanentFailed ||
		retired.LastErrorCode != workflowStartNotDispatchedFailure {
		t.Fatalf("recovered start retirement = %#v, err=%v", retired, err)
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cleanup-after-recovered-retirement", Now: time.Now().UTC().Add(3 * time.Minute),
		LeaseUntil: time.Now().UTC().Add(4 * time.Minute), Limit: 1,
	})
	if err != nil || len(cleanups) != 1 {
		t.Fatalf("cleanup after recovered retirement = %#v, err=%v", cleanups, err)
	}
}

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
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken, TemporalRunID: "temporal-timeout", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	closedAt := time.Date(2026, 7, 23, 9, 10, 11, 123456000, time.UTC)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-timeout")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT
	info.CloseTime = closedAt
	callbackCalls := 0
	server := &Server{
		config:               config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-reconciler"},
		runProjectionStore:   store,
		temporalStarter:      &reconcilerStarterForTest{describe: info},
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(_ context.Context, _ execution.DurableRun, completedAt time.Time, response map[string]any) error {
			callbackCalls++
			if !completedAt.Equal(closedAt) || stringValue(response["status"]) != "error" {
				t.Errorf("timeout callback completed_at=%s response=%#v", completedAt, response)
			}
			if callbackCalls == 1 {
				return errors.New("callback unavailable")
			}
			return nil
		},
	}
	reconciler := &temporalReconciler{server: server}
	reconciler.reconcileWorkflowTimeouts(context.Background())
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run became terminal before callback succeeded: %#v err=%v", run, err)
	}
	for _, event := range mustListRunEvents(t, store, intent.RunID) {
		if event.EventType == execution.DurableRunEventTypeRunExpired {
			t.Fatal("run.expired published before callback succeeded")
		}
	}
	reconciler.reconcileWorkflowTimeouts(context.Background())
	run, err = store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusExpired ||
		run.TerminalReason != execution.DurableTerminalReasonRunTimeout || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("expired run = %#v err=%v", run, err)
	}
	events := mustListRunEvents(t, store, intent.RunID)
	if events[len(events)-1].EventType != execution.DurableRunEventTypeRunExpired {
		t.Fatalf("terminal event = %#v", events[len(events)-1])
	}
	attempts, err := store.ListStepAttempts(context.Background(), intent.RunID)
	if err != nil || len(attempts) != 1 || attempts[0].TimeoutOutcome != execution.TimeoutOutcomeWorkflowTimeout {
		t.Fatalf("timeout attempts = %#v, err=%v", attempts, err)
	}
}

func TestTemporalReconcilerConvergesTerminatedWorkflowBeforePublishingFailed(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-terminated")
	closedAt := time.Date(2026, 7, 23, 10, 11, 12, 654321000, time.UTC)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-terminated")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED
	info.CloseTime = closedAt
	callbackCalls := 0
	server := &Server{
		config:               config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "termination-reconciler"},
		runProjectionStore:   store,
		temporalStarter:      &reconcilerStarterForTest{describe: info},
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(_ context.Context, _ execution.DurableRun, completedAt time.Time, response map[string]any) error {
			callbackCalls++
			if !completedAt.Equal(closedAt) || stringValue(response["status"]) != "error" {
				t.Errorf("termination callback completed_at=%s response=%#v", completedAt, response)
			}
			if callbackCalls == 1 {
				return errors.New("callback unavailable")
			}
			return nil
		},
	}
	reconciler := &temporalReconciler{server: server}

	reconciler.reconcileWorkflowTimeouts(context.Background())
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusRunning {
		t.Fatalf("run became terminal before termination callback succeeded: %#v err=%v", run, err)
	}
	reconciler.reconcileWorkflowTimeouts(context.Background())
	run, err = store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowExecutionTerminatedFailure || !run.CompletedAt.Equal(closedAt) {
		t.Fatalf("terminated run = %#v err=%v", run, err)
	}
	events := mustListRunEvents(t, store, intent.RunID)
	if events[len(events)-1].EventType != execution.DurableRunEventTypeRunFailed {
		t.Fatalf("terminal event = %#v", events[len(events)-1])
	}
	attempts, err := store.ListStepAttempts(context.Background(), intent.RunID)
	if err != nil || len(attempts) != 1 || attempts[0].StepID != "workflow.execution" ||
		attempts[0].FailCloseReason != workflowExecutionTerminatedFailure {
		t.Fatalf("termination attempts = %#v, err=%v", attempts, err)
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cleanup-after-termination",
		Now:        lifecycleNow().Add(time.Minute),
		LeaseUntil: lifecycleNow().Add(2 * time.Minute),
		Limit:      1,
	})
	if err != nil || len(cleanups) != 1 {
		t.Fatalf("termination cleanup = %#v, err=%v", cleanups, err)
	}

	conflictingCloseTime := closedAt.Add(time.Second)
	if err := reconciler.finalizeTerminatedWorkflow(context.Background(), store, run, conflictingCloseTime); !errors.Is(err, execution.ErrDurableRunFailureConflict) {
		t.Fatalf("conflicting termination replay error = %v, want ErrDurableRunFailureConflict", err)
	}
}

func TestTemporalReconcilerFailClosesClosedWorkflowWithoutProductTerminalProjection(t *testing.T) {
	for _, test := range []struct {
		name        string
		status      enumspb.WorkflowExecutionStatus
		failureKind string
	}{
		{
			name:        "completed",
			status:      enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED,
			failureKind: workflowCompletedUnprojectedFailure,
		},
		{
			name:        "failed",
			status:      enumspb.WORKFLOW_EXECUTION_STATUS_FAILED,
			failureKind: workflowFailedUnprojectedFailure,
		},
		{
			name:        "canceled without durable cancellation command",
			status:      enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED,
			failureKind: workflowCanceledUnprojectedFailure,
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
			server := &Server{
				config:               config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "closed-workflow-reconciler"},
				runProjectionStore:   store,
				temporalStarter:      &reconcilerStarterForTest{describe: info},
				executionInputLoader: noOpExecutionInputLoader{},
				productFinalizationWriter: func(_ context.Context, _ execution.DurableRun, completedAt time.Time, response map[string]any) error {
					callbackCalls++
					if !completedAt.Equal(closedAt) || stringValue(nestedMap(response, "error")["code"]) != test.failureKind {
						t.Errorf("closed callback completed_at=%s response=%#v", completedAt, response)
					}
					return nil
				},
			}

			(&temporalReconciler{server: server}).reconcileWorkflowTimeouts(context.Background())

			run, err := store.GetRun(context.Background(), intent.RunID)
			if err != nil || run.Status != execution.DurableRunStatusFailed ||
				run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
				run.FailCloseReason != test.failureKind || !run.CompletedAt.Equal(closedAt) {
				t.Fatalf("closed workflow run = %#v, err=%v", run, err)
			}
			if callbackCalls != 1 {
				t.Fatalf("closed workflow callback calls = %d, want 1", callbackCalls)
			}
			cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "cleanup-closed-workflow",
				Now:        lifecycleNow().Add(time.Minute),
				LeaseUntil: lifecycleNow().Add(2 * time.Minute),
				Limit:      1,
			})
			if err != nil || len(cleanups) != 1 {
				t.Fatalf("closed workflow cleanup = %#v, err=%v", cleanups, err)
			}
		})
	}
}

func TestTemporalReconcilerFailClosesUnauthorizedSuccessorWithoutCleaningPayload(t *testing.T) {
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
	failed, err := store.GetRun(context.Background(), intent.RunID)
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
	bound, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || bound.TemporalRunID != exact.RunID {
		t.Fatalf("unauthorized successor changed root binding = %#v, err=%v", bound, err)
	}
	cleanupStarter := &reconcilerStarterForTest{
		describe:       latest,
		describeSeries: []temporalruntime.WorkflowExecutionInfo{exact, latest},
	}
	cleanupServer := &Server{
		config:             server.config,
		runProjectionStore: store,
		temporalStarter:    cleanupStarter,
	}
	(&temporalReconciler{server: cleanupServer}).reconcileRunCleanups(context.Background())
	cleanup, err := store.GetRunCleanup(context.Background(), intent.RunID)
	if err != nil || cleanup.State != execution.LifecycleIntentStatePending ||
		cleanup.LastErrorCode != "cleanup_workflow_not_closed" {
		t.Fatalf("unauthorized successor cleanup = %#v, err=%v", cleanup, err)
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
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowUnauthorizedSuccessorFailure || callbackCalls != 1 {
		t.Fatalf("reset-marked successor run = %#v, callbacks=%d, err=%v", run, callbackCalls, err)
	}
	if starter.cancellations() != 0 {
		t.Fatalf("reset successor received %d cancellation calls", starter.cancellations())
	}
}

type pagedActiveWorkflowStore struct {
	execution.RunProjectionStore
	execution.ProtectedPayloadStore
	bindings []execution.ActiveWorkflowRun
	cursors  []string
}

func (s *pagedActiveWorkflowStore) ListActiveWorkflowRuns(
	_ context.Context,
	afterRunID string,
	limit int,
) ([]execution.ActiveWorkflowRun, error) {
	s.cursors = append(s.cursors, afterRunID)
	page := make([]execution.ActiveWorkflowRun, 0, limit)
	for _, binding := range s.bindings {
		if binding.Run.RunID <= afterRunID {
			continue
		}
		page = append(page, binding)
		if len(page) == limit {
			break
		}
	}
	return page, nil
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
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken,
		TemporalRunID: "temporal-paginated-timeout", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	confirmedIntent, err := base.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	run, err := base.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	bindings := make([]execution.ActiveWorkflowRun, 0, temporalReconcileBatch+1)
	for index := range temporalReconcileBatch {
		runID := fmt.Sprintf("run-%03d", index)
		bindings = append(bindings, execution.ActiveWorkflowRun{
			Run: execution.DurableRun{RunID: runID},
			StartIntent: execution.WorkflowStartIntent{
				RunID: runID, WorkflowInputJSON: json.RawMessage(`{}`),
			},
		})
	}
	bindings = append(bindings, execution.ActiveWorkflowRun{Run: run, StartIntent: confirmedIntent})
	store := &pagedActiveWorkflowStore{
		RunProjectionStore: base, ProtectedPayloadStore: base, bindings: bindings,
	}
	closedAt := time.Date(2026, 7, 23, 10, 11, 12, 123456000, time.UTC)
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-paginated-timeout")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TIMED_OUT
	info.CloseTime = closedAt
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000, TemporalWorkerIdentity: "timeout-page-reconciler"},
		runProjectionStore: store, temporalStarter: starter,
		executionInputLoader: noOpExecutionInputLoader{},
		productFinalizationWriter: func(context.Context, execution.DurableRun, time.Time, map[string]any) error {
			return nil
		},
	}
	reconciler := &temporalReconciler{server: server}

	reconciler.reconcileWorkflowTimeouts(context.Background())
	if firstPageRun, err := base.GetRun(context.Background(), intent.RunID); err != nil ||
		firstPageRun.Status != execution.DurableRunStatusQueued {
		t.Fatalf("later-page run changed during first page: %#v err=%v", firstPageRun, err)
	}
	reconciler.reconcileWorkflowTimeouts(context.Background())
	expired, err := base.GetRun(context.Background(), intent.RunID)
	if err != nil || expired.Status != execution.DurableRunStatusExpired || !expired.CompletedAt.Equal(closedAt) {
		t.Fatalf("later-page timeout did not converge: %#v err=%v", expired, err)
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 2 ||
		described[0] != "temporal-paginated-timeout" || described[1] != "" {
		t.Fatalf("timeout describe Temporal run ids = %#v", described)
	}
	reconciler.reconcileWorkflowTimeouts(context.Background())
	if len(store.cursors) != 3 || store.cursors[0] != "" || store.cursors[1] != "run-031" || store.cursors[2] != "" {
		t.Fatalf("active scan cursors = %#v", store.cursors)
	}
}

type noOpExecutionInputLoader struct{}

func (noOpExecutionInputLoader) Load(context.Context, execution.DurableRun) (contracts.ExecutionPayloadWire, error) {
	return contracts.ExecutionPayloadWire{}, errors.New("not used")
}

func (noOpExecutionInputLoader) Delete(context.Context, execution.DurableRun) error { return nil }

func TestTemporalReconcilerRetriesUncertainStartWithoutQueueing(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	starter := &reconcilerStarterForTest{startErr: errors.New("transport unavailable")}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}

	server.ReconcileTemporalRunsOnce(context.Background())
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("uncertain start changed run status to %q", run.Status)
	}
	recovered, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
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
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}

	(&temporalReconciler{server: server}).reconcileStartIntent(context.Background(), store, leased[0])
	if starter.calls() != 0 {
		t.Fatalf("start calls after GetRun failure = %d", starter.calls())
	}
	if starter.cancellations() != 0 {
		t.Fatalf("cancellation calls after GetRun failure = %d", starter.cancellations())
	}
	retry, err := base.GetWorkflowStartIntent(context.Background(), intent.RunID)
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
		RunID: intent.RunID, Reason: "user_requested", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	starter := &reconcilerStarterForTest{}
	server := &Server{
		config:             config.Config{TemporalStartTimeoutMS: 1000},
		runProjectionStore: store,
		temporalStarter:    starter,
	}
	(&temporalReconciler{server: server}).reconcileStartIntent(context.Background(), store, leased[0])
	if starter.calls() != 0 {
		t.Fatalf("superseded lease invoked Temporal start %d times", starter.calls())
	}
}

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
		intent.RunID,
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
	start, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || start.TemporalRunID != "" {
		t.Fatalf("successor recovery was bound: start=%#v err=%v", start, err)
	}
	run, err := store.GetRun(context.Background(), intent.RunID)
	if err != nil || run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
		run.FailCloseReason != workflowUnauthorizedSuccessorFailure {
		t.Fatalf("successor recovery product run = %#v, err=%v", run, err)
	}
	assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, intent.CreatedAt.Add(time.Second))
	cleanup, err := store.GetRunCleanup(context.Background(), intent.RunID)
	if err != nil || cleanup.State != execution.LifecycleIntentStatePending {
		t.Fatalf("successor recovery cleanup = %#v, err=%v", cleanup, err)
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cleanup-recovery-successor",
		Now:        lifecycleNow().Add(time.Minute),
		LeaseUntil: lifecycleNow().Add(2 * time.Minute),
		Limit:      1,
	})
	if err != nil || len(cleanups) != 0 {
		t.Fatalf("unbound successor cleanup became leaseable = %#v, err=%v", cleanups, err)
	}
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
		intent.RunID,
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
	start, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
	if err != nil || start.TemporalRunID != "" {
		t.Fatalf("reset-marked candidate was bound: start=%#v err=%v", start, err)
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
				RunID: intent.RunID, Reason: "user_requested", Now: now,
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
			run, err := store.GetRun(context.Background(), intent.RunID)
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
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken,
		TemporalRunID: "temporal-run-owned", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RunID: intent.RunID, Reason: "user_requested", Now: now,
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
		target.RunID != intent.RunID {
		t.Fatalf("cancellation target = %#v", target)
	}
}

func TestTemporalReconcilerRejectsResetEvidenceForCancellation(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	now := confirmAndStartReconcilerRunForTest(t, store, intent, "temporal-cancel-reset-root")
	command := requestAndLeaseReconcilerCancellationForTest(
		t,
		store,
		intent.RunID,
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
				intent.RunID,
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
			bound, err := store.GetWorkflowStartIntent(context.Background(), intent.RunID)
			if err != nil || bound.TemporalRunID != exact.RunID {
				t.Fatalf("immutable start binding = %#v, err=%v", bound, err)
			}
			run, err := store.GetRun(context.Background(), intent.RunID)
			if err != nil || run.Status != execution.DurableRunStatusFailed ||
				run.TerminalReason != execution.DurableTerminalReasonRuntimeInvariant ||
				run.FailCloseReason != workflowUnauthorizedSuccessorFailure {
				t.Fatalf("successor cancellation product run = %#v, err=%v", run, err)
			}
			assertReconcilerCancellationConfirmedForTest(t, store, intent.RunID, now)
			if described := starter.describedTemporalRunIDs(); len(described) != 3 ||
				described[0] != exact.RunID || described[1] != "" || described[2] != "" {
				t.Fatalf("continuation cancellation describes = %#v", described)
			}
		})
	}
}

type failingGetRunProjectionStore struct {
	execution.RunProjectionStore
	err error
}

func (s failingGetRunProjectionStore) GetRun(context.Context, string) (execution.DurableRun, error) {
	return execution.DurableRun{}, s.err
}

type failingAfterFirstGetRunProjectionStore struct {
	execution.RunProjectionStore
	err   error
	reads int
}

func (s *failingAfterFirstGetRunProjectionStore) GetRun(
	ctx context.Context,
	runID string,
) (execution.DurableRun, error) {
	s.reads++
	if s.reads > 1 {
		return execution.DurableRun{}, s.err
	}
	return s.RunProjectionStore.GetRun(ctx, runID)
}

type terminalOnCancellationRecheckStore struct {
	execution.RunProjectionStore
	reads int
}

func (s *terminalOnCancellationRecheckStore) GetRun(
	ctx context.Context,
	runID string,
) (execution.DurableRun, error) {
	run, err := s.RunProjectionStore.GetRun(ctx, runID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	s.reads++
	if s.reads > 1 {
		run.Status = execution.DurableRunStatusCompleted
		run.TerminalReason = execution.DurableTerminalReasonAnswerCompleted
		run.CompletedAt = lifecycleNow()
	}
	return run, nil
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

func TestDecodeWorkflowStartInputRejectsClosedToolStrategy(t *testing.T) {
	store, intent := createReconcilerStartIntentForTest(t)
	run, err := store.GetRun(t.Context(), intent.RunID)
	if err != nil {
		t.Fatal(err)
	}
	var input temporalruntime.ToolExecutionWorkflowInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		t.Fatal(err)
	}
	input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames = []string{personalMemoryRecallToolName}
	input.AdmissionSnapshot.ExecutionStrategySHA256 = hashAdmissionJSON(
		input.AdmissionSnapshot.ExecutionStrategy,
	)
	intent.WorkflowInputJSON, err = json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := decodeAndValidateWorkflowStartInput(intent, run); err == nil ||
		!strings.Contains(err.Error(), "disabled memory execution strategy budget is invalid") {
		t.Fatalf("closed tool strategy error = %v", err)
	}
}

func confirmAndStartReconcilerRunForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	temporalRunID string,
) time.Time {
	t.Helper()
	ctx := context.Background()
	leased, err := store.LeaseWorkflowStartIntents(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: "confirm-running-workflow",
		Now:        intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute),
		Limit:      1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease workflow start intent = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, store, leased[0], intent.CreatedAt)
	queuedAt := intent.CreatedAt.Add(time.Second)
	if err := store.ConfirmWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken, TemporalRunID: temporalRunID, Now: queuedAt,
	}); err != nil {
		t.Fatalf("confirm workflow start intent: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		intent.RunID,
		execution.DurableRunStatusAdmitted,
		"",
		queuedAt.Add(time.Second),
	); err != nil {
		t.Fatalf("admit reconciler run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		intent.RunID,
		execution.DurableRunStatusRunning,
		"",
		queuedAt.Add(2*time.Second),
	); err != nil {
		t.Fatalf("start reconciler run: %v", err)
	}
	return queuedAt.Add(3 * time.Second)
}

func requestAndLeaseReconcilerCancellationForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
	leaseToken string,
) execution.RunCancellationCommand {
	t.Helper()
	ctx := context.Background()
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RunID: runID, Reason: "user_requested", Now: now,
	}); err != nil {
		t.Fatalf("request run cancellation: %v", err)
	}
	commands, err := store.LeaseRunCancellationCommands(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: leaseToken, Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("lease cancellation command = %#v, err=%v", commands, err)
	}
	return commands[0]
}

func assertReconcilerCancellationConfirmedForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	now time.Time,
) {
	t.Helper()
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "assert-cancellation-confirmed-" + runID,
		Now:        now.Add(2 * time.Minute),
		LeaseUntil: now.Add(3 * time.Minute),
		Limit:      1,
	})
	if err != nil || len(commands) != 0 {
		t.Fatalf("confirmed cancellation command re-leased = %#v, err=%v", commands, err)
	}
}

func createReconcilerStartIntentForTest(t *testing.T) (*execution.InMemoryRunProjectionStore, execution.WorkflowStartIntent) {
	t.Helper()
	store := execution.NewInMemoryRunProjectionStore()
	now := time.Now().UTC().Truncate(time.Microsecond).Add(-time.Minute)
	runID := "run-reconciler-test"
	conversationID := "conversation-reconciler-test"
	payloadHash := strings.Repeat("a", 64)
	server := NewServer(config.Config{})
	attachAgentAdmissionProviderConfigsForTest(server)
	snapshot, err := server.buildAgentAdmissionSnapshot(
		t.Context(),
		false,
		false,
		groundingPlanForTest("reconciler fixture"),
	)
	if err != nil {
		t.Fatalf("build reconciler admission snapshot: %v", err)
	}
	input := temporalruntime.ToolExecutionWorkflowInput{
		AdmissionSnapshot:       snapshot,
		AdmissionSnapshotSHA256: sha256JSONRef(snapshot),
		ConversationID:          conversationID,
		GroundingContextRef:     groundingContextRef(runID),
		PayloadSHA256:           payloadHash,
		RequestID:               "request-reconciler-test",
		RunID:                   runID,
		TaskQueue:               temporalruntime.WorkflowTaskQueue,
		TraceID:                 "trace-reconciler-test",
		TurnID:                  "turn-reconciler-test",
		WorkflowID:              "campus-agent.chat." + runID,
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	request := execution.DurableRunCreateIntent{
		Run: execution.DurableRun{
			RunID: runID, ConversationID: conversationID, TurnID: input.TurnID,
			RequestID: input.RequestID, TraceID: input.TraceID, OwnerUserID: "user-reconciler-test",
			Surface: "campus-web", TaskQueue: temporalruntime.WorkflowTaskQueue,
			Status: execution.DurableRunStatusCreated, CreatedAt: now, UpdatedAt: now,
			Metadata: map[string]any{
				"execution_contract_version": "tool_execution_v5",
				"execution_input_ref":        "app-api://execution-inputs/" + runID,
				"execution_input_sha256":     payloadHash,
			},
		},
		RequestFingerprintSHA256: strings.Repeat("b", 64),
		WorkflowID:               input.WorkflowID,
		PayloadSHA256:            payloadHash,
		TaskQueue:                input.TaskQueue,
		WorkflowInputJSON:        inputJSON,
		CreatedEvent: execution.DurableRunEvent{
			EventID: "run-reconciler-test:run-created", RunID: runID, ConversationID: conversationID,
			EventType: execution.DurableRunEventTypeRunCreated, OccurredAt: now,
			Visibility: execution.DurableRunEventVisibilityInternal, PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{"status": "created"},
		},
	}
	if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	created, err := store.GetWorkflowStartIntent(context.Background(), runID)
	if err != nil {
		t.Fatal(err)
	}
	return store, created
}

func reconcilerWorkflowInfoForIntent(
	t *testing.T,
	intent execution.WorkflowStartIntent,
	temporalRunID string,
) temporalruntime.WorkflowExecutionInfo {
	t.Helper()
	var input temporalruntime.ToolExecutionWorkflowInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		t.Fatal(err)
	}
	identity, err := temporalruntime.ToolExecutionWorkflowIdentityForInput(input)
	if err != nil {
		t.Fatal(err)
	}
	return temporalruntime.WorkflowExecutionInfo{
		Found: true, WorkflowID: input.WorkflowID, RunID: temporalRunID, FirstRunID: temporalRunID,
		ResetStateKnown: true,
		IdentityState:   temporalruntime.WorkflowIdentityKnown,
		Identity:        identity,
	}
}

func markReconcilerStartDispatchForTest(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	now time.Time,
) {
	t.Helper()
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: intent.LeaseToken, Now: now,
	}); err != nil {
		t.Fatal(err)
	}
}

func mustListRunEvents(
	t *testing.T,
	store execution.RunProjectionStore,
	runID string,
) []execution.DurableRunEvent {
	t.Helper()
	events, err := store.ListRunEvents(context.Background(), runID)
	if err != nil {
		t.Fatal(err)
	}
	return events
}

var _ temporalruntime.WorkflowControl = (*reconcilerStarterForTest)(nil)
var _ temporalruntime.ChatWorkflowStarter = (*reconcilerStarterWithoutControlForTest)(nil)
