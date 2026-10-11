package memoryapplication

import (
	"context"
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

// Admission commits the input and dispatch intent together. Temporal availability
// is deliberately outside this transaction: an accepted request belongs to Memory.
type Admission struct {
	Store     memoryruntime.DurableRequestStore
	OwnerSalt string
}

func (a *Admission) StartPersonalMemoryCommandWorkflow(ctx context.Context, in PersonalMemoryCommandInput) error {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(in.Command); err != nil {
		return err
	}
	return a.accept(ctx, in.Command.CommandID, "command", in.Command.TenantID, in.Command.UserID, in.Command)
}
func (a *Admission) Append(ctx context.Context, in memoryruntime.AppendConversationTurnRequest) error {
	if err := memoryruntime.ValidateAppendConversationTurnRequest(in); err != nil {
		return err
	}
	return a.accept(ctx, "append:"+in.RequestID, "append", in.TenantID, in.UserID, in)
}
func (a *Admission) accept(ctx context.Context, id, kind, tenant, user string, in any) error {
	payload, err := json.Marshal(in)
	if err != nil {
		return err
	}
	_, err = a.Store.AcceptRequest(ctx, memoryruntime.DurableRequest{ID: id, Kind: kind, OwnerHash: memoryruntime.OwnerScopeHash(a.OwnerSalt, tenant, user), Payload: payload})
	return err
}
