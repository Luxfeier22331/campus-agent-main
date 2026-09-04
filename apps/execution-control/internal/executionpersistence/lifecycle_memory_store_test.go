package executionpersistence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"strings"
	"testing"
	"time"
)

func TestInMemoryCreateRunWithStartIntentIsAtomicAndFingerprintIdempotent(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	request := atomicRunCreateRequestForTest(now)

	created, err := store.CreateRunWithStartIntent(context.Background(), request)
	if err != nil {
		t.Fatalf("create run with start intent: %v", err)
	}
	if !created.Created || created.Run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("create result = %#v", created)
	}
	replay, err := store.CreateRunWithStartIntent(context.Background(), request)
	if err != nil {
		t.Fatalf("replay run with same fingerprint: %v", err)
	}
	if replay.Created || replay.Run.RequestID != created.Run.RequestID {
		t.Fatalf("replay result = %#v", replay)
	}

	conflict := request
	conflict.RequestFingerprintSHA256 = strings.Repeat("b", 64)
	if _, err := store.CreateRunWithStartIntent(context.Background(), conflict); !errors.Is(err, execution.ErrDurableRunFingerprintConflict) {
		t.Fatalf("different fingerprint error = %v", err)
	}
	events, err := store.ListRunEvents(context.Background(), created.Run.RequestID)
	if err != nil || len(events) != 1 || events[0].EventType != execution.DurableRunEventTypeRunCreated {
		t.Fatalf("atomic create events = %#v, err=%v", events, err)
	}
}

func TestInMemoryWorkflowStartIntentLeaseCanBeRecovered(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	if _, err := store.CreateRunWithStartIntent(context.Background(), atomicRunCreateRequestForTest(now)); err != nil {
		t.Fatal(err)
	}
	first, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "lease-1", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 10,
	})
	if err != nil || len(first) != 1 || first[0].AttemptCount != 1 {
		t.Fatalf("first lease = %#v, err=%v", first, err)
	}
	if second, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "lease-2", Now: now.Add(30 * time.Second), LeaseUntil: now.Add(2 * time.Minute), Limit: 10,
	}); err != nil || len(second) != 0 {
		t.Fatalf("active lease replay = %#v, err=%v", second, err)
	}
	recovered, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "lease-3", Now: now.Add(2 * time.Minute), LeaseUntil: now.Add(3 * time.Minute), Limit: 10,
	})
	if err != nil || len(recovered) != 1 || recovered[0].AttemptCount != 2 {
		t.Fatalf("recovered lease = %#v, err=%v", recovered, err)
	}
}

func TestInMemoryWorkflowStartDispatchFenceIsDurableAndTokenBound(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 1, 3, 3, 0, time.UTC)
	if _, err := store.CreateRunWithStartIntent(context.Background(), atomicRunCreateRequestForTest(now)); err != nil {
		t.Fatal(err)
	}
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "dispatch-lease", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 || leased[0].DispatchAttempted {
		t.Fatalf("initial dispatch lease = %#v, err=%v", leased, err)
	}
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: leased[0].LeaseToken,
		TemporalRunID: "temporal-without-dispatch", Now: now.Add(time.Second),
	}); !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		t.Fatalf("unfenced confirmation error = %v, want lifecycle conflict", err)
	}
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: "wrong-token", Now: now.Add(time.Second),
	}); !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		t.Fatalf("wrong-token dispatch fence error = %v, want lifecycle conflict", err)
	}
	markWorkflowStartDispatchForTest(t, store, leased[0], now.Add(2*time.Second))
	if err := store.RetryWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: leased[0].LeaseToken,
		Now: now.Add(3 * time.Second), NextAttemptAt: now.Add(4 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	retried, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "dispatch-retry", Now: now.Add(4 * time.Second),
		LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(retried) != 1 || !retried[0].DispatchAttempted {
		t.Fatalf("durable dispatch fence = %#v, err=%v", retried, err)
	}
}

