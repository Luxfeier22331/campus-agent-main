package execution

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestInMemoryRunCleanupCreatedAndDeletedWithRun(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 12, 0, 0, 0, time.UTC)
	store := NewInMemoryRunProjectionStore()
	createRunProjectionForTest(t, store, "run-cleanup-create", "conv-cleanup-create", now)
	cleanup, err := store.GetRunCleanup(ctx, "run-cleanup-create")
	if err != nil {
		t.Fatal(err)
	}
	if cleanup.State != LifecycleIntentStatePending || cleanup.RunID != "run-cleanup-create" ||
		!cleanup.NextAttemptAt.Equal(now) || !cleanup.CreatedAt.Equal(now) || !cleanup.UpdatedAt.Equal(now) {
		t.Fatalf("plain run cleanup = %#v", cleanup)
	}
	if err := store.DeleteRun(ctx, "run-cleanup-create"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetRunCleanup(ctx, "run-cleanup-create"); !errors.Is(err, ErrLifecycleLeaseConflict) {
		t.Fatalf("deleted run cleanup error = %v, want lifecycle conflict", err)
	}

	atomicStore := NewInMemoryRunProjectionStore()
	request := atomicRunCreateRequestForTest(now.Add(time.Minute))
	if _, err := atomicStore.CreateRunWithStartIntent(ctx, request); err != nil {
		t.Fatal(err)
	}
	cleanup, err = atomicStore.GetRunCleanup(ctx, request.Run.RunID)
	if err != nil || cleanup.State != LifecycleIntentStatePending || !cleanup.CreatedAt.Equal(request.Run.CreatedAt) {
		t.Fatalf("atomic run cleanup = %#v, err=%v", cleanup, err)
	}
}

