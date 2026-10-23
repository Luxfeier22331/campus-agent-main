package memoryworkflow

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"go.temporal.io/sdk/activity"
)

type Store interface {
	memoryruntime.DurableRequestStore
	ClearRequestInput(context.Context, string) error
	CommandReady(context.Context, string) (bool, error)
}
type Activities struct {
	Store    Store
	Service  *memoryapplication.Service
	Callback memoryapplication.MemoryCommandResultClient
}

func (a *Activities) Advance(ctx context.Context, in Input) (Progress, error) {
	done := make(chan struct{})
	defer close(done)
	go func() {
		t := time.NewTicker(10 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-t.C:
				activity.RecordHeartbeat(ctx)
			}
		}
	}()
	r, err := a.Store.GetRequest(ctx, in.ID)
	if err != nil {
		return Progress{}, err
	}
	if terminal(r.State) {
		return a.cleanup(ctx, r)
	}
	switch r.Kind {
	case "append":
		var req memoryruntime.AppendConversationTurnRequest
		if err := json.Unmarshal(r.Payload, &req); err != nil {
			return Progress{}, err
		}
		journal := &appendJournal{store: a.Store, id: r.ID}
		out, err := a.Service.AdvanceAppend(ctx, memoryapplication.PreparedAppend{RequestID: req.RequestID, ThreadID: req.ThreadID, Request: req}, journal, r.State == "processing", r.CreatedAt)
		if err != nil {
			return Progress{}, err
		}
		if terminal(out.Status) {
			r.State = out.Status
			return a.cleanup(ctx, r)
		}
		if out.Status == "running" {
			if err := a.Store.SaveRequestProgress(ctx, r.ID, "processing", out); err != nil {
				return Progress{}, err
			}
		}
		return Progress{Status: out.Status}, nil
	case "command":
		ready, err := a.Store.CommandReady(ctx, r.ID)
		if err != nil {
			return Progress{}, err
		}
		if !ready {
			return Progress{Status: "pending"}, nil
		}
		var req memoryruntime.PersonalMemoryCommandRequest
		if err := json.Unmarshal(r.Payload, &req); err != nil {
			return Progress{}, err
		}
		out, err := a.Service.ExecutePersonalMemoryCommand(ctx, req)
		if err != nil {
			var app *memoryapplication.Error
			if errors.As(err, &app) && (app.Code == "memory_command_owner_blocked" || app.Code == "memory_command_receipt_active") {
				return Progress{Status: "pending"}, nil
			}
			if !errors.As(err, &app) || !app.NonRetryable {
				return Progress{}, err
			}
			out = memoryruntime.PersonalMemoryCommandResult{CommandID: req.CommandID, Status: "failed", ErrorCode: app.Code}
		}
		if out.Status == "processing" || out.Status == "unknown" {
			return Progress{Status: out.Status}, a.Store.SaveRequestProgress(ctx, r.ID, out.Status, out)
		}
		out, err = a.Service.FinalizePersonalMemoryCommandReceipt(ctx, memoryapplication.FinalizeCommandInput{Command: req, Result: out})
		if err != nil {
			return Progress{}, err
		}
		if err := a.Store.SaveRequestProgress(ctx, r.ID, out.Status, out); err != nil {
			return Progress{}, err
		}
		r.State = out.Status
		r.Result, _ = json.Marshal(out)
		return a.cleanup(ctx, r)
	default:
		return Progress{}, errors.New("unknown memory operation kind")
	}
}
func (a *Activities) cleanup(ctx context.Context, r memoryruntime.DurableRequest) (Progress, error) {
	if r.Kind == "append" && len(r.Payload) > 0 {
		var req memoryruntime.AppendConversationTurnRequest
		if err := json.Unmarshal(r.Payload, &req); err != nil {
			return Progress{}, err
		}
		if err := a.Service.CallLeaseStore.EndCall(ctx, r.OwnerHash, req.RequestID+":append"); err != nil {
			return Progress{}, err
		}
	}
	if r.Kind == "command" && a.Callback != nil {
		var out memoryruntime.PersonalMemoryCommandResult
		if err := json.Unmarshal(r.Result, &out); err != nil {
			return Progress{}, err
		}
		if err := a.Callback.WritePersonalMemoryCommandResult(ctx, memoryapplication.PersonalMemoryCommandResultRequest{CommandID: out.CommandID, Status: out.Status, ErrorCode: out.ErrorCode}); err != nil {
			return Progress{}, err
		}
	}
	return Progress{Status: r.State}, a.Store.ClearRequestInput(ctx, r.ID)
}
func terminal(s string) bool {
	return s == "succeeded" || s == "completed" || s == "failed" || s == "skipped"
}

type appendJournal struct {
	store Store
	id    string
}

func (j *appendJournal) Restore(ctx context.Context) (memoryapplication.AppendCheckpoint, error) {
	r, e := j.store.GetRequest(ctx, j.id)
	return memoryapplication.AppendCheckpoint{Status: r.State, Terminal: terminal(r.State)}, e
}
func (j *appendJournal) Save(ctx context.Context, p memoryapplication.AppendProgress) error {
	return j.store.SaveRequestProgress(ctx, j.id, p.Result.Status, p)
}