func TestInMemoryListActiveWorkflowRunsUsesBoundedCursorPages(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	for index := range 35 {
		requestID := fmt.Sprintf("run-active-%03d", index)
		store.runs[requestID] = execution.DurableRun{RequestID: requestID, Status: execution.DurableRunStatusQueued}
		store.workflowStartIntents[requestID] = execution.WorkflowStartIntent{
			RequestID: requestID, State: execution.LifecycleIntentStateConfirmed,
		}
	}
	first, err := store.ListActiveWorkflowRuns(context.Background(), "", 32)
	if err != nil || len(first) != 32 || first[0].Run.RequestID != "run-active-000" ||
		first[len(first)-1].Run.RequestID != "run-active-031" {
		t.Fatalf("first active page = %#v, err=%v", first, err)
	}
	second, err := store.ListActiveWorkflowRuns(context.Background(), first[len(first)-1].Run.RequestID, 32)
	if err != nil || len(second) != 3 || second[0].Run.RequestID != "run-active-032" ||
		second[len(second)-1].Run.RequestID != "run-active-034" {
		t.Fatalf("second active page = %#v, err=%v", second, err)
	}
	wrapped, err := store.ListActiveWorkflowRuns(context.Background(), "", 32)
	if err != nil || len(wrapped) != len(first) || wrapped[0].Run.RequestID != first[0].Run.RequestID {
		t.Fatalf("wrapped active page = %#v, err=%v", wrapped, err)
	}
}

func TestInMemoryCancellationSupersedesStartIntentAndFencesOldWorker(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 2, 2, 3, 0, time.UTC)
	if _, err := store.CreateRunWithStartIntent(context.Background(), atomicRunCreateRequestForTest(now)); err != nil {
		t.Fatal(err)
	}
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-lease", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease start intent = %#v, err=%v", leased, err)
	}
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: atomicRunCreateRequestForTest(now).Run.RequestID, Reason: "user_requested", Now: now.Add(time.Second),
	}); err != nil {
		t.Fatalf("request cancellation: %v", err)
	}

	intent := store.workflowStartIntents[leased[0].RequestID]
	if intent.State != execution.LifecycleIntentStateSuperseded || intent.LeaseToken != "" || !intent.LeaseUntil.IsZero() {
		t.Fatalf("superseded intent = %#v", intent)
	}
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: "start-lease", Now: now.Add(2 * time.Second),
	}); !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		t.Fatalf("superseded dispatch fence error = %v, want lease conflict", err)
	}
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: "start-lease", TemporalRunID: "temporal-run", Now: now.Add(2 * time.Second),
	}); !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		t.Fatalf("stale confirmation error = %v, want lease conflict", err)
	}
	if retry, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "replacement", Now: now.Add(2 * time.Minute), LeaseUntil: now.Add(3 * time.Minute), Limit: 1,
	}); err != nil || len(retry) != 0 {
		t.Fatalf("superseded intent was leased again = %#v, err=%v", retry, err)
	}

	// An idempotent cancellation request must re-apply the fence if a stale
	// worker left an inconsistent leased snapshot behind.
	store.mu.Lock()
	stale := store.workflowStartIntents[leased[0].RequestID]
	stale.State = execution.LifecycleIntentStateLeased
	stale.LeaseToken = "stale-after-cancel"
	stale.LeaseUntil = now.Add(time.Hour)
	store.workflowStartIntents[leased[0].RequestID] = stale
	store.mu.Unlock()
	if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: leased[0].RequestID, Reason: "user_requested", Now: now.Add(3 * time.Second),
	}); err != nil {
		t.Fatalf("idempotent cancellation: %v", err)
	}
	intent = store.workflowStartIntents[leased[0].RequestID]
	if intent.State != execution.LifecycleIntentStateSuperseded || intent.LeaseToken != "" || !intent.LeaseUntil.IsZero() {
		t.Fatalf("idempotent cancellation did not re-fence intent = %#v", intent)
	}
}