func TestInMemoryRunCleanupLeaseRequiresTerminalResolvedStart(t *testing.T) {
	tests := []struct {
		name       string
		prepare    func(*testing.T, *InMemoryRunProjectionStore, DurableRunCreateIntent, time.Time)
		wantLeased bool
	}{
		{
			name: "pending start",
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				cancelRunForCleanupTest(t, store, request.Run.RunID, now)
			},
		},
		{
			name: "leased start",
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				leaseStartForCleanupTest(t, store, "start-lease", now)
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(time.Second))
			},
		},
		{
			name:       "confirmed execution",
			wantLeased: true,
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				start := leaseStartForCleanupTest(t, store, "start-lease", now)
				markStartDispatchForCleanupTest(t, store, start, now)
				if err := store.ConfirmWorkflowStartIntent(context.Background(), WorkflowStartIntentResult{
					RunID: start.RunID, LeaseToken: start.LeaseToken, TemporalRunID: "temporal-run-cleanup", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
			},
		},
		{
			name:       "permanent start failure proven not dispatched",
			wantLeased: true,
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				start := leaseStartForCleanupTest(t, store, "start-lease", now)
				if err := store.FailWorkflowStartIntent(context.Background(), WorkflowStartIntentResult{
					RunID: start.RunID, LeaseToken: start.LeaseToken,
					ErrorCode: "workflow_start_not_dispatched_invalid", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
			},
		},
		{
			name: "permanent local failure after a dispatch attempt",
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				start := leaseStartForCleanupTest(t, store, "start-lease", now)
				markStartDispatchForCleanupTest(t, store, start, now)
				if err := store.FailWorkflowStartIntent(context.Background(), WorkflowStartIntentResult{
					RunID: start.RunID, LeaseToken: start.LeaseToken,
					ErrorCode: "workflow_start_not_dispatched_invalid", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
			},
		},
		{
			name: "permanent start failure without dispatch proof",
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				start := leaseStartForCleanupTest(t, store, "start-lease", now)
				if err := store.FailWorkflowStartIntent(context.Background(), WorkflowStartIntentResult{
					RunID: start.RunID, LeaseToken: start.LeaseToken,
					ErrorCode: "workflow_start_remote_identity_conflict", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
			},
		},
		{
			name:       "superseded before first start attempt",
			wantLeased: true,
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				if _, err := store.RequestRunCancellation(context.Background(), DurableRunCancellationRequest{
					RunID: request.Run.RunID, Reason: "user_requested", Now: now,
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(time.Second))
			},
		},
		{
			name:       "superseded after lease but before dispatch",
			wantLeased: true,
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				leaseStartForCleanupTest(t, store, "start-lease", now)
				if _, err := store.RequestRunCancellation(context.Background(), DurableRunCancellationRequest{
					RunID: request.Run.RunID, Reason: "user_requested", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
			},
		},
		{
			name: "superseded after dispatch attempt",
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				start := leaseStartForCleanupTest(t, store, "start-lease", now)
				markStartDispatchForCleanupTest(t, store, start, now)
				if _, err := store.RequestRunCancellation(context.Background(), DurableRunCancellationRequest{
					RunID: request.Run.RunID, Reason: "user_requested", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
			},
		},
		{
			name:       "superseded dispatched execution with exact binding",
			wantLeased: true,
			prepare: func(t *testing.T, store *InMemoryRunProjectionStore, request DurableRunCreateIntent, now time.Time) {
				start := leaseStartForCleanupTest(t, store, "start-lease", now)
				markStartDispatchForCleanupTest(t, store, start, now)
				if _, err := store.RequestRunCancellation(context.Background(), DurableRunCancellationRequest{
					RunID: request.Run.RunID, Reason: "user_requested", Now: now.Add(time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				if _, err := store.BindSupersededWorkflowStartExecution(context.Background(), WorkflowStartExecutionBinding{
					RunID: request.Run.RunID, WorkflowID: request.WorkflowID,
					TemporalRunID: "temporal-run-superseded", Now: now.Add(2 * time.Second),
				}); err != nil {
					t.Fatal(err)
				}
				cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(3*time.Second))
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			now := time.Date(2026, 7, 23, 13, 0, 0, 0, time.UTC)
			store := NewInMemoryRunProjectionStore()
			request := atomicRunCreateRequestForTest(now)
			if _, err := store.CreateRunWithStartIntent(ctx, request); err != nil {
				t.Fatal(err)
			}
			test.prepare(t, store, request, now.Add(time.Second))
			leased, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
				LeaseToken: "cleanup-lease", Now: now.Add(time.Minute),
				LeaseUntil: now.Add(2 * time.Minute), Limit: 1,
			})
			if err != nil {
				t.Fatal(err)
			}
			if got := len(leased) == 1; got != test.wantLeased {
				t.Fatalf("cleanup leased=%v records=%#v, want %v", got, leased, test.wantLeased)
			}
		})
	}
}

func TestInMemoryRunCleanupLeaseExpiryRetryAndTokenFencing(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 14, 0, 0, 0, time.UTC)
	store, runID := confirmedTerminalCleanupStoreForTest(t, now)
	first, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
		LeaseToken: "cleanup-first", Now: now.Add(10 * time.Second),
		LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(first) != 1 || first[0].AttemptCount != 1 {
		t.Fatalf("first cleanup lease = %#v, err=%v", first, err)
	}
	if leased, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
		LeaseToken: "cleanup-early", Now: now.Add(30 * time.Second),
		LeaseUntil: now.Add(2 * time.Minute), Limit: 1,
	}); err != nil || len(leased) != 0 {
		t.Fatalf("unexpired cleanup re-lease = %#v, err=%v", leased, err)
	}
	second, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
		LeaseToken: "cleanup-second", Now: now.Add(time.Minute),
		LeaseUntil: now.Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(second) != 1 || second[0].AttemptCount != 2 {
		t.Fatalf("expired cleanup lease = %#v, err=%v", second, err)
	}
	if err := store.RetryRunCleanup(ctx, RunCleanupResult{
		RunID: runID, LeaseToken: "cleanup-first", Now: now.Add(time.Minute),
		NextAttemptAt: now.Add(3 * time.Minute), ErrorCode: "stale",
	}); !errors.Is(err, ErrLifecycleLeaseConflict) {
		t.Fatalf("stale cleanup retry error = %v, want lifecycle conflict", err)
	}
	nextAttemptAt := now.Add(3 * time.Minute)
	if err := store.RetryRunCleanup(ctx, RunCleanupResult{
		RunID: runID, LeaseToken: "cleanup-second", Now: now.Add(time.Minute),
		NextAttemptAt: nextAttemptAt, ErrorCode: "payload_delete_failed",
	}); err != nil {
		t.Fatal(err)
	}
	if leased, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
		LeaseToken: "cleanup-too-soon", Now: nextAttemptAt.Add(-time.Second),
		LeaseUntil: nextAttemptAt.Add(time.Minute), Limit: 1,
	}); err != nil || len(leased) != 0 {
		t.Fatalf("cleanup before retry time = %#v, err=%v", leased, err)
	}
	third, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
		LeaseToken: "cleanup-third", Now: nextAttemptAt,
		LeaseUntil: nextAttemptAt.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(third) != 1 || third[0].AttemptCount != 3 {
		t.Fatalf("retried cleanup lease = %#v, err=%v", third, err)
	}
	if err := store.ConfirmRunCleanup(ctx, RunCleanupResult{
		RunID: runID, LeaseToken: "wrong-token", Now: nextAttemptAt.Add(time.Second),
	}); !errors.Is(err, ErrLifecycleLeaseConflict) {
		t.Fatalf("wrong-token confirmation error = %v, want lifecycle conflict", err)
	}
	confirmedAt := nextAttemptAt.Add(2 * time.Second)
	if err := store.ConfirmRunCleanup(ctx, RunCleanupResult{
		RunID: runID, LeaseToken: "cleanup-third", Now: confirmedAt,
	}); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"cleanup-third", "stale-reconciler-token"} {
		if err := store.ConfirmRunCleanup(ctx, RunCleanupResult{
			RunID: runID, LeaseToken: token, Now: confirmedAt.Add(time.Minute),
		}); err != nil {
			t.Fatalf("idempotent confirmation token %q: %v", token, err)
		}
	}
	cleanup, err := store.GetRunCleanup(ctx, runID)
	if err != nil || cleanup.State != LifecycleIntentStateConfirmed || cleanup.AttemptCount != 3 ||
		cleanup.LeaseToken != "" || !cleanup.LeaseUntil.IsZero() || cleanup.LastErrorCode != "" ||
		!cleanup.ConfirmedAt.Equal(confirmedAt) {
		t.Fatalf("confirmed cleanup = %#v, err=%v", cleanup, err)
	}
}

