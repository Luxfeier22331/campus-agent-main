package httpapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

var errDurableWorkerLoopBridgeNotConfigured = errors.New("durable worker loop bridge is not configured")

type durableWorkerLoopOutcome string

const (
	durableWorkerLoopOutcomeIdle          durableWorkerLoopOutcome = "idle"
	durableWorkerLoopOutcomeProcessed     durableWorkerLoopOutcome = "processed"
	durableWorkerLoopOutcomeBackpressured durableWorkerLoopOutcome = "backpressured"
)

type durableWorkerLoopOptions struct {
	Store                  execution.DurableRuntimeStore
	Coordinator            *execution.DurableLeaseCoordinator
	Bridge                 bridge.Client
	WorkerID               string
	WorkerKind             string
	RuntimeVersion         string
	Lane                   execution.DurableLane
	StepID                 string
	LeaseTTL               time.Duration
	LeaseHeartbeatInterval time.Duration
	Now                    func() time.Time
	GenerateLeaseID        func() string
}

type durableWorkerLoop struct {
	store                  execution.DurableRuntimeStore
	coordinator            *execution.DurableLeaseCoordinator
	bridge                 bridge.Client
	workerID               string
	workerKind             string
	runtimeVersion         string
	lane                   execution.DurableLane
	stepID                 string
	leaseTTL               time.Duration
	leaseHeartbeatInterval time.Duration
	now                    func() time.Time
	generateLeaseID        func() string
	mu                     sync.RWMutex
	started                bool
	lastOutcome            durableWorkerLoopOutcome
	lastRunID              string
	lastLeaseID            string
	lastError              string
	lastIterationAt        time.Time
}

type durableWorkerLoopIteration struct {
	Outcome durableWorkerLoopOutcome
	RunID   string
	LeaseID string
	Status  execution.DurableRunStatus
}

type durableWorkerLoopStatus struct {
	Configured      bool
	Started         bool
	Healthy         bool
	WorkerID        string
	Lane            execution.DurableLane
	StepID          string
	LastOutcome     durableWorkerLoopOutcome
	LastRunID       string
	LastLeaseID     string
	LastError       string
	LastIterationAt time.Time
}

func newDurableWorkerLoop(options durableWorkerLoopOptions) *durableWorkerLoop {
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &durableWorkerLoop{
		store:                  options.Store,
		coordinator:            options.Coordinator,
		bridge:                 options.Bridge,
		workerID:               strings.TrimSpace(options.WorkerID),
		workerKind:             defaultString(strings.TrimSpace(options.WorkerKind), "execution-control"),
		runtimeVersion:         strings.TrimSpace(options.RuntimeVersion),
		lane:                   options.Lane,
		stepID:                 strings.TrimSpace(options.StepID),
		leaseTTL:               options.LeaseTTL,
		leaseHeartbeatInterval: options.LeaseHeartbeatInterval,
		now:                    now,
		generateLeaseID:        options.GenerateLeaseID,
	}
}

func (l *durableWorkerLoop) RunOnce(ctx context.Context) (durableWorkerLoopIteration, error) {
	result, err := l.runOnce(ctx)
	l.recordIteration(result, err)
	return result, err
}

func (l *durableWorkerLoop) Run(ctx context.Context, interval time.Duration) error {
	if interval <= 0 {
		return fmt.Errorf("durable worker loop interval is required")
	}
	if _, err := l.RunOnce(ctx); err != nil && !durableWorkerLoopPollError(err) {
		return err
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if _, err := l.RunOnce(ctx); err != nil && !durableWorkerLoopPollError(err) {
				return err
			}
		}
	}
}

func (l *durableWorkerLoop) runOnce(ctx context.Context) (durableWorkerLoopIteration, error) {
	if l == nil || l.store == nil || l.coordinator == nil {
		return durableWorkerLoopIteration{}, execution.ErrDurableRuntimeStoreNotConfigured
	}
	if l.bridge == nil || !l.bridge.Configured() {
		return durableWorkerLoopIteration{}, errDurableWorkerLoopBridgeNotConfigured
	}
	if l.workerID == "" {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop worker_id is required")
	}
	if l.stepID == "" {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop step_id is required")
	}
	if l.lane == "" {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop lane is required")
	}
	if l.leaseTTL <= 0 {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop lease_ttl is required")
	}
	if l.leaseHeartbeatInterval <= 0 {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop lease heartbeat interval is required")
	}
	if l.leaseHeartbeatInterval >= l.leaseTTL {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop lease heartbeat interval must be shorter than lease_ttl")
	}
	if l.generateLeaseID == nil {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop lease id generator is required")
	}
	now := l.now().UTC()
	if err := l.store.UpsertWorkerHeartbeat(ctx, execution.WorkerHeartbeat{
		WorkerID:       l.workerID,
		WorkerKind:     l.workerKind,
		Lanes:          []execution.DurableLane{l.lane},
		RuntimeVersion: l.runtimeVersion,
		Status:         execution.WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now,
		Metadata: map[string]any{
			"step_id": l.stepID,
		},
	}); err != nil {
		return durableWorkerLoopIteration{}, err
	}
	leaseID := strings.TrimSpace(l.generateLeaseID())
	if leaseID == "" {
		return durableWorkerLoopIteration{}, fmt.Errorf("durable worker loop generated empty lease_id")
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       l.store,
		Coordinator: l.coordinator,
		Bridge:      l.bridge,
		WorkerID:    l.workerID,
		StepID:      l.stepID,
		Lane:        l.lane,
		LeaseID:     leaseID,
		Now: func() time.Time {
			return l.now().UTC()
		},
		LeaseTTL:               l.leaseTTL,
		LeaseHeartbeatInterval: l.leaseHeartbeatInterval,
	})
	result, err := executor.ProcessNext(ctx)
	if err != nil {
		if errors.Is(err, execution.ErrNoQueuedDurableRun) {
			return durableWorkerLoopIteration{
				Outcome: durableWorkerLoopOutcomeIdle,
			}, nil
		}
		if errors.Is(err, execution.ErrLaneBudgetExceeded) {
			return durableWorkerLoopIteration{
				Outcome: durableWorkerLoopOutcomeBackpressured,
			}, err
		}
		return durableWorkerLoopIteration{}, err
	}
	return durableWorkerLoopIteration{
		Outcome: durableWorkerLoopOutcomeProcessed,
		RunID:   result.RunID,
		LeaseID: result.LeaseID,
		Status:  result.Status,
	}, nil
}

func durableWorkerLoopPollError(err error) bool {
	return errors.Is(err, execution.ErrLaneBudgetExceeded)
}

func (l *durableWorkerLoop) Status() durableWorkerLoopStatus {
	if l == nil {
		return durableWorkerLoopStatus{Configured: false, Healthy: false}
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	return durableWorkerLoopStatus{
		Configured:      true,
		Started:         l.started,
		Healthy:         l.lastError == "",
		WorkerID:        l.workerID,
		Lane:            l.lane,
		StepID:          l.stepID,
		LastOutcome:     l.lastOutcome,
		LastRunID:       l.lastRunID,
		LastLeaseID:     l.lastLeaseID,
		LastError:       l.lastError,
		LastIterationAt: l.lastIterationAt,
	}
}

func (l *durableWorkerLoop) recordIteration(result durableWorkerLoopIteration, err error) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.started = true
	l.lastOutcome = result.Outcome
	l.lastRunID = result.RunID
	l.lastLeaseID = result.LeaseID
	l.lastIterationAt = l.now().UTC()
	if err != nil {
		l.lastError = err.Error()
		return
	}
	l.lastError = ""
}
