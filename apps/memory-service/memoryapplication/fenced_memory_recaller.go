package memoryapplication

import (
	"context"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type FencedMemoryRecaller struct {
	recaller  MemoryRecaller
	ownerSalt string
	state     CallLeaseStore
	ttl       time.Duration
}

func NewFencedMemoryRecaller(recaller MemoryRecaller, state CallLeaseStore, ownerSalt string, timeout time.Duration) *FencedMemoryRecaller {
	ttl := timeout + 15*time.Second
	if ttl < 10*time.Second {
		ttl = 10 * time.Second
	}
	return &FencedMemoryRecaller{recaller: recaller, ownerSalt: ownerSalt, state: state, ttl: ttl}
}

func (e FencedMemoryRecaller) Recall(ctx context.Context, request memoryruntime.RecallRequest) (memoryruntime.RecallResult, error) {
	budget, callCtx, cancel := NewOperationBudget(ctx, e.ttl-15*time.Second)
	defer cancel()
	ownerHash, callID, err := e.beginCallWithTTL(callCtx, request.TenantID, request.UserID, request.RequestID, request.OwnerGeneration, "recall", budget.LeaseTTL(time.Now()))
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.recaller.Recall(callCtx, request)
}

func (e FencedMemoryRecaller) beginCallWithTTL(ctx context.Context, tenantID string, userID string, runID string, generation int64, kind string, ttl time.Duration) (string, string, error) {
	ownerHash := memoryruntime.OwnerScopeHash(e.ownerSalt, tenantID, userID)
	callID := fmt.Sprintf("%s:%s", runID, kind)
	if err := e.state.BeginCall(ctx, ownerHash, callID, generation, kind, ttl); err != nil {
		return "", "", fmt.Errorf("personal memory %s fence rejected: %w", kind, err)
	}
	return ownerHash, callID, nil
}