func TestInMemoryRunCleanupConfirmationRequiresLease(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 15, 0, 0, 0, time.UTC)
	store := NewInMemoryRunProjectionStore()
	createRunProjectionForTest(t, store, "run-cleanup-direct", "conv-cleanup-direct", now)
	cancelRunForCleanupTest(t, store, "run-cleanup-direct", now.Add(2*time.Second))
	if err := store.ConfirmRunCleanup(ctx, RunCleanupResult{
		RunID: "run-cleanup-direct", Now: now.Add(3 * time.Second),
	}); !errors.Is(err, ErrLifecycleLeaseConflict) {
		t.Fatalf("tokenless confirmation error = %v, want lifecycle conflict", err)
	}
	if err := store.ConfirmRunCleanup(ctx, RunCleanupResult{
		RunID: "run-cleanup-direct", LeaseToken: "not-leased", Now: now.Add(3 * time.Second),
	}); !errors.Is(err, ErrLifecycleLeaseConflict) {
		t.Fatalf("unleased confirmation error = %v, want lifecycle conflict", err)
	}
}

func TestInMemoryTerminalRunCanReLeaseExpiredStartForRetirement(t *testing.T) {
	ctx := context.Background()
	now := time.Date(2026, 7, 23, 16, 0, 0, 0, time.UTC)
	store := NewInMemoryRunProjectionStore()
	request := atomicRunCreateRequestForTest(now)
	if _, err := store.CreateRunWithStartIntent(ctx, request); err != nil {
		t.Fatal(err)
	}
	initial, err := store.LeaseWorkflowStartIntents(ctx, LifecycleLeaseRequest{
		LeaseToken: "start-before-failure", Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(initial) != 1 {
		t.Fatalf("initial start lease = %#v, err=%v", initial, err)
	}
	failedAt := now.Add(time.Second)
	if _, err := store.FailRunProjection(ctx, DurableRunFailRequest{
		RunID: request.Run.RunID, TerminalReason: DurableTerminalReasonRuntimeInvariant, Now: failedAt,
		TerminalEvent: failedRunTerminalEventForTest(
			request.Run.RunID,
			request.Run.ConversationID,
			failedAt,
			map[string]any{"failure_kind": "workflow_start_not_dispatched_invalid", "status": "failed"},
		),
	}); err != nil {
		t.Fatal(err)
	}
	if leased, err := store.LeaseWorkflowStartIntents(ctx, LifecycleLeaseRequest{
		LeaseToken: "start-too-early", Now: now.Add(30 * time.Second),
		LeaseUntil: now.Add(2 * time.Minute), Limit: 1,
	}); err != nil || len(leased) != 0 {
		t.Fatalf("unexpired terminal start lease = %#v, err=%v", leased, err)
	}
	recovered, err := store.LeaseWorkflowStartIntents(ctx, LifecycleLeaseRequest{
		LeaseToken: "start-retirement", Now: now.Add(time.Minute),
		LeaseUntil: now.Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(recovered) != 1 || recovered[0].AttemptCount != 2 {
		t.Fatalf("terminal start retirement lease = %#v, err=%v", recovered, err)
	}
	if err := store.FailWorkflowStartIntent(ctx, WorkflowStartIntentResult{
		RunID: request.Run.RunID, LeaseToken: "start-retirement",
		ErrorCode: "workflow_start_not_dispatched_invalid", Now: now.Add(time.Minute),
	}); err != nil {
		t.Fatal(err)
	}
	start, err := store.GetWorkflowStartIntent(ctx, request.Run.RunID)
	if err != nil || start.State != LifecycleIntentStatePermanentFailed || start.TemporalRunID != "" {
		t.Fatalf("retired terminal start = %#v, err=%v", start, err)
	}
	cleanups, err := store.LeaseRunCleanups(ctx, LifecycleLeaseRequest{
		LeaseToken: "cleanup-after-retirement", Now: now.Add(2 * time.Minute),
		LeaseUntil: now.Add(3 * time.Minute), Limit: 1,
	})
	if err != nil || len(cleanups) != 1 {
		t.Fatalf("cleanup after start retirement = %#v, err=%v", cleanups, err)
	}
}

func TestPostgresRunCleanupSchemaAndLeaseSQL(t *testing.T) {
	for _, snippet := range []string{
		"create table if not exists runtime.agent_run_cleanups",
		"dispatch_attempted boolean not null default false",
		"add column if not exists dispatch_attempted boolean not null default true",
		"alter column dispatch_attempted set default false",
		"confirmed_at timestamptz",
		"insert into runtime.agent_run_cleanups",
		"from runtime.agent_runs as runs",
		"on conflict (run_id) do nothing",
		"create index if not exists agent_run_cleanups_lease_idx",
	} {
		if !strings.Contains(runProjectionSchemaSQL, snippet) {
			t.Fatalf("run cleanup schema missing %q", snippet)
		}
	}
	for _, snippet := range []string{
		"runs.status in ('completed', 'failed', 'canceled', 'expired')",
		"starts.state = 'confirmed' and btrim(starts.temporal_run_id) <> ''",
		"starts.state = 'permanent_failed' and not starts.dispatch_attempted",
		"starts.last_error_code = 'workflow_start_not_dispatched_invalid'",
		"starts.state = 'superseded' and not starts.dispatch_attempted",
		"starts.state = 'superseded' and starts.dispatch_attempted",
		"cleanups.state = 'leased' and cleanups.lease_until <= $1",
		"for update of cleanups skip locked",
	} {
		if !strings.Contains(runCleanupLeaseSQL, snippet) {
			t.Fatalf("run cleanup lease SQL missing %q", snippet)
		}
	}
}

func confirmedTerminalCleanupStoreForTest(
	t *testing.T,
	now time.Time,
) (*InMemoryRunProjectionStore, string) {
	t.Helper()
	store := NewInMemoryRunProjectionStore()
	request := atomicRunCreateRequestForTest(now)
	if _, err := store.CreateRunWithStartIntent(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	start := leaseStartForCleanupTest(t, store, "start-confirm", now)
	markStartDispatchForCleanupTest(t, store, start, now)
	if err := store.ConfirmWorkflowStartIntent(context.Background(), WorkflowStartIntentResult{
		RunID: start.RunID, LeaseToken: start.LeaseToken,
		TemporalRunID: "temporal-run-cleanup", Now: now.Add(time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	cancelRunForCleanupTest(t, store, request.Run.RunID, now.Add(2*time.Second))
	return store, request.Run.RunID
}

func leaseStartForCleanupTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	leaseToken string,
	now time.Time,
) WorkflowStartIntent {
	t.Helper()
	leased, err := store.LeaseWorkflowStartIntents(context.Background(), LifecycleLeaseRequest{
		LeaseToken: leaseToken, Now: now, LeaseUntil: now.Add(time.Minute), Limit: 1,
	})
	if err != nil || len(leased) != 1 {
		t.Fatalf("lease workflow start = %#v, err=%v", leased, err)
	}
	return leased[0]
}

func markStartDispatchForCleanupTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	start WorkflowStartIntent,
	now time.Time,
) {
	t.Helper()
	if err := store.MarkWorkflowStartDispatchAttempt(context.Background(), WorkflowStartIntentResult{
		RunID: start.RunID, LeaseToken: start.LeaseToken, Now: now,
	}); err != nil {
		t.Fatal(err)
	}
}

func cancelRunForCleanupTest(
	t *testing.T,
	store *InMemoryRunProjectionStore,
	runID string,
	now time.Time,
) {
	t.Helper()
	if _, err := store.CancelRunProjection(context.Background(), DurableRunCancelRequest{
		RunID: runID, Reason: "user_requested", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
}
