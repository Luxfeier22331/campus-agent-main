package httpapi

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
)

type cleanupInputLoaderForTest struct {
	deleteCalls    int
	deleteFailures int
}

func (*cleanupInputLoaderForTest) Load(
	context.Context,
	execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	return contracts.ExecutionPayloadWire{}, errors.New("cleanup test input load is unsupported")
}

func (l *cleanupInputLoaderForTest) Delete(context.Context, execution.DurableRun) error {
	l.deleteCalls++
	if l.deleteFailures > 0 {
		l.deleteFailures--
		return errors.New("execution input delete unavailable")
	}
	return nil
}

type cleanupProjectionStoreForTest struct {
	*execution.InMemoryRunProjectionStore
	deleteCalls    int
	deleteFailures int
}

func (s *cleanupProjectionStoreForTest) DeleteProtectedPayloads(ctx context.Context, runID string) error {
	s.deleteCalls++
	if s.deleteFailures > 0 {
		s.deleteFailures--
		return errors.New("protected payload delete unavailable")
	}
	return s.InMemoryRunProjectionStore.DeleteProtectedPayloads(ctx, runID)
}

func TestTemporalRunCleanupRequiresClosedTerminalWorkflowChain(t *testing.T) {
	store, intent, run := confirmedTerminalCleanupForTest(t)
	inputLoader := &cleanupInputLoaderForTest{}
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cleanup-owned")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	starter := &reconcilerStarterForTest{describe: info}
	server := &Server{
		config:               configForCleanupTest(),
		executionInputLoader: inputLoader,
		runProjectionStore:   store,
		temporalStarter:      starter,
	}
	reconciler := &temporalReconciler{server: server}

	cleanup := leaseRunCleanupForTest(t, store, "cleanup-running")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)

	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_CONTINUED_AS_NEW
	info.CloseTime = time.Now().UTC()
	starter.mu.Lock()
	starter.describe = info
	starter.mu.Unlock()
	cleanup = leaseRunCleanupForTest(t, store, "cleanup-continued")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)

	conflict := info
	conflict.Status = enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED
	conflict.Identity.PayloadSHA256 = strings.Repeat("e", 64)
	starter.mu.Lock()
	starter.describe = conflict
	starter.mu.Unlock()
	cleanup = leaseRunCleanupForTest(t, store, "cleanup-conflict")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)

	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED
	info.CloseTime = time.Now().UTC()
	starter.mu.Lock()
	starter.describe = info
	starter.mu.Unlock()
	cleanup = leaseRunCleanupForTest(t, store, "cleanup-closed")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	confirmed, err := store.GetRunCleanup(context.Background(), run.RunID)
	if err != nil || confirmed.State != execution.LifecycleIntentStateConfirmed {
		t.Fatalf("confirmed cleanup = %#v, err=%v", confirmed, err)
	}
	if inputLoader.deleteCalls != 1 || store.deleteCalls != 1 {
		t.Fatalf("delete calls input=%d protected=%d, want 1/1", inputLoader.deleteCalls, store.deleteCalls)
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 5 ||
		described[0] != "temporal-cleanup-owned" ||
		described[1] != "temporal-cleanup-owned" ||
		described[2] != "temporal-cleanup-owned" ||
		described[3] != "temporal-cleanup-owned" ||
		described[4] != "" {
		t.Fatalf("cleanup exact/latest describe run ids = %#v", described)
	}
}

