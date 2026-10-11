package memoryworkflow

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memorypersistence"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"testing"
	"time"
)

type testRequests struct {
	memoryruntime.DurableRequestStore
	row     memoryruntime.DurableRequest
	cleared bool
}

func (s *testRequests) GetRequest(context.Context, string) (memoryruntime.DurableRequest, error) {
	return s.row, nil
}
func (s *testRequests) SaveRequestProgress(_ context.Context, _ string, state string, result any) error {
	s.row.State = state
	s.row.Result, _ = json.Marshal(result)
	return nil
}
func (s *testRequests) ClearRequestInput(context.Context, string) error {
	s.cleared = true
	s.row.Payload = nil
	return nil
}

func (s *testRequests) CommandReady(context.Context, string) (bool, error) { return true, nil }

type appendProvider struct {
	submits, polls int
	failSubmit     bool
}

func (p *appendProvider) SubmitConversationTurn(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	p.submits++
	if p.failSubmit {
		return memoryruntime.AppendOperation{}, errors.New("lost ack")
	}
	return memoryruntime.AppendOperation{Status: "pending"}, nil
}
func (p *appendProvider) GetConversationTurnOperation(context.Context, memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	p.polls++
	if p.failSubmit {
		return memoryruntime.AppendOperation{}, errors.New("unavailable")
	}
	return memoryruntime.AppendOperation{Status: "completed"}, nil
}
func TestAppendRecoversSubmissionThenReleasesBeforeCleanup(t *testing.T) {
	req := memoryruntime.AppendConversationTurnRequest{RequestID: "r", TenantID: "tenant", UserID: "user", OwnerGeneration: 1, ThreadID: "thread", UserMessage: "hello", UserMessageID: "message", UserMessageCreatedAt: time.Now().UTC().Format(time.RFC3339)}
	payload, _ := json.Marshal(req)
	owner := memoryruntime.OwnerScopeHash("salt", "tenant", "user")
	requests := &testRequests{row: memoryruntime.DurableRequest{ID: "append:r", Kind: "append", OwnerHash: owner, State: "accepted", Payload: payload, CreatedAt: time.Now()}}
	state := memorypersistence.NewInMemoryStateStore()
	provider := &appendProvider{failSubmit: true}
	a := &Activities{Store: requests, Service: &memoryapplication.Service{OwnerSalt: "salt", CallLeaseStore: state, AsyncMemoryExecutor: provider}}
	ctx := context.Background()
	if _, err := a.Advance(ctx, Input{ID: "append:r"}); err == nil {
		t.Fatal("lost submission should retry")
	}
	if requests.row.State != "running" || requests.cleared {
		t.Fatal("unconfirmed submission lost input")
	}
	provider.failSubmit = false
	if _, err := a.Advance(ctx, Input{ID: "append:r"}); err != nil {
		t.Fatal(err)
	}
	if provider.submits != 2 || requests.row.State != "processing" {
		t.Fatalf("not resubmitted with same ID: %+v", requests.row)
	}
	p, err := a.Advance(ctx, Input{ID: "append:r"})
	if err != nil {
		t.Fatal(err)
	}
	drained, err := state.GenerationDrained(ctx, owner, 1)
	if err != nil || !drained || !requests.cleared || p.Status != "completed" {
		t.Fatalf("terminal cleanup missing: %v %v %+v", drained, err, p)
	}
	if _, err := a.Advance(ctx, Input{ID: "append:r"}); err != nil {
		t.Fatal(err)
	}
	if provider.submits != 2 {
		t.Fatal("terminal replay called provider")
	}
}
