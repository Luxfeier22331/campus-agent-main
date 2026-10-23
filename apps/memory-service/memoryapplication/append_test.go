package memoryapplication

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"testing"
	"time"
)

type appendTestStore struct {
	MemoryStateStore
	begins int
}

func (s *appendTestStore) BeginCall(ctx context.Context, owner, call string, generation int64, kind string, ttl time.Duration) error {
	s.begins++
	return s.MemoryStateStore.BeginCall(ctx, owner, call, generation, kind, ttl)
}

type appendTestProvider struct {
	submits, polls int
	submitErr      error
	status         string
}

func (p *appendTestProvider) SubmitConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	p.submits++
	return memoryruntime.AppendOperation{Status: "pending"}, p.submitErr
}
func (p *appendTestProvider) GetConversationTurnOperation(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	p.polls++
	return memoryruntime.AppendOperation{Status: p.status}, nil
}

type appendTestJournal struct {
	checkpoint   AppendCheckpoint
	failTerminal bool
}

func (j *appendTestJournal) Restore(context.Context) (AppendCheckpoint, error) {
	return j.checkpoint, nil
}
func (j *appendTestJournal) Save(_ context.Context, p AppendProgress) error {
	terminal := p.Result.Status != "running"
	if terminal && j.failTerminal {
		return errors.New("projection unavailable")
	}
	j.checkpoint = AppendCheckpoint{Status: p.Result.Status, Terminal: terminal}
	return nil
}

func TestAppendServiceOwnsAdmissionRecoveryAndRelease(t *testing.T) {
	for _, lostAck := range []bool{false, true} {
		t.Run(map[bool]string{false: "acknowledged", true: "lost_ack"}[lostAck], func(t *testing.T) {
			ctx := t.Context()
			state := &appendTestStore{MemoryStateStore: memorypersistence.NewInMemoryStateStore()}
			provider := &appendTestProvider{status: "processing"}
			if lostAck {
				provider.submitErr = errors.New("ack lost")
			}
			service := &Service{OwnerSalt: "salt", CallLeaseStore: state, CommandStateStore: state, OwnerLifecycleStore: state, AsyncMemoryExecutor: provider}
			journal := &appendTestJournal{}
			source := PreparedAppend{RequestID: "request", ThreadID: "thread", Request: memoryruntime.AppendConversationTurnRequest{RequestID: "request", TenantID: "tenant", UserID: "user", OwnerGeneration: 1}}
			owner := memoryruntime.OwnerScopeHash("salt", "tenant", "user")
			result, err := service.AdvanceAppend(ctx, source, journal, false, time.Now())
			if err != nil || result.Status != "running" {
				t.Fatalf("submit: %+v %v", result, err)
			}
			wantBegins := 1
			if lostAck {
				wantBegins = 2
			}
			if state.begins != wantBegins || provider.submits != 1 {
				t.Fatalf("admissions=%d submissions=%d", state.begins, provider.submits)
			}
			transition := memoryruntime.PersonalMemoryCommandRequest{CommandID: "erase", CommandKind: "owner_erase", LifecycleState: "erasing", OwnerGeneration: 2, OwnerSequence: 1, TenantID: "tenant", UserID: "user"}
			if _, _, err := state.BeginCommand(ctx, owner, transition, time.Minute); err != nil {
				t.Fatal(err)
			}
			provider.status = "completed"
			journal.failTerminal = true
			if _, err := service.AdvanceAppend(ctx, source, journal, true, time.Now()); err == nil {
				t.Fatal("expected projection failure")
			}
			if drained, err := state.GenerationDrained(ctx, owner, 1); err != nil || drained {
				t.Fatalf("premature release: %v %v", drained, err)
			}
			journal.failTerminal = false
			if result, err := service.AdvanceAppend(ctx, source, journal, true, time.Now()); err != nil || result.Status != "completed" {
				t.Fatalf("resume: %+v %v", result, err)
			}
			if drained, err := state.GenerationDrained(ctx, owner, 1); err != nil || !drained {
				t.Fatalf("lease remains: %v %v", drained, err)
			}
			source.RequestID = "new"
			source.Request.RequestID = "new"
			source.Request.OwnerGeneration = 2
			journal = &appendTestJournal{}
			if result, err := service.AdvanceAppend(ctx, source, journal, false, time.Now()); err != nil || result.Status != "skipped" {
				t.Fatalf("new call while erasing: %+v %v", result, err)
			}
			if provider.submits != 1 {
				t.Fatal("erasing owner admitted new submission")
			}
		})
	}
}
