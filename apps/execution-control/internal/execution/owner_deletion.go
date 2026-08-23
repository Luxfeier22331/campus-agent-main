package execution

import (
	"context"
	"errors"
	"time"
)

var (
	ErrOwnerDeletionNotStarted = errors.New("owner deletion has not started")
	ErrOwnerDeleted            = errors.New("owner has been deleted")
	ErrOwnerDeletionNotDrained = errors.New("owner deletion has not drained")
)

type OwnerDeletionState string

const (
	OwnerDeletionStateDraining OwnerDeletionState = "draining"
	OwnerDeletionStateDeleted  OwnerDeletionState = "deleted"
)

type OwnerDeletionStatus struct {
	OwnerUserID string
	State       OwnerDeletionState
	ActiveRuns  int
}

type OwnerDeletionFinalizeRequest struct {
	OwnerUserID string
	Now         time.Time
}

type OwnerDeletionStore interface {
	BeginOwnerDeletion(context.Context, string, time.Time) (OwnerDeletionStatus, error)
	OwnerDeletionStatus(context.Context, string) (OwnerDeletionStatus, error)
	FinalizeOwnerDeletion(context.Context, OwnerDeletionFinalizeRequest) (OwnerDeletionStatus, error)
}