func TestInMemorySupersededWorkflowExecutionBindingIsIdentityCheckedAndImmutable(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 2, 2, 3, 0, time.UTC)
	request := atomicRunCreateRequestForTest(now)
	store := NewInMemoryRunProjectionStore()
	if _, err := store.CreateRunWithStartIntent(ctx, request); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID: request.Run.RequestID, WorkflowID: request.WorkflowID,
		TemporalRunID: "temporal-before-supersession", Now: now,
	}); !errors.Is(err, execution.ErrWorkflowStartExecutionBindingConflict) {
		t.Fatalf("pending start binding error = %v, want binding conflict", err)
	}
	leased, err := store.LeaseWorkflowStartIntents(ctx, execution.LifecycleLeaseRequest{
		LeaseToken: "start-binding-lease", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease start = %#v, err=%v", leased, err)
	}
	markWorkflowStartDispatchForTest(t, store, leased[0], now.Add(time.Second))
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RequestID: request.Run.RequestID, Reason: "user_requested", Now: now.Add(2 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID: request.Run.RequestID, WorkflowID: "campus-agent.chat.foreign",
		TemporalRunID: "temporal-bound", Now: now.Add(3 * time.Second),
	}); !errors.Is(err, execution.ErrWorkflowStartExecutionBindingConflict) {
		t.Fatalf("foreign workflow binding error = %v, want binding conflict", err)
	}
	boundAt := now.Add(3 * time.Second)
	bound, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID: request.Run.RequestID, WorkflowID: request.WorkflowID,
		TemporalRunID: "temporal-bound", Now: boundAt,
	})
	if err != nil {
		t.Fatalf("bind superseded execution: %v", err)
	}
	if bound.State != execution.LifecycleIntentStateSuperseded || !bound.DispatchAttempted ||
		bound.TemporalRunID != "temporal-bound" || !bound.UpdatedAt.Equal(boundAt) {
		t.Fatalf("bound start = %#v", bound)
	}
	replayed, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID: request.Run.RequestID, WorkflowID: request.WorkflowID,
		TemporalRunID: "temporal-bound", Now: boundAt.Add(time.Minute),
	})
	if err != nil || !replayed.UpdatedAt.Equal(boundAt) {
		t.Fatalf("idempotent binding = %#v, err=%v", replayed, err)
	}
	if _, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID: request.Run.RequestID, WorkflowID: request.WorkflowID,
		TemporalRunID: "temporal-conflict", Now: boundAt.Add(time.Minute),
	}); !errors.Is(err, execution.ErrWorkflowStartExecutionBindingConflict) {
		t.Fatalf("conflicting Temporal Run ID error = %v, want binding conflict", err)
	}
	stored, err := store.GetWorkflowStartIntent(ctx, request.Run.RequestID)
	if err != nil || stored.TemporalRunID != "temporal-bound" {
		t.Fatalf("immutable stored binding = %#v, err=%v", stored, err)
	}
}

func TestInMemoryUndispatchedSupersededStartRejectsExecutionBinding(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 2, 2, 3, 0, time.UTC)
	request := atomicRunCreateRequestForTest(now)
	store := NewInMemoryRunProjectionStore()
	if _, err := store.CreateRunWithStartIntent(ctx, request); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RequestRunCancellation(ctx, execution.DurableRunCancellationRequest{
		RequestID: request.Run.RequestID, Reason: "user_requested", Now: now.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.BindSupersededWorkflowStartExecution(ctx, execution.WorkflowStartExecutionBinding{
		RequestID: request.Run.RequestID, WorkflowID: request.WorkflowID,
		TemporalRunID: "temporal-without-dispatch", Now: now.Add(2 * time.Second),
	}); !errors.Is(err, execution.ErrWorkflowStartExecutionBindingConflict) {
		t.Fatalf("undispatched binding error = %v, want binding conflict", err)
	}
}

func TestInMemoryStartConfirmationRequiresTemporalRunID(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 2, 2, 4, 0, time.UTC)
	request := atomicRunCreateRequestForTest(now)
	if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-lease", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease start intent = %#v, err=%v", leased, err)
	}
	markWorkflowStartDispatchForTest(t, store, leased[0], now.Add(time.Second))
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: "start-lease", Now: now.Add(time.Second),
	}); !errors.Is(err, execution.ErrLifecycleLeaseConflict) {
		t.Fatalf("empty Temporal Run ID confirmation error = %v, want lease conflict", err)
	}
	intent, err := store.GetWorkflowStartIntent(context.Background(), leased[0].RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if intent.State != execution.LifecycleIntentStateLeased || intent.TemporalRunID != "" {
		t.Fatalf("empty Run ID changed start intent = %#v", intent)
	}
}

