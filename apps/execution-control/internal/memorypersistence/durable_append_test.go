package memorypersistence

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/stretchr/testify/require"
)

func TestDurableAppendBlocksEraseAndResumesAfterGenerationChange(t *testing.T) {
	store := NewInMemoryStateStore()
	ctx := context.Background()
	require.NoError(t, store.BeginCall(ctx, "owner", "request:append", 1, "append", 0))
	store.mu.Lock()
	store.fences["owner"] = memoryruntime.FenceState{Generation: 2, Lifecycle: "erased"}
	store.mu.Unlock()
	// A zero expiry must not be treated as an expired lease.
	drained, err := store.GenerationDrained(ctx, "owner", 1)
	require.NoError(t, err)
	require.False(t, drained)
	require.ErrorIs(t, store.MarkOwnerDeleted(ctx, "owner"), memoryruntime.ErrMemoryOwnerNotDrained)
	require.NoError(t, store.BeginCall(ctx, "owner", "request:append", 1, "append", 0))
	require.ErrorIs(t, store.BeginCall(ctx, "owner", "new:append", 1, "append", 0), memoryruntime.ErrMemoryFenceConflict)
	require.ErrorIs(t, store.BeginCall(ctx, "other", "request:append", 1, "append", 0), memoryruntime.ErrMemoryFenceConflict)
	require.NoError(t, store.EndCall(ctx, "owner", "request:append"))
	drained, err = store.GenerationDrained(ctx, "owner", 1)
	require.NoError(t, err)
	require.True(t, drained)
}

func TestRecallStillExpires(t *testing.T) {
	store := NewInMemoryStateStore()
	require.NoError(t, store.BeginCall(context.Background(), "owner", "recall", 1, "recall", -time.Second))
	drained, err := store.GenerationDrained(context.Background(), "owner", 1)
	require.NoError(t, err)
	require.True(t, drained)
}
