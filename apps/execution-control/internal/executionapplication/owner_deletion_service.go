package executionapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
)

type MemoryOwnerDeleter interface {
	MarkOwnerDeleted(context.Context, string, string) error
}

type OwnerDeletionOptions struct {
	Store          OwnerDeletionStore
	StoreError     error
	Memory         MemoryOwnerDeleter
	MemoryExternal bool
}

type OwnerDeletionService struct{ options OwnerDeletionOptions }

func NewOwnerDeletionService(options OwnerDeletionOptions) *OwnerDeletionService {
	return &OwnerDeletionService{options: options}
}

func (s *OwnerDeletionService) StoreConfigured() bool {
	return s.options.Store != nil && s.options.StoreError == nil
}

// OwnerDeletionBeginError preserves which operation failed during finalization.
type OwnerDeletionBeginError struct{ Err error }

func (e *OwnerDeletionBeginError) Error() string { return e.Err.Error() }
func (e *OwnerDeletionBeginError) Unwrap() error { return e.Err }

type MemoryOwnerDeletionError struct{ Err error }

func (e *MemoryOwnerDeletionError) Error() string { return e.Err.Error() }
func (e *MemoryOwnerDeletionError) Unwrap() error { return e.Err }

func (s *OwnerDeletionService) Begin(ctx context.Context, ownerUserID string) (execution.OwnerDeletionStatus, error) {
	return s.options.Store.BeginOwnerDeletion(ctx, ownerUserID, time.Now().UTC().Truncate(time.Microsecond))
}

// Finalize is the execution-control participant in App API's account deletion.
// Memory must be marked deleted before execution records can be removed.
func (s *OwnerDeletionService) Finalize(ctx context.Context, ownerUserID string) (execution.OwnerDeletionStatus, error) {
	status, err := s.Begin(ctx, ownerUserID)
	if err != nil {
		return status, &OwnerDeletionBeginError{Err: err}
	}
	if status.State == execution.OwnerDeletionStateDeleted {
		return status, nil
	}
	if status.ActiveRuns > 0 {
		return status, execution.ErrOwnerDeletionNotDrained
	}
	if !s.options.MemoryExternal {
		if s.options.Memory == nil {
			return status, &MemoryOwnerDeletionError{Err: memoryapplication.ErrMemoryStateUnavailable}
		}
		if err := s.options.Memory.MarkOwnerDeleted(ctx, "tenant-main", ownerUserID); err != nil {
			return status, &MemoryOwnerDeletionError{Err: err}
		}
	}
	return s.options.Store.FinalizeOwnerDeletion(ctx, execution.OwnerDeletionFinalizeRequest{
		OwnerUserID: ownerUserID,
		Now:         time.Now().UTC().Truncate(time.Microsecond),
	})
}
