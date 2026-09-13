package executionapplication

import (
	"context"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fencedMemoryExecutor struct {
	MemoryExecutor
	ownerSalt string
	state     MemoryStore
	ttl       time.Duration
}

func NewFencedExecutor(executor MemoryExecutor, state MemoryStore, ownerSalt string, timeout time.Duration) MemoryExecutor {
	if executor == nil || state == nil {
		return executor
	}
	ttl := timeout + 15*time.Second
	if ttl < 10*time.Second {
		ttl = 10 * time.Second
	}
	return fencedMemoryExecutor{MemoryExecutor: executor, ownerSalt: ownerSalt, state: state, ttl: ttl}
}

func (e fencedMemoryExecutor) Recall(ctx context.Context, request memoryruntime.RecallRequest) (memoryruntime.RecallResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RequestID, request.OwnerGeneration, "recall")
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.MemoryExecutor.Recall(ctx, request)
}

func (e fencedMemoryExecutor) AppendConversationTurn(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendConversationTurnResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RequestID, request.OwnerGeneration, "append")
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.MemoryExecutor.AppendConversationTurn(ctx, request)
}

func (e fencedMemoryExecutor) beginCall(ctx context.Context, tenantID string, userID string, runID string, generation int64, kind string) (string, string, error) {
	ownerHash := memoryruntime.OwnerScopeHash(e.ownerSalt, tenantID, userID)
	callID := fmt.Sprintf("%s:%s", runID, kind)
	if err := e.state.BeginCall(ctx, ownerHash, callID, generation, kind, e.ttl); err != nil {
		return "", "", fmt.Errorf("personal memory %s fence rejected: %w", kind, err)
	}
	return ownerHash, callID, nil
}
