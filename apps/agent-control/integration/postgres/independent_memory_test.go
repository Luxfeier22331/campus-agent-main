//go:build postgres_integration

package postgres_test

import (
	"encoding/json"
	memoryruntime "github.com/MUC-WIKI/campus-agent/packages/memory-api-go"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

func testRuntimeMemoryDelivery(t *testing.T, h *postgresHarness) {
	_, url := h.ownerDatabase(t)
	store := newRunProjectionStore(t, url, true)
	now := time.Now().UTC()
	run := createPostgresFinalizationRun(t, store, "runtime-memory-delivery", now)
	ctx := t.Context()
	payload := json.RawMessage(`{"continuation":["first"]}`)
	require.NoError(t, store.PutRuntimePayload(ctx, run.RequestID, "turn", payload))
	require.NoError(t, store.PutRuntimePayload(ctx, run.RequestID, "turn", payload))
	require.Error(t, store.PutRuntimePayload(ctx, run.RequestID, "turn", json.RawMessage(`{"continuation":["different"]}`)))
	saved, err := store.GetRuntimePayload(ctx, run.RequestID, "turn")
	require.NoError(t, err)
	require.JSONEq(t, string(payload), string(saved))
	request := memoryruntime.AppendConversationTurnRequest{RequestID: run.RequestID, UserID: run.OwnerUserID, UserMessage: "remember this"}
	require.NoError(t, store.PrepareMemoryDelivery(ctx, run.OwnerUserID, request))
	pending, err := store.PendingMemoryDeliveries(ctx)
	require.NoError(t, err)
	require.Empty(t, pending)
	finalization := postgresFinalizationRequest(run, strings.Repeat("a", 64), "runtime", now.Add(time.Second))
	_, err = store.FinalizeRunProjection(ctx, finalization)
	require.NoError(t, err)
	pending, err = store.PendingMemoryDeliveries(ctx)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	require.Equal(t, request, pending[0])
	require.NoError(t, store.AcknowledgeMemoryDelivery(ctx, run.RequestID))
	require.NoError(t, store.PrepareMemoryDelivery(ctx, run.OwnerUserID, request))
	_, err = store.FinalizeRunProjection(ctx, finalization)
	require.NoError(t, err)
	pending, err = store.PendingMemoryDeliveries(ctx)
	require.NoError(t, err)
	require.Empty(t, pending)
}
