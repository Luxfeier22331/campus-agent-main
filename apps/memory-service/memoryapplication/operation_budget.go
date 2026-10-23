package memoryapplication

import (
	"context"
	"time"
)

// OperationBudget is the deadline shared by every provider request belonging
// to one synchronous memory use case.
type OperationBudget struct {
	DeadlineAt time.Time
}

func NewOperationBudget(ctx context.Context, configured time.Duration) (OperationBudget, context.Context, context.CancelFunc) {
	deadline, hasDeadline := ctx.Deadline()
	if !hasDeadline {
		if configured <= 0 {
			configured = 90 * time.Second
		}
		deadline = time.Now().Add(configured)
	}
	budget := OperationBudget{DeadlineAt: deadline}
	budgetCtx, cancel := context.WithDeadline(ctx, deadline)
	return budget, budgetCtx, cancel
}

func (b OperationBudget) Remaining(now time.Time) time.Duration {
	if b.DeadlineAt.IsZero() {
		return 0
	}
	return b.DeadlineAt.Sub(now)
}

func (b OperationBudget) LeaseTTL(now time.Time) time.Duration {
	remaining := b.DeadlineAt.Sub(now)
	if remaining <= 0 {
		return time.Millisecond
	}
	return remaining
}
