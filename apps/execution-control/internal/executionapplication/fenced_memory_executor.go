package executionapplication

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/google/uuid"
)

type fencedMemoryExecutor struct {
	MemoryExecutor
	async     AsyncMemoryExecutor
	reader    MemoryReader
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
	reader, _ := executor.(MemoryReader)
	async, _ := executor.(AsyncMemoryExecutor)
	return fencedMemoryExecutor{MemoryExecutor: executor, async: async, reader: reader, ownerSalt: ownerSalt, state: state, ttl: ttl}
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

func (e fencedMemoryExecutor) SubmitConversationTurn(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	if e.async == nil {
		return memoryruntime.AppendOperation{}, errors.New("personal memory async executor is not configured")
	}
	if _, _, err := e.beginAppendCall(ctx, request.TenantID, request.UserID, request.RequestID, request.OwnerGeneration); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	return e.async.SubmitConversationTurn(ctx, request)
}

func (e fencedMemoryExecutor) GetConversationTurnOperation(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	if e.async == nil {
		return memoryruntime.AppendOperation{}, errors.New("personal memory async executor is not configured")
	}
	if _, _, err := e.beginAppendCall(ctx, request.TenantID, request.UserID, request.RequestID, request.OwnerGeneration); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	return e.async.GetConversationTurnOperation(ctx, request)
}

func (e fencedMemoryExecutor) GetProfile(ctx context.Context, query memoryruntime.ProfileQuery) (memoryruntime.ProfileRecord, error) {
	if e.reader == nil {
		return memoryruntime.ProfileRecord{}, errors.New("personal memory management reader is not configured")
	}
	ownerHash, callID, err := e.beginCall(ctx, query.TenantID, query.OwnerUserID, uuid.NewString(), query.OwnerGeneration, "management_profile")
	if err != nil {
		return memoryruntime.ProfileRecord{}, fmt.Errorf("personal memory profile fence rejected: %w", err)
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.reader.GetProfile(ctx, query)
}

func (e fencedMemoryExecutor) beginCall(ctx context.Context, tenantID string, userID string, runID string, generation int64, kind string) (string, string, error) {
	return e.beginCallWithTTL(ctx, tenantID, userID, runID, generation, kind, e.ttl)
}

func (e fencedMemoryExecutor) beginAppendCall(ctx context.Context, tenantID string, userID string, runID string, generation int64) (string, string, error) {
	return e.beginCallWithTTL(ctx, tenantID, userID, runID, generation, "append", 0)
}

func (e fencedMemoryExecutor) beginCallWithTTL(ctx context.Context, tenantID string, userID string, runID string, generation int64, kind string, ttl time.Duration) (string, string, error) {
	ownerHash := memoryruntime.OwnerScopeHash(e.ownerSalt, tenantID, userID)
	callID := fmt.Sprintf("%s:%s", runID, kind)
	if err := e.state.BeginCall(ctx, ownerHash, callID, generation, kind, ttl); err != nil {
		return "", "", fmt.Errorf("personal memory %s fence rejected: %w", kind, err)
	}
	return ownerHash, callID, nil
}