func TestTemporalRunCleanupRejectsDifferentLatestExecution(t *testing.T) {
	store, intent, run := confirmedTerminalCleanupForTest(t)
	inputLoader := &cleanupInputLoaderForTest{}
	exact := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cleanup-owned")
	exact.FirstRunID = exact.RunID
	exact.Status = enumspb.WORKFLOW_EXECUTION_STATUS_TERMINATED
	exact.CloseTime = time.Now().UTC()
	latest := exact
	latest.RunID = "temporal-reset-running"
	latest.Status = enumspb.WORKFLOW_EXECUTION_STATUS_RUNNING
	latest.CloseTime = time.Time{}
	starter := &reconcilerStarterForTest{describeSeries: []temporalruntime.WorkflowExecutionInfo{exact, latest}}
	server := &Server{
		config:               configForCleanupTest(),
		executionInputLoader: inputLoader,
		runProjectionStore:   store,
		temporalStarter:      starter,
	}
	reconciler := &temporalReconciler{server: server}

	cleanup := leaseRunCleanupForTest(t, store, "cleanup-reset-running")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)

	differentChainLatest := latest
	differentChainLatest.RunID = "temporal-different-chain-closed"
	differentChainLatest.Status = enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED
	differentChainLatest.CloseTime = time.Now().UTC()
	differentChainLatest.FirstRunID = "temporal-different-chain-first"
	starter.mu.Lock()
	starter.describeSeries = append(starter.describeSeries, exact, differentChainLatest)
	starter.mu.Unlock()
	cleanup = leaseRunCleanupForTest(t, store, "cleanup-different-chain")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)

	sameFirstLatest := differentChainLatest
	sameFirstLatest.RunID = "temporal-same-first-run-closed"
	sameFirstLatest.FirstRunID = exact.FirstRunID
	starter.mu.Lock()
	starter.describeSeries = append(starter.describeSeries, exact, sameFirstLatest)
	starter.mu.Unlock()
	cleanup = leaseRunCleanupForTest(t, store, "cleanup-same-first-run-closed")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)
	if described := starter.describedTemporalRunIDs(); len(described) != 6 {
		t.Fatalf("different-latest describe run ids = %#v", described)
	} else {
		for index, temporalRunID := range described {
			if index%2 == 0 && temporalRunID != "temporal-cleanup-owned" {
				t.Fatalf("different-latest exact describe[%d] = %q", index, temporalRunID)
			}
			if index%2 == 1 && temporalRunID != "" {
				t.Fatalf("different-latest latest describe[%d] = %q", index, temporalRunID)
			}
		}
	}
}

func TestTemporalRunCleanupRejectsResetEvidenceAndUnknownResetState(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*temporalruntime.WorkflowExecutionInfo)
	}{
		{
			name: "reset run id",
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
				info.ResetRunID = "temporal-cleanup-reset-successor"
			},
		},
		{
			name: "unknown reset state",
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
				info.ResetStateKnown = false
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store, intent, run := confirmedTerminalCleanupForTest(t)
			inputLoader := &cleanupInputLoaderForTest{}
			info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cleanup-owned")
			info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED
			info.CloseTime = time.Now().UTC()
			test.mutate(&info)
			server := &Server{
				config:               configForCleanupTest(),
				executionInputLoader: inputLoader,
				runProjectionStore:   store,
				temporalStarter:      &reconcilerStarterForTest{describe: info},
			}
			cleanup := leaseRunCleanupForTest(t, store, "cleanup-reset-state")
			(&temporalReconciler{server: server}).reconcileRunCleanup(context.Background(), store, cleanup)
			assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)
		})
	}
}

