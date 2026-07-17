package httpapi

import (
	"context"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type fencedPersonalMemoryExecutor struct {
	personalMemoryExecutor
	ownerSalt string
	state     memoryruntime.StateStore
	ttl       time.Duration
}

func newFencedPersonalMemoryExecutor(executor personalMemoryExecutor, state memoryruntime.StateStore, ownerSalt string, timeoutSeconds float64) personalMemoryExecutor {
	if executor == nil || state == nil {
		return executor
	}
	ttl := time.Duration(timeoutSeconds*float64(time.Second)) + 15*time.Second
	if ttl < 10*time.Second {
		ttl = 10 * time.Second
	}
	return fencedPersonalMemoryExecutor{personalMemoryExecutor: executor, ownerSalt: ownerSalt, state: state, ttl: ttl}
}

func (e fencedPersonalMemoryExecutor) Recall(ctx context.Context, request memoryruntime.RecallRequest) (memoryruntime.RecallResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RunID, request.ThreadID, request.OwnerGeneration, request.OwnerSequence, "recall")
	if err != nil {
		return memoryruntime.RecallResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.personalMemoryExecutor.Recall(ctx, request)
}

func (e fencedPersonalMemoryExecutor) AppendConversationTurn(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendConversationTurnResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RunID, request.ThreadID, request.OwnerGeneration, request.OwnerSequence, "append")
	if err != nil {
		return memoryruntime.AppendConversationTurnResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.personalMemoryExecutor.AppendConversationTurn(ctx, request)
}

func (e fencedPersonalMemoryExecutor) Reflect(ctx context.Context, request memoryruntime.ReflectRequest) (memoryruntime.ReflectResult, error) {
	ownerHash, callID, err := e.beginCall(ctx, request.TenantID, request.UserID, request.RunID, request.ThreadID, request.OwnerGeneration, request.OwnerSequence, "reflect")
	if err != nil {
		return memoryruntime.ReflectResult{}, err
	}
	defer func() { _ = e.state.EndCall(context.Background(), ownerHash, callID) }()
	return e.personalMemoryExecutor.Reflect(ctx, request)
}

func (e fencedPersonalMemoryExecutor) beginCall(ctx context.Context, tenantID string, userID string, runID string, subjectID string, generation int64, sequence int64, kind string) (string, string, error) {
	ownerHash := personalMemoryOwnerScopeHash(e.ownerSalt, tenantID, userID)
	subjectHash := personalMemorySubjectScopeHash(ownerHash, subjectID)
	callID := fmt.Sprintf("%s:%s", runID, kind)
	if err := e.state.BeginCall(ctx, ownerHash, callID, generation, sequence, subjectHash, kind, e.ttl); err != nil {
		return "", "", fmt.Errorf("personal memory %s fence rejected: %w", kind, err)
	}
	return ownerHash, callID, nil
}
