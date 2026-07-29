package execution

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestInMemoryDeleteRunRemovesProtectedPayloads(t *testing.T) {
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 1, 2, 3, 0, time.UTC)
	run := DurableRun{
		RunID:          "run-protected-delete",
		ConversationID: "conversation-protected-delete",
		TurnID:         "turn-protected-delete",
		RequestID:      "request-protected-delete",
		TraceID:        "trace-protected-delete",
		OwnerUserID:    "user-protected-delete",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow.v3",
		Status:         DurableRunStatusCreated,
		CreatedAt:      now,
		UpdatedAt:      now,
		Metadata: map[string]any{
			"execution_contract_version": "tool_execution_v5",
			"execution_input_ref":        "app-api://execution-inputs/run-protected-delete",
			"execution_input_sha256":     strings.Repeat("a", 64),
		},
	}
	if _, err := store.CreateRun(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutProtectedPayload(context.Background(), ProtectedPayload{
		RunID:         run.RunID,
		PayloadRef:    "projection://runs/run-protected-delete/agent/primary/result",
		Kind:          "agent_result_v1",
		Ciphertext:    []byte("encrypted"),
		PayloadSHA256: strings.Repeat("b", 64),
		CreatedAt:     now,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteRun(context.Background(), run.RunID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.GetProtectedPayload(context.Background(), run.RunID, "projection://runs/run-protected-delete/agent/primary/result", "agent_result_v1"); err == nil {
		t.Fatal("protected payload remained after deleting run")
	}
}

func TestInMemoryProtectedPayloadIsImmutableAndRejectsClosedRunWrites(t *testing.T) {
	ctx := context.Background()
	store := NewInMemoryRunProjectionStore()
	now := time.Date(2026, 7, 23, 2, 2, 3, 0, time.UTC)
	createRunProjectionForTest(t, store, "run-protected-immutable", "conv-protected-immutable", now)
	payload := ProtectedPayload{
		RunID:         "run-protected-immutable",
		PayloadRef:    "projection://runs/run-protected-immutable/agent/primary/result",
		Kind:          "agent_result_v1",
		Ciphertext:    []byte("encrypted-first"),
		PayloadSHA256: strings.Repeat("b", 64),
		CreatedAt:     now,
	}
	stored, err := store.PutProtectedPayload(ctx, payload)
	if err != nil {
		t.Fatal(err)
	}
	replay := payload
	replay.Ciphertext = []byte("encrypted-retry-with-new-nonce")
	replay.CreatedAt = now.Add(time.Second)
	storedReplay, err := store.PutProtectedPayload(ctx, replay)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(storedReplay.Ciphertext, stored.Ciphertext) || !storedReplay.CreatedAt.Equal(stored.CreatedAt) {
		t.Fatalf("same-hash replay rewrote immutable payload: first=%#v replay=%#v", stored, storedReplay)
	}
	conflict := payload
	conflict.PayloadSHA256 = strings.Repeat("c", 64)
	if _, err := store.PutProtectedPayload(ctx, conflict); !errors.Is(err, ErrProtectedPayloadConflict) {
		t.Fatalf("different-hash replay error = %v, want protected payload conflict", err)
	}
	if _, err := store.CancelRunProjection(ctx, DurableRunCancelRequest{
		RunID: payload.RunID, Reason: "cleanup_test", Now: now.Add(2 * time.Second),
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteProtectedPayloads(ctx, payload.RunID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutProtectedPayload(ctx, payload); !errors.Is(err, ErrProtectedPayloadRunClosed) {
		t.Fatalf("closed-run payload write error = %v, want closed-run fence", err)
	}
	if _, err := store.GetProtectedPayload(ctx, payload.RunID, payload.PayloadRef, payload.Kind); !errors.Is(err, ErrProtectedPayloadNotFound) {
		t.Fatalf("protected payload resurrected after cleanup: %v", err)
	}
}

func TestInMemoryProtectedPayloadPutVersusTerminalTransitionCannotResurrect(t *testing.T) {
	ctx := context.Background()
	for index := range 32 {
		store := NewInMemoryRunProjectionStore()
		now := time.Date(2026, 7, 23, 3, 2, index, 0, time.UTC)
		runID := fmt.Sprintf("run-protected-race-%02d", index)
		createRunProjectionForTest(t, store, runID, "conv-"+runID, now)
		payload := ProtectedPayload{
			RunID: runID, PayloadRef: "projection://" + runID, Kind: "agent_result_v1",
			Ciphertext: []byte("encrypted"), PayloadSHA256: strings.Repeat("d", 64), CreatedAt: now,
		}
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		var putErr, terminalErr error
		go func() {
			defer wg.Done()
			<-start
			_, putErr = store.PutProtectedPayload(ctx, payload)
		}()
		go func() {
			defer wg.Done()
			<-start
			_, terminalErr = store.CancelRunProjection(ctx, DurableRunCancelRequest{
				RunID: runID, Reason: "cleanup_test", Now: now.Add(time.Second),
			})
		}()
		close(start)
		wg.Wait()
		if terminalErr != nil {
			t.Fatal(terminalErr)
		}
		if putErr != nil && !errors.Is(putErr, ErrProtectedPayloadRunClosed) {
			t.Fatalf("concurrent payload write error = %v", putErr)
		}
		if err := store.DeleteProtectedPayloads(ctx, runID); err != nil {
			t.Fatal(err)
		}
		if _, err := store.PutProtectedPayload(ctx, payload); !errors.Is(err, ErrProtectedPayloadRunClosed) {
			t.Fatalf("late payload write error = %v, want closed-run fence", err)
		}
		if _, err := store.GetProtectedPayload(ctx, runID, payload.PayloadRef, payload.Kind); !errors.Is(err, ErrProtectedPayloadNotFound) {
			t.Fatalf("iteration %d resurrected payload: %v", index, err)
		}
	}
}
