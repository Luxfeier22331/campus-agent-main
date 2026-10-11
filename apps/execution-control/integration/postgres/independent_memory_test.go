//go:build postgres_integration

package postgres_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"github.com/stretchr/testify/require"
)

func testIndependentMemoryDatabase(t *testing.T, h *postgresHarness) {
	ctx := t.Context()
	_, source := h.ownerDatabase(t)
	requireSchema(t, source)
	name := h.createDatabase(t, "memory_service")
	target := h.databaseURL(t, name, "memory_service", "memory-integration-password")
	requireSchema(t, target, "memory")
	old, err := memorypersistence.NewPostgresStateStore(ctx, memorypersistence.PostgresStateStoreOptions{DatabaseURL: source})
	require.NoError(t, err)
	defer old.Close()
	require.NoError(t, old.BeginCall(ctx, "owner", "append-old", 1, "append", 0))
	require.ErrorContains(t, memorypersistence.CopyDrainedState(ctx, source, target), "drained")
	require.NoError(t, old.EndCall(ctx, "owner", "append-old"))
	require.NoError(t, memorypersistence.CopyDrainedState(ctx, source, target))
	require.ErrorContains(t, memorypersistence.CopyDrainedState(ctx, source, target), "empty")
	store, err := memorypersistence.NewPostgresStateStore(ctx, memorypersistence.PostgresStateStoreOptions{DatabaseURL: target, Schema: "memory"})
	require.NoError(t, err)
	defer store.Close()
	require.NoError(t, store.HealthCheck(ctx))
	require.NoError(t, store.BeginCall(ctx, "owner", "new-read", 1, "recall", time.Minute))
	require.NoError(t, store.EndCall(ctx, "owner", "new-read"))
	request := memoryruntime.DurableRequest{ID: "first", Kind: "command", OwnerHash: "owner", Payload: json.RawMessage(`{"owner_sequence":1,"value":"first"}`)}
	accepted, err := store.AcceptRequest(ctx, request)
	require.NoError(t, err)
	require.Equal(t, "accepted", accepted.State)
	_, err = store.AcceptRequest(ctx, request)
	require.NoError(t, err)
	conflict := request
	conflict.Payload = json.RawMessage(`{"owner_sequence":1,"value":"different"}`)
	_, err = store.AcceptRequest(ctx, conflict)
	require.ErrorIs(t, err, memoryruntime.ErrRequestConflict)
	next := request
	next.ID = "second"
	next.Payload = json.RawMessage(`{"owner_sequence":2}`)
	_, err = store.AcceptRequest(ctx, next)
	require.NoError(t, err)
	ready, err := store.CommandReady(ctx, next.ID)
	require.NoError(t, err)
	require.False(t, ready)
	pending, err := store.PendingRequests(ctx, 10)
	require.NoError(t, err)
	require.Len(t, pending, 2)
	require.NoError(t, store.MarkDispatched(ctx, request.ID))
	require.NoError(t, store.SaveRequestProgress(ctx, request.ID, "succeeded", map[string]string{"status": "succeeded"}))
	require.NoError(t, store.ClearRequestInput(ctx, request.ID))
	ready, err = store.CommandReady(ctx, next.ID)
	require.NoError(t, err)
	require.True(t, ready)
	replay, err := store.AcceptRequest(ctx, request)
	require.NoError(t, err)
	require.Equal(t, "succeeded", replay.State)
	saved, err := store.GetRequest(ctx, request.ID)
	require.NoError(t, err)
	require.Empty(t, saved.Payload)
	// A fresh service instance resumes solely from its own database.
	reopened, err := memorypersistence.NewPostgresStateStore(ctx, memorypersistence.PostgresStateStoreOptions{DatabaseURL: target, Schema: "memory"})
	require.NoError(t, err)
	defer reopened.Close()
	pending, err = reopened.PendingRequests(ctx, 10)
	require.NoError(t, err)
	require.Len(t, pending, 1)
	require.Equal(t, next.ID, pending[0].ID)
	sourceConn := connect(t, source)
	defer closeConn(t, sourceConn)
	_, err = sourceConn.Exec(ctx, `delete from execution_control.personal_memory_owner_fences`)
	require.NoError(t, err)
	saved, err = reopened.GetRequest(ctx, next.ID)
	require.NoError(t, err)
	require.NotEmpty(t, saved.Payload)
	command := exec.CommandContext(ctx, "go", "test", "./apps/memory-service/internal/memoryworkflow", "-run", "TestEraseOrderingPostgres", "-count=1", "-v")
	command.Dir = h.repositoryRoot
	command.Env = append(os.Environ(), "MEMORY_TEST_DATABASE_URL="+target)
	output, err := command.CombinedOutput()
	require.NoError(t, err, string(output))

}

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