func TestTemporalRunCleanupVerifiesSupersededBoundExecutionChain(t *testing.T) {
	base, intent := createReconcilerStartIntentForTest(t)
	ctx := context.Background()
	leased, err := base.LeaseWorkflowStartIntents(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: "bind-superseded-cleanup-start", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leased, err)
	}
	markReconcilerStartDispatchForTest(t, base, leased[0], intent.CreatedAt)
	if _, err := base.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RunID: intent.RunID, Reason: "user_requested", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := base.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RunID: intent.RunID, WorkflowID: intent.WorkflowID,
		TemporalRunID: "temporal-superseded-cleanup", Now: intent.CreatedAt.Add(2 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	run, err := base.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
		RunID: intent.RunID, Reason: "user_requested", Now: intent.CreatedAt.Add(3 * time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	store := &cleanupProjectionStoreForTest{InMemoryRunProjectionStore: base}
	inputLoader := &cleanupInputLoaderForTest{}
	exact := reconcilerWorkflowInfoForIntent(t, intent, "temporal-superseded-cleanup")
	exact.FirstRunID = exact.RunID
	exact.Status = enumspb.WORKFLOW_EXECUTION_STATUS_CANCELED
	exact.CloseTime = time.Now().UTC()
	latest := exact
	starter := &reconcilerStarterForTest{
		describeSeries: []temporalruntime.WorkflowExecutionInfo{exact, latest},
	}
	server := &Server{
		config: configForCleanupTest(), executionInputLoader: inputLoader,
		runProjectionStore: store, temporalStarter: starter,
	}

	cleanup := leaseRunCleanupForTest(t, store, "cleanup-superseded-bound")
	(&temporalReconciler{server: server}).reconcileRunCleanup(ctx, store, cleanup)
	assertCleanupStateForTest(t, store, run.RunID, execution.LifecycleIntentStateConfirmed)
	if inputLoader.deleteCalls != 1 || store.deleteCalls != 1 {
		t.Fatalf("superseded-bound deletes input=%d protected=%d, want 1/1", inputLoader.deleteCalls, store.deleteCalls)
	}
	if described := starter.describedTemporalRunIDs(); len(described) != 2 ||
		described[0] != "temporal-superseded-cleanup" || described[1] != "" {
		t.Fatalf("superseded-bound exact/latest describes = %#v", described)
	}
}

func TestTemporalRunCleanupRejectsUnresolvedLatestChainIdentity(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*temporalruntime.WorkflowExecutionInfo)
	}{
		{
			name: "missing first run id",
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
				info.FirstRunID = ""
			},
		},
		{
			name: "memo conflict",
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
				info.Identity.PayloadSHA256 = strings.Repeat("e", 64)
			},
		},
		{
			name: "memo unknown",
			mutate: func(info *temporalruntime.WorkflowExecutionInfo) {
				info.IdentityState = temporalruntime.WorkflowIdentityUnknown
				info.Identity = temporalruntime.ToolExecutionWorkflowIdentity{}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store, intent, run := confirmedTerminalCleanupForTest(t)
			inputLoader := &cleanupInputLoaderForTest{}
			exact := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cleanup-owned")
			exact.Status = enumspb.WORKFLOW_EXECUTION_STATUS_COMPLETED
			exact.CloseTime = time.Now().UTC()
			latest := exact
			test.mutate(&latest)
			starter := &reconcilerStarterForTest{
				describeSeries: []temporalruntime.WorkflowExecutionInfo{exact, latest},
			}
			server := &Server{
				config:               configForCleanupTest(),
				executionInputLoader: inputLoader,
				runProjectionStore:   store,
				temporalStarter:      starter,
			}

			cleanup := leaseRunCleanupForTest(t, store, "cleanup-latest-identity")
			(&temporalReconciler{server: server}).reconcileRunCleanup(context.Background(), store, cleanup)
			assertCleanupPendingWithoutDeletes(t, store, run.RunID, inputLoader.deleteCalls, store.deleteCalls)
			if described := starter.describedTemporalRunIDs(); len(described) != 2 ||
				described[0] != "temporal-cleanup-owned" || described[1] != "" {
				t.Fatalf("cleanup exact/latest describe run ids = %#v", described)
			}
		})
	}
}

func TestTemporalRunCleanupRetriesBothPayloadOwnersBeforeConfirmation(t *testing.T) {
	store, intent, run := confirmedTerminalCleanupForTest(t)
	inputLoader := &cleanupInputLoaderForTest{deleteFailures: 1}
	store.deleteFailures = 1
	info := reconcilerWorkflowInfoForIntent(t, intent, "temporal-cleanup-owned")
	info.Status = enumspb.WORKFLOW_EXECUTION_STATUS_FAILED
	info.CloseTime = time.Now().UTC()
	server := &Server{
		config:               configForCleanupTest(),
		executionInputLoader: inputLoader,
		runProjectionStore:   store,
		temporalStarter:      &reconcilerStarterForTest{describe: info},
	}
	reconciler := &temporalReconciler{server: server}

	cleanup := leaseRunCleanupForTest(t, store, "cleanup-input-failure")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupStateForTest(t, store, run.RunID, execution.LifecycleIntentStatePending)
	if inputLoader.deleteCalls != 1 || store.deleteCalls != 0 {
		t.Fatalf("first delete calls input=%d protected=%d, want 1/0", inputLoader.deleteCalls, store.deleteCalls)
	}

	cleanup = leaseRunCleanupForTest(t, store, "cleanup-protected-failure")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupStateForTest(t, store, run.RunID, execution.LifecycleIntentStatePending)
	if inputLoader.deleteCalls != 2 || store.deleteCalls != 1 {
		t.Fatalf("second delete calls input=%d protected=%d, want 2/1", inputLoader.deleteCalls, store.deleteCalls)
	}
	if _, err := store.GetProtectedPayload(
		context.Background(),
		run.RunID,
		"projection://cleanup-test",
		"cleanup_test",
	); err != nil {
		t.Fatalf("protected payload disappeared before successful delete: %v", err)
	}

	cleanup = leaseRunCleanupForTest(t, store, "cleanup-success")
	reconciler.reconcileRunCleanup(context.Background(), store, cleanup)
	assertCleanupStateForTest(t, store, run.RunID, execution.LifecycleIntentStateConfirmed)
	if inputLoader.deleteCalls != 3 || store.deleteCalls != 2 {
		t.Fatalf("final delete calls input=%d protected=%d, want 3/2", inputLoader.deleteCalls, store.deleteCalls)
	}
	if _, err := store.GetProtectedPayload(
		context.Background(),
		run.RunID,
		"projection://cleanup-test",
		"cleanup_test",
	); !errors.Is(err, execution.ErrProtectedPayloadNotFound) {
		t.Fatalf("protected payload after cleanup error = %v", err)
	}
}