func TestInMemoryConfirmCreatedStartQueuesRunAndAppendsOrderedEvents(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 3, 2, 3, 0, time.UTC)
	request := atomicRunCreateRequestForTest(now)
	if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "start-lease", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease start intent = %#v, err=%v", leased, err)
	}
	markWorkflowStartDispatchForTest(t, store, leased[0], now.Add(time.Second))
	confirmedAt := now.Add(2 * time.Second)
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: leased[0].LeaseToken, TemporalRunID: "temporal-run-1", Now: confirmedAt,
	}); err != nil {
		t.Fatalf("confirm start intent: %v", err)
	}
	run, err := store.GetRun(context.Background(), leased[0].RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusQueued || !run.QueuedAt.Equal(confirmedAt) {
		t.Fatalf("confirmed run = %#v, want queued at %s", run, confirmedAt)
	}
	intent := store.workflowStartIntents[leased[0].RequestID]
	if intent.State != execution.LifecycleIntentStateConfirmed || intent.TemporalRunID != "temporal-run-1" || intent.LeaseToken != "" || !intent.LeaseUntil.IsZero() {
		t.Fatalf("confirmed intent = %#v", intent)
	}
	events, err := store.ListRunEvents(context.Background(), leased[0].RequestID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 3 || events[0].EventType != execution.DurableRunEventTypeRunCreated ||
		events[1].EventType != execution.DurableRunEventTypeWorkflowStarted || events[2].EventType != execution.DurableRunEventTypeRunQueued {
		t.Fatalf("start event order = %#v", events)
	}
	if !events[1].OccurredAt.Equal(confirmedAt) || !events[2].OccurredAt.Equal(confirmedAt) {
		t.Fatalf("start event timestamps = %s, %s; want %s", events[1].OccurredAt, events[2].OccurredAt, confirmedAt)
	}
	if events[1].Payload["workflow_id"] != request.WorkflowID ||
		events[1].Payload["task_queue"] != request.TaskQueue ||
		events[1].Payload["temporal_run_id"] != "temporal-run-1" {
		t.Fatalf("workflow.started payload = %#v", events[1].Payload)
	}
	// A worker can crash after the durable transaction commits and retry its
	// confirmation. The same confirmation must remain idempotent.
	if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: leased[0].RequestID, LeaseToken: "stale-or-empty", TemporalRunID: "temporal-run-1", Now: confirmedAt.Add(time.Second),
	}); err != nil {
		t.Fatalf("idempotent confirmation: %v", err)
	}
}

