package memorypersistence

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"os"
	"testing"
)

func TestDurableAdmissionPostgres(t *testing.T) {
	url := os.Getenv("MEMORY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("MEMORY_TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	s, err := NewPostgresStateStore(ctx, PostgresStateStoreOptions{DatabaseURL: url, Schema: "memory"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.pool.Exec(ctx, "truncate memory.requests,memory.personal_memory_owner_fences,memory.personal_memory_command_receipts,memory.personal_memory_call_leases")
	if err != nil {
		t.Fatal(err)
	}
	in := memoryruntime.DurableRequest{ID: "append:one", Kind: "append", OwnerHash: "owner", Payload: json.RawMessage(`{"request_id":"one","body":"private"}`)}
	r, err := s.AcceptRequest(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if r.State != "accepted" || r.Dispatched {
		t.Fatalf("unexpected admission: %+v", r)
	}
	pending, err := s.PendingRequests(ctx, 32)
	if err != nil || len(pending) != 1 {
		t.Fatalf("pending: %+v %v", pending, err)
	}
	if err = s.MarkOwnerDeleted(ctx, "owner"); !errors.Is(err, memoryruntime.ErrMemoryOwnerNotDrained) {
		t.Fatalf("deletion lost accepted input: %v", err)
	}
	reordered := in
	reordered.Payload = json.RawMessage(`{"body":"private","request_id":"one"}`)
	if _, err = s.AcceptRequest(ctx, reordered); err != nil {
		t.Fatal(err)
	}
	changed := in
	changed.OwnerHash = "other"
	if _, err = s.AcceptRequest(ctx, changed); !errors.Is(err, memoryruntime.ErrRequestConflict) {
		t.Fatalf("identity collision accepted: %v", err)
	}
	changed = in
	changed.Payload = json.RawMessage(`{"request_id":"one","body":"different"}`)
	if _, err = s.AcceptRequest(ctx, changed); !errors.Is(err, memoryruntime.ErrRequestConflict) {
		t.Fatalf("different input accepted: %v", err)
	}
	if err = s.MarkDispatched(ctx, in.ID); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveRequestProgress(ctx, in.ID, "completed", map[string]string{"status": "completed"}); err != nil {
		t.Fatal(err)
	}
	if err = s.ClearRequestInput(ctx, in.ID); err != nil {
		t.Fatal(err)
	}
	r, err = s.GetRequest(ctx, in.ID)
	if err != nil || len(r.Payload) != 0 || r.State != "completed" {
		t.Fatalf("terminal: %+v %v", r, err)
	}
	if _, err = s.AcceptRequest(ctx, in); err != nil {
		t.Fatalf("duplicate after cleanup: %v", err)
	}
	if err = s.SaveRequestProgress(ctx, in.ID, "running", nil); !errors.Is(err, memoryruntime.ErrRequestConflict) {
		t.Fatalf("terminal overwritten: %v", err)
	}
	if err = s.MarkOwnerDeleted(ctx, "owner"); err != nil {
		t.Fatal(err)
	}
	changed = in
	changed.ID = "append:late"
	if _, err = s.AcceptRequest(ctx, changed); !errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		t.Fatalf("deleted owner admitted: %v", err)
	}
}
