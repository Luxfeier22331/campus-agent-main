package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/protectedpayload"
)

func TestProtectedPayloadUsesEnvelopeKeyIDAcrossRotation(t *testing.T) {
	previousKey := protectedPayloadTestKey(1)
	currentKey := protectedPayloadTestKey(65)
	previousRing := mustProtectedPayloadTestKeyring(t, "key-2026-06", map[string][]byte{
		"key-2026-06": previousKey,
	})
	server, store, run := protectedPayloadTestServer(t, previousRing)
	server.config.AppAPIExecutionInputSharedSecret = "input-auth-secret-before-rotation"
	payloadRef := temporalProjectionRef(run.RunID, "agent/primary/result")
	want := map[string]any{"answer": "private answer", "run_id": run.RunID}
	if err := server.putProtectedJSON(
		context.Background(),
		run,
		payloadRef,
		protectedPayloadKindAgentResult,
		want,
	); err != nil {
		t.Fatal(err)
	}

	stored, err := store.GetProtectedPayload(
		context.Background(),
		run.RunID,
		payloadRef,
		protectedPayloadKindAgentResult,
	)
	if err != nil {
		t.Fatal(err)
	}
	var envelope protectedPayloadEnvelope
	if err := json.Unmarshal(stored.Ciphertext, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.KeyID != "key-2026-06" {
		t.Fatalf("envelope key_id = %q, want previous active key", envelope.KeyID)
	}

	server.config.ProtectedPayloadKeyring = mustProtectedPayloadTestKeyring(t, "key-2026-07", map[string][]byte{
		"key-2026-06": previousKey,
		"key-2026-07": currentKey,
	})
	server.config.AppAPIExecutionInputSharedSecret = "input-auth-secret-after-rotation"
	var got map[string]any
	if err := server.getProtectedJSON(
		context.Background(),
		run,
		payloadRef,
		protectedPayloadKindAgentResult,
		&got,
	); err != nil {
		t.Fatalf("read previous-key payload after active/auth rotation: %v", err)
	}
	if got["answer"] != want["answer"] || got["run_id"] != run.RunID {
		t.Fatalf("decoded protected payload = %#v", got)
	}
}

func TestProtectedPayloadRejectsUnknownEnvelopeKeyWithoutFallback(t *testing.T) {
	key := protectedPayloadTestKey(1)
	keyring := mustProtectedPayloadTestKeyring(t, "key-current", map[string][]byte{
		"key-current": key,
	})
	server, store, run := protectedPayloadTestServer(t, keyring)
	payloadRef := temporalProjectionRef(run.RunID, "agent/primary/invocation")
	if err := server.putProtectedJSON(
		context.Background(),
		run,
		payloadRef,
		protectedPayloadKindAgentInvocation,
		map[string]any{"input": "private provider input"},
	); err != nil {
		t.Fatal(err)
	}

	stored, err := store.GetProtectedPayload(
		context.Background(),
		run.RunID,
		payloadRef,
		protectedPayloadKindAgentInvocation,
	)
	if err != nil {
		t.Fatal(err)
	}
	var envelope protectedPayloadEnvelope
	if err := json.Unmarshal(stored.Ciphertext, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope.KeyID = "key-unknown"
	stored.Ciphertext, err = json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteProtectedPayloads(context.Background(), run.RunID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutProtectedPayload(context.Background(), stored); err != nil {
		t.Fatal(err)
	}

	err = server.getProtectedJSON(
		context.Background(),
		run,
		payloadRef,
		protectedPayloadKindAgentInvocation,
		&map[string]any{},
	)
	if !errors.Is(err, protectedpayload.ErrKeyUnavailable) {
		t.Fatalf("unknown envelope key error = %v", err)
	}
}

func TestProtectedPayloadDoesNotFallbackToExecutionInputSecret(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	run := protectedPayloadTestRun(t, store)
	server := &Server{
		config: config.Config{
			AppAPIExecutionInputSharedSecret: "input-auth-secret-must-not-be-an-encryption-key",
		},
		runProjectionStore: store,
	}
	err := server.putProtectedJSON(
		context.Background(),
		run,
		temporalProjectionRef(run.RunID, "agent/primary/result"),
		protectedPayloadKindAgentResult,
		map[string]any{"answer": "private answer"},
	)
	if err == nil || !strings.Contains(err.Error(), "keyring is not configured") {
		t.Fatalf("missing independent keyring error = %v", err)
	}
}

func TestTemporalActivityServerRequiresProtectedPayloadKeyring(t *testing.T) {
	_, err := NewTemporalActivityServer(config.Config{}, TemporalActivityRuntimeRoleCore)
	if err == nil || !strings.Contains(err.Error(), "protected payload keyring is not configured") {
		t.Fatalf("missing protected payload keyring error = %v", err)
	}
}

func protectedPayloadTestServer(
	t *testing.T,
	keyring *protectedpayload.Keyring,
) (*Server, *execution.InMemoryRunProjectionStore, execution.DurableRun) {
	t.Helper()
	store := execution.NewInMemoryRunProjectionStore()
	run := protectedPayloadTestRun(t, store)
	return &Server{
		config: config.Config{
			ProtectedPayloadKeyring: keyring,
		},
		runProjectionStore: store,
	}, store, run
}

func protectedPayloadTestRun(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
) execution.DurableRun {
	t.Helper()
	now := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-protected-payload-keyring",
		"conversation-protected-payload-keyring",
		now,
		nil,
	)
	run, err := store.GetRun(context.Background(), "run-protected-payload-keyring")
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func mustProtectedPayloadTestKeyring(
	t testing.TB,
	activeKeyID string,
	keys map[string][]byte,
) *protectedpayload.Keyring {
	t.Helper()
	keyring, err := protectedpayload.NewKeyring(activeKeyID, keys)
	if err != nil {
		t.Fatal(err)
	}
	return keyring
}

func protectedPayloadTestKey(start byte) []byte {
	key := make([]byte, 32)
	for index := range key {
		key[index] = start + byte(index)
	}
	return key
}