func TestInMemoryConfirmQueuedOrCanceledStartDoesNotDuplicateQueueEvents(t *testing.T) {
	tests := []struct {
		name       string
		prepareRun func(*testing.T, *InMemoryRunProjectionStore, time.Time, string)
	}{
		{
			name: "queued",
			prepareRun: func(t *testing.T, store *InMemoryRunProjectionStore, now time.Time, requestID string) {
				if _, err := store.TransitionRun(context.Background(), requestID, execution.DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
					t.Fatal(err)
				}
			},
		},
		{
			name: "canceled",
			prepareRun: func(t *testing.T, store *InMemoryRunProjectionStore, now time.Time, requestID string) {
				if _, err := store.CancelRunProjection(context.Background(), execution.DurableRunCancelRequest{
					RequestID: requestID, Reason: "user_requested", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				// A legacy/stale lease may exist even though new leases are filtered.
				store.mu.Lock()
				intent := store.workflowStartIntents[requestID]
				intent.State = execution.LifecycleIntentStateLeased
				intent.LeaseToken = "start-lease"
				intent.LeaseUntil = now.Add(time.Minute)
				intent.DispatchAttempted = true
				store.workflowStartIntents[requestID] = intent
				store.mu.Unlock()
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 23, 4, 2, 3, 0, time.UTC)
			request := atomicRunCreateRequestForTest(now)
			if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
				t.Fatal(err)
			}
			test.prepareRun(t, store, now, request.Run.RequestID)
			leased, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "start-lease", Now: now.Add(2 * time.Second), LeaseUntil: now.Add(time.Minute), Limit: 1,
			})
			if test.name == "canceled" {
				// The canceled run must not be leased; install the stale lease above
				// only after this assertion path's lease attempt.
				if err != nil || len(leased) != 0 {
					t.Fatalf("canceled start lease = %#v, err=%v", leased, err)
				}
			} else if err != nil || len(leased) != 1 {
				t.Fatalf("queued start lease = %#v, err=%v", leased, err)
			}
			if test.name != "canceled" {
				markWorkflowStartDispatchForTest(t, store, leased[0], now.Add(2*time.Second))
			}
			if err := store.ConfirmWorkflowStartIntent(context.Background(), execution.WorkflowStartIntentResult{
				RequestID: request.Run.RequestID, LeaseToken: "start-lease", TemporalRunID: "temporal-run", Now: now.Add(3 * time.Second),
			}); err != nil {
				t.Fatal(err)
			}
			events, err := store.ListRunEvents(context.Background(), request.Run.RequestID)
			if err != nil {
				t.Fatal(err)
			}
			if test.name == "queued" && len(events) != 1 {
				t.Fatalf("queued confirmation duplicated events: %#v", events)
			}
			if test.name == "canceled" && len(events) != 2 {
				t.Fatalf("canceled confirmation changed events: %#v", events)
			}
		})
	}
}

func TestInMemoryCancellationCommandWinsTerminalArbitrationWithoutChangingActiveStatus(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-cancel-arbitration", "conv-cancel-arbitration", now)
	if _, err := store.TransitionRun(context.Background(), "run-cancel-arbitration", execution.DurableRunStatusQueued, "", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	run, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
		RequestID: "run-cancel-arbitration", Reason: "user_requested", Now: now.Add(2 * time.Second),
	})
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("run status = %q, want queued until cancellation finalizer", run.Status)
	}
	_, err = store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
		RequestID: run.RequestID, TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
		FinalResponseRef: "projection://answer", Now: now.Add(3 * time.Second),
	})
	if !errors.Is(err, execution.ErrDurableRunTerminalConflict) {
		t.Fatalf("completion after cancellation request error = %v", err)
	}
}

