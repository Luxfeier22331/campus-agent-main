package memoryapplication

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

// PreparedAppend contains only the admitted memory input, never an answer run.
// RequestError is delayed until after availability checks, preserving recovery order.
type PreparedAppend struct {
	RequestID    string
	ThreadID     string
	Request      memoryruntime.AppendConversationTurnRequest
	SkipReason   string
	RequestError error
}
type AppendResult struct {
	AppendedMessageCount int
	RequestID            string
	SchemaVersion        string
	SkipReasons          []string
	SkippedCount         int
	Status               string
	ThreadID             string
}
type AppendProgress struct {
	Result        AppendResult
	StartedAt     time.Time
	CompletedAt   time.Time
	UpdatedAt     time.Time
	FailureCode   string
	FailureDetail string
	HTTPStatus    int
}

type AppendCheckpoint struct {
	Status   string
	Terminal bool
}

// Restore repairs an existing terminal checkpoint before returning it.
// The answer-side implementation owns step/attempt/result projection details.
type AppendProgressStore interface {
	Restore(context.Context) (AppendCheckpoint, error)
	Save(context.Context, AppendProgress) error
}

func (s *Service) AdvanceAppend(ctx context.Context, source PreparedAppend, journal AppendProgressStore, submitted bool, startedAt time.Time) (AppendResult, error) {
	if source.SkipReason != "" {
		return skipAppend(ctx, source, journal, startedAt, source.SkipReason)
	}
	if s.PersonalMemoryErr != nil || s.AsyncMemoryExecutor == nil {
		return AppendResult{}, applicationError("memory_append_runtime_unavailable", errors.New("memory runtime unavailable"), false)
	}
	if source.RequestError != nil {
		return finishAppend(ctx, source, journal, startedAt, "failed", "memory_append_request_invalid", memoryruntime.AppendOperation{})
	}
	if s.PersonalMemoryStateErr != nil || s.CallLeaseStore == nil {
		return AppendResult{}, applicationError("memory_append_state_unavailable", errors.New("memory state unavailable"), false)
	}
	request := source.Request
	ownerHash := memoryruntime.OwnerScopeHash(s.OwnerSalt, request.TenantID, request.UserID)
	callID := request.RequestID + ":append"
	checkpoint, err := journal.Restore(ctx)
	if err != nil {
		return AppendResult{}, err
	}
	// A committed terminal checkpoint must be repaired before releasing its lease.
	if checkpoint.Terminal {
		return AppendResult{RequestID: source.RequestID, Status: checkpoint.Status}, s.CallLeaseStore.EndCall(ctx, ownerHash, callID)
	}
	if !submitted {
		if err := s.CallLeaseStore.BeginCall(ctx, ownerHash, callID, request.OwnerGeneration, "append", 0); err != nil {
			if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
				return skipAppend(ctx, source, journal, startedAt, "memory_generation_changed")
			}
			return AppendResult{}, err
		}
		if checkpoint.Status != "running" {
			if err := journal.Save(ctx, AppendProgress{Result: AppendResult{Status: "running"}, StartedAt: startedAt, UpdatedAt: time.Now().UTC()}); err != nil {
				return AppendResult{}, err
			}
		}
		if _, err := s.AsyncMemoryExecutor.SubmitConversationTurn(ctx, request); err != nil {
			// A lost acknowledgement must query the same stable operation.
			if _, statusErr := s.getAppendOperation(ctx, request); statusErr == nil {
				return AppendResult{RequestID: source.RequestID, Status: "running"}, nil
			}
			return AppendResult{}, applicationError("memory_append_submit_unconfirmed", errors.New("retain submission not confirmed"), false)
		}
		return AppendResult{RequestID: source.RequestID, Status: "running"}, nil
	}
	operation, err := s.getAppendOperation(ctx, request)
	if err != nil {
		return AppendResult{}, applicationError("memory_append_status_unavailable", errors.New("retain status unavailable"), false)
	}
	switch operation.Status {
	case "completed", "failed", "cancelled":
		status := operation.Status
		if status == "cancelled" {
			status = "failed"
		}
		result, err := finishAppend(ctx, source, journal, startedAt, status, operation.ErrorCode, operation)
		if err != nil {
			return result, err
		}
		return result, s.CallLeaseStore.EndCall(ctx, ownerHash, callID)
	default:
		return AppendResult{RequestID: source.RequestID, Status: "running"}, nil
	}
}
func skipAppend(ctx context.Context, source PreparedAppend, journal AppendProgressStore, startedAt time.Time, reason string) (AppendResult, error) {
	result := AppendResult{RequestID: source.RequestID, SchemaVersion: "memory_conversation_append_result_v3", SkipReasons: []string{reason}, SkippedCount: 1, Status: "skipped"}
	now := time.Now().UTC()
	return result, journal.Save(ctx, AppendProgress{Result: result, StartedAt: startedAt, CompletedAt: now, UpdatedAt: now})
}
func finishAppend(ctx context.Context, source PreparedAppend, journal AppendProgressStore, startedAt time.Time, status, code string, operation memoryruntime.AppendOperation) (AppendResult, error) {
	result := AppendResult{RequestID: source.RequestID, Status: status, ThreadID: source.ThreadID, SchemaVersion: "memory_conversation_append_result_v3"}
	if status == "completed" {
		result.AppendedMessageCount = 1
	}
	now := time.Now().UTC()
	return result, journal.Save(ctx, AppendProgress{Result: result, StartedAt: startedAt, CompletedAt: now, UpdatedAt: now, FailureCode: code, FailureDetail: operation.ErrorDetail, HTTPStatus: operation.HTTPStatus})
}

// Every provider poll must be admitted, including a lost submission acknowledgement.
func (s *Service) getAppendOperation(ctx context.Context, request memoryruntime.AppendConversationTurnRequest) (memoryruntime.AppendOperation, error) {
	ownerHash := memoryruntime.OwnerScopeHash(s.OwnerSalt, request.TenantID, request.UserID)
	if err := s.CallLeaseStore.BeginCall(ctx, ownerHash, request.RequestID+":append", request.OwnerGeneration, "append", 0); err != nil {
		return memoryruntime.AppendOperation{}, err
	}
	return s.AsyncMemoryExecutor.GetConversationTurnOperation(ctx, request)
}
