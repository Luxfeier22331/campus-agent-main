package memoryruntime

import (
	"context"
	"fmt"
	"time"
)

type fencedExecutor struct {
	Executor
	ownerSalt string
	state     StateStore
	ttl       time.Duration
}

func NewFencedExecutor(executor Executor, state StateStore, ownerSalt string, timeout time.Duration) Executor {
	if executor == nil || state == nil {
		return executor
	}
	ttl := timeout + 15*time.Second
	if ttl < 10*time.Second {
		ttl = 10 * time.Second
	}
	return fencedExecutor{Executor: executor, ownerSalt: ownerSalt, state: state, ttl: ttl}
}

func (e fencedExecutor) Recall(ctx context.Context, request RecallRequest) (RecallResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RequestID, request.ThreadID, request.OwnerGeneration, request.OwnerSequence, "recall")
	if err != nil {
		return RecallResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.Executor.Recall(ctx, request)
}

func (e fencedExecutor) AppendConversationTurn(ctx context.Context, request AppendConversationTurnRequest) (AppendConversationTurnResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RequestID, request.ThreadID, request.OwnerGeneration, request.OwnerSequence, "append")
	if err != nil {
		return AppendConversationTurnResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.Executor.AppendConversationTurn(ctx, request)
}

func (e fencedExecutor) beginCall(ctx context.Context, tenantID string, userID string, runID string, subjectID string, generation int64, sequence int64, kind string) (string, string, error) {
	ownerHash := OwnerScopeHash(e.ownerSalt, tenantID, userID)
	subjectHash := SubjectScopeHash(ownerHash, subjectID)
	callID := fmt.Sprintf("%s:%s", runID, kind)
	if err := e.state.BeginCall(ctx, ownerHash, callID, generation, sequence, subjectHash, kind, e.ttl); err != nil {
		return "", "", fmt.Errorf("personal memory %s fence rejected: %w", kind, err)
	}
	return ownerHash, callID, nil
}
