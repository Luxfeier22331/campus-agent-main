package execution

import (
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