func confirmedTerminalCleanupForTest(
	t *testing.T,
) (*cleanupProjectionStoreForTest, execution.WorkflowStartIntent, execution.DurableRun) {
	t.Helper()
	base, intent := createReconcilerStartIntentForTest(t)
	ctx := context.Background()
	leased, err := base.LeaseWorkflowStartIntents(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: "confirm-cleanup-start", Now: intent.CreatedAt,
		LeaseUntil: intent.CreatedAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease cleanup start = %#v, err=%v", leased, err)
	}
	if err := base.MarkWorkflowStartDispatchAttempt(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken, Now: intent.CreatedAt,
	}); err != nil {
		t.Fatal(err)
	}
	if err := base.ConfirmWorkflowStartIntent(ctx, execution.WorkflowStartIntentResult{
		RunID: intent.RunID, LeaseToken: leased[0].LeaseToken,
		TemporalRunID: "temporal-cleanup-owned", Now: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := base.PutProtectedPayload(ctx, execution.ProtectedPayload{
		RunID: intent.RunID, PayloadRef: "projection://cleanup-test", Kind: "cleanup_test",
		Ciphertext: []byte("ciphertext"), PayloadSHA256: strings.Repeat("d", 64),
		CreatedAt: intent.CreatedAt.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	run, err := base.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
		RunID: intent.RunID, Reason: "cleanup_test", Now: intent.CreatedAt.Add(2 * time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	return &cleanupProjectionStoreForTest{InMemoryRunProjectionStore: base}, intent, run
}

func leaseRunCleanupForTest(
	t *testing.T,
	store execution.RunProjectionStore,
	leaseToken string,
) execution.RunCleanup {
	t.Helper()
	current, err := store.GetRunCleanup(context.Background(), "run-reconciler-test")
	if err != nil {
		t.Fatal(err)
	}
	now := current.NextAttemptAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	cleanups, err := store.LeaseRunCleanups(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: leaseToken, Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(cleanups) != 1 {
		t.Fatalf("lease cleanup = %#v, err=%v", cleanups, err)
	}
	return cleanups[0]
}

func assertCleanupPendingWithoutDeletes(
	t *testing.T,
	store execution.RunProjectionStore,
	runID string,
	inputDeletes int,
	protectedDeletes int,
) {
	t.Helper()
	assertCleanupStateForTest(t, store, runID, execution.LifecycleIntentStatePending)
	if inputDeletes != 0 || protectedDeletes != 0 {
		t.Fatalf("unsafe cleanup deletes input=%d protected=%d", inputDeletes, protectedDeletes)
	}
}

func assertCleanupStateForTest(
	t *testing.T,
	store execution.RunProjectionStore,
	runID string,
	want execution.LifecycleIntentState,
) {
	t.Helper()
	cleanup, err := store.GetRunCleanup(context.Background(), runID)
	if err != nil || cleanup.State != want {
		t.Fatalf("cleanup state = %#v, err=%v, want %s", cleanup, err, want)
	}
}

func configForCleanupTest() config.Config {
	return config.Config{TemporalStartTimeoutMS: 1000}
}
