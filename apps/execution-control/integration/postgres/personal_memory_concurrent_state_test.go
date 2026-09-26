//go:build postgres_integration

package postgres_test

import (
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/stretchr/testify/require"
)

// testPersonalMemoryConcurrentStateStore covers the multi-instance races the
// sequential state store tests cannot observe. The mutual exclusion point for
// concurrent execution-control instances is the fence row lock taken by every
// store method, so each scenario asserts the invariant that must hold for every
// interleaving instead of a fixed ordering.
func testPersonalMemoryConcurrentStateStore(t *testing.T, harness *postgresHarness) {
	_, databaseURL := harness.ownerDatabase(t)
	requireSchema(t, databaseURL)
	store, err := memorypersistence.NewPostgresStateStore(t.Context(), memorypersistence.PostgresStateStoreOptions{
		DatabaseURL: databaseURL,
	})
	if err != nil {
		t.Fatalf("create personal memory state store: %v", err)
	}
	t.Cleanup(store.Close)
	eraseCommand := memoryruntime.PersonalMemoryCommandRequest{
		CommandID:         "cmd-concurrent-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-09-26T00:00:00Z",
		SupersessionScope: "owner:erase:2",
	}
	t.Run("duplicate erase admission executes once", func(t *testing.T) {
		ctx := t.Context()
		const owner = "concurrent-erase-owner"
		type beginResult struct {
			receipt memoryruntime.CommandReceipt
			execute bool
			err     error
		}
		results := make(chan beginResult, 2)
		start := make(chan struct{})
		var workers sync.WaitGroup
		for i := 0; i < 2; i++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				<-start
				receipt, execute, err := store.BeginCommand(ctx, owner, eraseCommand, time.Minute)
				results <- beginResult{receipt: receipt, execute: execute, err: err}
			}()
		}
		close(start)
		workers.Wait()
		close(results)
		executed := 0
		observed := 0
		for result := range results {
			require.NoError(t, result.err)
			require.Equal(t, eraseCommand.CommandID, result.receipt.CommandID)
			if result.execute {
				executed++
				continue
			}
			observed++
			require.Equal(t, "processing", result.receipt.Status)
		}
		require.Equal(t, 1, executed)
		require.Equal(t, 1, observed)
	})
	t.Run("concurrent owner deletion stays idempotent", func(t *testing.T) {
		ctx := t.Context()
		const owner = "concurrent-delete-owner"
		outcomes := make(chan error, 2)
		start := make(chan struct{})
		var workers sync.WaitGroup
		for i := 0; i < 2; i++ {
			workers.Add(1)
			go func() {
				defer workers.Done()
				<-start
				outcomes <- store.MarkOwnerDeleted(ctx, owner)
			}()
		}
		close(start)
		workers.Wait()
		close(outcomes)
		for err := range outcomes {
			require.NoError(t, err)
		}
		require.ErrorIs(t, store.BeginCall(ctx, owner, "post-delete-recall", 1, "recall", time.Minute), memoryruntime.ErrMemoryFenceConflict)
		require.ErrorIs(t, store.BeginCall(ctx, owner, "post-delete-recall-2", 2, "recall", time.Minute), memoryruntime.ErrMemoryFenceConflict)
	})
	t.Run("new call never crosses a committed deletion", func(t *testing.T) {
		ctx := t.Context()
		const owner = "concurrent-race-owner"
		deleteErr := make(chan error, 1)
		callErr := make(chan error, 1)
		start := make(chan struct{})
		go func() {
			<-start
			deleteErr <- store.MarkOwnerDeleted(ctx, owner)
		}()
		go func() {
			<-start
			callErr <- store.BeginCall(ctx, owner, "racing-recall", 1, "recall", time.Minute)
		}()
		close(start)
		deletion := <-deleteErr
		call := <-callErr
		if call == nil {
			// The call was admitted first, so its active lease must hold the
			// deletion at the drain barrier; the retry after the call ends
			// then completes the deletion.
			require.ErrorIs(t, deletion, memoryruntime.ErrMemoryOwnerNotDrained)
			require.NoError(t, store.EndCall(ctx, owner, "racing-recall"))
			require.NoError(t, store.MarkOwnerDeleted(ctx, owner))
		} else {
			// The deletion committed first, so the call must be fenced out.
			require.NoError(t, deletion)
			require.ErrorIs(t, call, memoryruntime.ErrMemoryFenceConflict)
		}
		require.ErrorIs(t, store.BeginCall(ctx, owner, "after-race-recall", 1, "recall", time.Minute), memoryruntime.ErrMemoryFenceConflict)
	})
}