func TestInMemoryConfirmedCancellationYieldsToObservedTerminalProjection(t *testing.T) {
	tests := []struct {
		name       string
		wantStatus execution.DurableRunStatus
		finalize   func(*InMemoryRunProjectionStore, string, string, time.Time) (execution.DurableRun, error)
	}{
		{
			name:       "completed",
			wantStatus: execution.DurableRunStatusCompleted,
			finalize: func(store *InMemoryRunProjectionStore, requestID, _ string, now time.Time) (execution.DurableRun, error) {
				if err := storeFinalizationResultForTest(store, requestID, "projection://answer", now); err != nil {
					return execution.DurableRun{}, err
				}
				return store.CompleteRunProjection(context.Background(), execution.DurableRunCompleteRequest{
					RequestID: requestID, TerminalReason: execution.DurableTerminalReasonAnswerCompleted,
					FinalResponseRef: "projection://answer", Now: now,
				})
			},
		},
		{
			name:       "failed",
			wantStatus: execution.DurableRunStatusFailed,
			finalize: func(store *InMemoryRunProjectionStore, requestID, conversationID string, now time.Time) (execution.DurableRun, error) {
				return store.FailRunProjection(context.Background(), execution.DurableRunFailRequest{
					RequestID: requestID, TerminalReason: execution.DurableTerminalReasonProviderUnavailable, Now: now,
					TerminalEvent: failedRunTerminalEventForTest(
						requestID,
						conversationID,
						now,
						map[string]any{"failure_kind": "provider_unavailable", "status": "failed"},
					),
				})
			},
		},
		{
			name:       "expired",
			wantStatus: execution.DurableRunStatusExpired,
			finalize: func(store *InMemoryRunProjectionStore, requestID, _ string, now time.Time) (execution.DurableRun, error) {
				return store.ExpireRunProjection(context.Background(), execution.DurableRunExpireRequest{
					RequestID: requestID,
					Now:       now,
				})
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := NewInMemoryRunProjectionStore()
			now := time.Date(2026, 7, 23, 11, 0, 0, 0, time.UTC)
			requestID := "run-confirmed-cancel-" + test.name
			conversationID := "conv-confirmed-cancel-" + test.name
			createRunProjectionForTest(t, store, requestID, conversationID, now)
			for index, status := range []execution.DurableRunStatus{
				execution.DurableRunStatusQueued,
				execution.DurableRunStatusAdmitted,
				execution.DurableRunStatusRunning,
			} {
				if _, err := store.TransitionRun(
					context.Background(),
					requestID,
					status,
					"",
					now.Add(time.Duration(index+1)*time.Second),
				); err != nil {
					t.Fatalf("transition to %s: %v", status, err)
				}
			}
			if _, err := store.RequestRunCancellation(context.Background(), execution.DurableRunCancellationRequest{
				RequestID: requestID, Reason: "user_requested", Now: now.Add(4 * time.Second),
			}); err != nil {
				t.Fatalf("request cancellation: %v", err)
			}

			if _, err := test.finalize(store, requestID, conversationID, now.Add(5*time.Second)); !errors.Is(err, execution.ErrDurableRunTerminalConflict) {
				t.Fatalf("terminal projection before cancellation confirmation error = %v", err)
			}
			commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
				LeaseToken: "cancel-lease", Now: now.Add(5 * time.Second),
				LeaseUntil: now.Add(time.Minute), Limit: 1,
			})
			if err != nil || len(commands) != 1 {
				t.Fatalf("lease cancellation command = %#v, err=%v", commands, err)
			}
			if err := store.ConfirmRunCancellationCommand(context.Background(), execution.RunCancellationCommandResult{
				RequestID: requestID, LeaseToken: commands[0].LeaseToken, Now: now.Add(6 * time.Second),
			}); err != nil {
				t.Fatalf("confirm cancellation command: %v", err)
			}

			finalized, err := test.finalize(store, requestID, conversationID, now.Add(7*time.Second))
			if err != nil {
				t.Fatalf("terminal projection after cancellation confirmation: %v", err)
			}
			if finalized.Status != test.wantStatus {
				t.Fatalf("terminal status = %q, want %q", finalized.Status, test.wantStatus)
			}
		})
	}
}

func TestInMemoryActiveWorkflowScanOnlyFencesUnresolvedCancellation(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	for _, state := range []execution.LifecycleIntentState{
		execution.LifecycleIntentStatePending,
		execution.LifecycleIntentStateLeased,
		execution.LifecycleIntentStateConfirmed,
	} {
		requestID := "run-cancellation-" + string(state)
		store.runs[requestID] = execution.DurableRun{RequestID: requestID, Status: execution.DurableRunStatusRunning}
		store.workflowStartIntents[requestID] = execution.WorkflowStartIntent{
			RequestID: requestID,
			State:     execution.LifecycleIntentStateConfirmed,
		}
		store.cancellationCommands[requestID] = execution.RunCancellationCommand{
			RequestID: requestID,
			State:     state,
		}
	}

	active, err := store.ListActiveWorkflowRuns(context.Background(), "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(active) != 1 || active[0].Run.RequestID != "run-cancellation-confirmed" {
		t.Fatalf("active workflows = %#v, want only confirmed cancellation", active)
	}
}

