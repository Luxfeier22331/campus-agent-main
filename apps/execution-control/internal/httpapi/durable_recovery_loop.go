//go:build retired_pg_lease

package httpapi

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type durableRecoveryLoopOptions struct {
	Store            execution.DurableRuntimeStore
	Coordinator      *execution.DurableLeaseCoordinator
	MaxRetryAttempts int
	Now              func() time.Time
}

type durableRecoveryLoop struct {
	store             execution.DurableRuntimeStore
	coordinator       *execution.DurableLeaseCoordinator
	maxRetryAttempts  int
	now               func() time.Time
	mu                sync.RWMutex
	started           bool
	healthy           bool
	lastError         string
	lastIterationAt   time.Time
	lastExpiredLeases int
	lastTimedOutRuns  int
}

type durableRecoveryLoopIteration struct {
	ExpiredLeases int
	TimedOutRuns  int
}

type durableRecoveryLoopStatus struct {
	Configured        bool
	Started           bool
	Healthy           bool
	LastError         string
	LastIterationAt   time.Time
	LastExpiredLeases int
	LastTimedOutRuns  int
}

func newDurableRecoveryLoop(options durableRecoveryLoopOptions) *durableRecoveryLoop {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &durableRecoveryLoop{
		store:            options.Store,
		coordinator:      options.Coordinator,
		maxRetryAttempts: options.MaxRetryAttempts,
		now:              now,
		healthy:          true,
	}
}

func (l *durableRecoveryLoop) RunOnce(ctx context.Context) (durableRecoveryLoopIteration, error) {
	result, err := l.runOnce(ctx)
	l.recordIteration(result, err)
	return result, err
}

func (l *durableRecoveryLoop) Run(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		return fmt.Errorf("durable recovery loop interval is required")
	}
	if _, err := l.RunOnce(ctx); err != nil {
		return err
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			_, _ = l.RunOnce(ctx)
		}
	}
}

func (l *durableRecoveryLoop) runOnce(ctx context.Context) (durableRecoveryLoopIteration, error) {
	if l == nil || l.store == nil || l.coordinator == nil {
		return durableRecoveryLoopIteration{}, execution.ErrDurableRuntimeStoreNotConfigured
	}
	if l.maxRetryAttempts <= 0 {
		return durableRecoveryLoopIteration{}, fmt.Errorf("durable recovery loop max retry attempts is required")
	}
	now := l.now().UTC()
	expiredLeases, err := l.coordinator.RecoverExpiredLeases(ctx, execution.ExpiredLeaseRecoveryRequest{
		Now:              now,
		ReleaseReason:    string(execution.DurableTerminalReasonLeaseExpired),
		TerminalReason:   execution.DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: l.maxRetryAttempts,
	})
	if err != nil {
		return durableRecoveryLoopIteration{}, err
	}
	timedOutRuns, err := l.coordinator.RecoverTimedOutRuns(ctx, execution.TimedOutRunRecoveryRequest{
		Now: now,
	})
	if err != nil {
		return durableRecoveryLoopIteration{}, err
	}
	return durableRecoveryLoopIteration{
		ExpiredLeases: len(expiredLeases),
		TimedOutRuns:  len(timedOutRuns),
	}, nil
}

func (l *durableRecoveryLoop) Status() durableRecoveryLoopStatus {
	if l == nil {
		return durableRecoveryLoopStatus{Configured: false, Healthy: false}
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	return durableRecoveryLoopStatus{
		Configured:        true,
		Started:           l.started,
		Healthy:           l.healthy,
		LastError:         l.lastError,
		LastIterationAt:   l.lastIterationAt,
		LastExpiredLeases: l.lastExpiredLeases,
		LastTimedOutRuns:  l.lastTimedOutRuns,
	}
}

func (l *durableRecoveryLoop) recordIteration(result durableRecoveryLoopIteration, err error) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.started = true
	l.lastIterationAt = l.now().UTC()
	l.lastExpiredLeases = result.ExpiredLeases
	l.lastTimedOutRuns = result.TimedOutRuns
	if err != nil {
		l.healthy = false
		l.lastError = err.Error()
		return
	}
	l.healthy = true
	l.lastError = ""
}
