package execution

import (
	"context"
	"fmt"
	"time"
)

type DurableLeaseCoordinator struct {
	store DurableRuntimeStore
}

func NewDurableLeaseCoordinator(store DurableRuntimeStore) *DurableLeaseCoordinator {
	return &DurableLeaseCoordinator{store: store}
}

func (c *DurableLeaseCoordinator) AcquireNextLease(
	ctx context.Context,
	request NextExecutionLeaseRequest,
) (ExecutionLease, error) {
	if c == nil || c.store == nil {
		return ExecutionLease{}, fmt.Errorf("%w", ErrDurableRuntimeStoreNotConfigured)
	}
	return c.store.AcquireNextExecutionLease(ctx, request)
}

func (c *DurableLeaseCoordinator) ExpireLeases(
	ctx context.Context,
	now time.Time,
	releaseReason string,
) ([]ExecutionLease, error) {
	if c == nil || c.store == nil {
		return nil, fmt.Errorf("%w", ErrDurableRuntimeStoreNotConfigured)
	}
	return c.store.ExpireExecutionLeases(ctx, now, releaseReason)
}

func (c *DurableLeaseCoordinator) RecoverExpiredLeases(
	ctx context.Context,
	request ExpiredLeaseRecoveryRequest,
) ([]ExpiredLeaseRecoveryResult, error) {
	if c == nil || c.store == nil {
		return nil, fmt.Errorf("%w", ErrDurableRuntimeStoreNotConfigured)
	}
	return c.store.RecoverExpiredExecutionLeases(ctx, request)
}

func (c *DurableLeaseCoordinator) RecoverTimedOutRuns(
	ctx context.Context,
	request TimedOutRunRecoveryRequest,
) ([]TimedOutRunRecoveryResult, error) {
	if c == nil || c.store == nil {
		return nil, fmt.Errorf("%w", ErrDurableRuntimeStoreNotConfigured)
	}
	return c.store.RecoverTimedOutRuns(ctx, request)
}

func (c *DurableLeaseCoordinator) CancelRun(
	ctx context.Context,
	request DurableRunCancelRequest,
) (DurableRunCancelResult, error) {
	if c == nil || c.store == nil {
		return DurableRunCancelResult{}, fmt.Errorf("%w", ErrDurableRuntimeStoreNotConfigured)
	}
	return c.store.CancelRun(ctx, request)
}