func TestInMemoryAgentInvocationReceiptFailsClosedOnAmbiguousReplay(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-1", "conv-agent-receipt", now)
	receipt := execution.AgentInvocationReceipt{
		InvocationID: "run-1:agent-primary", RequestID: "run-1",
		InputSHA256: strings.Repeat("a", 64), CreatedAt: now, UpdatedAt: now,
	}
	_, disposition, err := store.BeginAgentInvocation(context.Background(), receipt)
	if err != nil || disposition != execution.AgentInvocationDispositionClaimed {
		t.Fatalf("first invocation claim disposition=%q err=%v", disposition, err)
	}
	_, disposition, err = store.BeginAgentInvocation(context.Background(), receipt)
	if err != nil || disposition != execution.AgentInvocationDispositionAmbiguous {
		t.Fatalf("ambiguous invocation disposition=%q err=%v", disposition, err)
	}
	receipt.OutputJSON = json.RawMessage(`{"request_id":"run-1","status":"completed"}`)
	receipt.OutputSHA256 = strings.Repeat("b", 64)
	receipt.CompletedAt = now.Add(time.Second)
	receipt.UpdatedAt = receipt.CompletedAt
	if _, err := store.CompleteAgentInvocation(context.Background(), receipt); err != nil {
		t.Fatal(err)
	}
	stored, disposition, err := store.BeginAgentInvocation(context.Background(), receipt)
	if err != nil || disposition != execution.AgentInvocationDispositionReplay || string(stored.OutputJSON) != string(receipt.OutputJSON) {
		t.Fatalf("completed invocation replay=%#v disposition=%q err=%v", stored, disposition, err)
	}
}

func atomicRunCreateRequestForTest(now time.Time) execution.DurableRunCreateIntent {
	return execution.DurableRunCreateIntent{
		Run: execution.DurableRun{
			RequestID: "run-atomic", ConversationID: "conv-atomic", OwnerUserID: "user-atomic",
			Surface: "campus-web", TaskQueue: "campus-agent.workflow.v3",
			Status: execution.DurableRunStatusCreated, CreatedAt: now, UpdatedAt: now,
			Metadata: map[string]any{
				"execution_contract_version": "tool_execution_v7",
				"execution_input_ref":        "app-api://execution-inputs/run-atomic",
				"execution_input_sha256":     strings.Repeat("c", 64),
			},
		},
		RequestFingerprintSHA256: strings.Repeat("a", 64),
		WorkflowID:               "campus-agent.chat.run-atomic", PayloadSHA256: strings.Repeat("a", 64),
		TaskQueue:         "campus-agent.workflow.v3",
		WorkflowInputJSON: json.RawMessage(`{"request_id":"run-atomic"}`),
		CreatedEvent: execution.DurableRunEvent{
			EventID: "run-atomic:run-created", RequestID: "run-atomic", ConversationID: "conv-atomic",
			EventType: execution.DurableRunEventTypeRunCreated, OccurredAt: now,
			Visibility: execution.DurableRunEventVisibilityInternal, PayloadSchemaVersion: "run-event-v1",
			Payload: map[string]any{"status": "created"},
		},
	}
}

func markWorkflowStartDispatchForTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	intent execution.WorkflowStartIntent,
	now time.Time,
) {
	t.Helper()
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), execution.WorkflowStartIntentResult{
		RequestID: intent.RequestID, LeaseToken: intent.LeaseToken, Now: now,
	}); err != nil {
		t.Fatal(err)
	}
}
