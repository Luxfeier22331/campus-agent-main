package memoryworkflow

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"github.com/jackc/pgx/v5"
)

type eraseProvider struct {
	processing bool
	calls      []string
}

func (p *eraseProvider) ExecuteCommand(_ context.Context, r memoryruntime.PersonalMemoryCommandRequest) (memoryruntime.PersonalMemoryCommandResult, error) {
	p.calls = append(p.calls, r.CommandID)
	status := "succeeded"
	if p.processing && r.CommandKind == "memory_add" {
		status = "processing"
	}
	return memoryruntime.PersonalMemoryCommandResult{CommandID: r.CommandID, Status: status}, nil
}

type commandCallbacks struct {
	results []memoryapplication.PersonalMemoryCommandResultRequest
}

func (c *commandCallbacks) WritePersonalMemoryCommandResult(_ context.Context, r memoryapplication.PersonalMemoryCommandResultRequest) error {
	c.results = append(c.results, r)
	return nil
}

func TestEraseOrderingPostgres(t *testing.T) {
	url := os.Getenv("MEMORY_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("MEMORY_TEST_DATABASE_URL required")
	}
	ctx := t.Context()
	store, err := memorypersistence.NewPostgresStateStore(ctx, memorypersistence.PostgresStateStoreOptions{DatabaseURL: url, Schema: "memory"})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = conn.Close(context.Background()) }()
	for _, scenario := range []string{"unstarted", "processing", "timeout", "old-transition"} {
		t.Run(scenario, func(t *testing.T) {
			user := "erase-test-" + scenario
			owner := memoryruntime.OwnerScopeHash("salt", "tenant", user)
			first := memoryruntime.PersonalMemoryCommandRequest{CommandID: user + "-first", CommandKind: "memory_add", TenantID: "tenant", UserID: user, OwnerGeneration: 1, OwnerSequence: 1, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion, SubjectID: "fact", Item: &memoryruntime.PersonalMemoryCommandItem{Text: "fact"}, SupersessionScope: "memory:fact", SourceUpdatedAt: time.Now().UTC().Format(time.RFC3339)}
			if scenario == "old-transition" {
				first.CommandKind = "owner_transition"
				first.LifecycleState = "paused"
				first.SupersessionScope = "owner:lifecycle"
				first.Item = nil
			}
			erase := memoryruntime.PersonalMemoryCommandRequest{CommandID: user + "-erase", CommandKind: "owner_erase", TenantID: "tenant", UserID: user, OwnerGeneration: 2, OwnerSequence: 2, SchemaVersion: memoryruntime.PersonalMemoryCommandSchemaVersion, SupersessionScope: "owner:erase:2", SourceUpdatedAt: first.SourceUpdatedAt}
			admit := &memoryapplication.Admission{Store: store, OwnerSalt: "salt"}
			provider := &eraseProvider{processing: true}
			callback := &commandCallbacks{}
			service := &memoryapplication.Service{OwnerSalt: "salt", TimeoutSeconds: 90, CommandStateStore: store, CallLeaseStore: store, OwnerLifecycleStore: store, CommandExecutor: provider}
			a := &Activities{Store: store, Service: service, Callback: callback}
			must := func(err error) {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
			}
			must(admit.StartPersonalMemoryCommandWorkflow(ctx, memoryapplication.PersonalMemoryCommandInput{Command: first}))
			if scenario == "processing" || scenario == "timeout" {
				p, e := a.Advance(ctx, Input{ID: first.CommandID})
				must(e)
				if p.Status != "processing" {
					t.Fatal(p)
				}
			}
			if scenario == "old-transition" {
				first.SubjectScopeHash = memoryruntime.SubjectScopeHash(owner, first.SubjectID)
				_, _, e := store.BeginCommand(ctx, owner, first, time.Minute)
				must(e)
			}
			must(admit.StartPersonalMemoryCommandWorkflow(ctx, memoryapplication.PersonalMemoryCommandInput{Command: erase}))
			ready, e := store.CommandReady(ctx, erase.CommandID)
			must(e)
			if !ready {
				t.Fatal("erase blocked by predecessor")
			}
			_, e = a.Advance(ctx, Input{ID: erase.CommandID})
			if scenario == "unstarted" {
				must(e)
			} else if e == nil {
				t.Fatal("erase must wait for started command")
			}
			if e := store.BeginCall(ctx, owner, user+"-late", 1, "recall", time.Minute); !errors.Is(e, memoryruntime.ErrMemoryFenceConflict) {
				t.Fatalf("old generation still admitted: %v", e)
			}
			if scenario == "timeout" {
				_, e = conn.Exec(ctx, `update memory.personal_memory_command_receipts set created_at=now()-interval '25 hours' where command_id=$1`, erase.CommandID)
				must(e)
				p, e := a.Advance(ctx, Input{ID: erase.CommandID})
				must(e)
				if p.Status != "failed" {
					t.Fatal(p)
				}
				r, e := store.GetRequest(ctx, erase.CommandID)
				must(e)
				var result memoryruntime.PersonalMemoryCommandResult
				must(json.Unmarshal(r.Result, &result))
				if result.ErrorCode != "memory_generation_drain_timeout" {
					t.Fatal(result)
				}
				return
			}
			provider.processing = false
			p, e := a.Advance(ctx, Input{ID: first.CommandID})
			must(e)
			if scenario == "unstarted" {
				if p.Status != "failed" || len(provider.calls) != 1 {
					t.Fatalf("unstarted command invoked provider: %v %v", p, provider.calls)
				}
			} else {
				if p.Status != "succeeded" {
					t.Fatal(p)
				}
				var lifecycle string
				must(conn.QueryRow(ctx, `select lifecycle_state from memory.personal_memory_owner_fences where owner_scope_hash=$1`, owner).Scan(&lifecycle))
				if lifecycle != "erasing" {
					t.Fatalf("old completion overwrote erase fence: %s", lifecycle)
				}
				p, e = a.Advance(ctx, Input{ID: erase.CommandID})
				must(e)
				if p.Status != "succeeded" {
					t.Fatal(p)
				}
			}
			must(store.MarkOwnerDeleted(ctx, owner))
			if len(callback.results) != 2 {
				t.Fatalf("missing callbacks: %+v", callback.results)
			}
		})
	}
}
