package executionreconciler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"log/slog"
	"strings"
	"sync"
	"time"
)

const (
	temporalReconcileInterval = time.Second
	temporalReconcileBatch    = 32
	temporalIntentLease       = 30 * time.Second
	temporalRetryMaximum      = 30 * time.Second

	WorkflowStartNotDispatchedFailure       = "workflow_start_not_dispatched_invalid"
	WorkflowStartPostDispatchFailure        = "workflow_start_after_dispatch_invalid"
	WorkflowStartRemoteConflictFailure      = "workflow_start_remote_identity_conflict"
	WorkflowExecutionTerminatedFailure      = "workflow_terminated_without_terminal_projection"
	WorkflowCompletedUnprojectedFailure     = "workflow_completed_without_terminal_projection"
	WorkflowFailedUnprojectedFailure        = "workflow_failed_without_terminal_projection"
	WorkflowCanceledUnprojectedFailure      = "workflow_canceled_without_terminal_projection"
	WorkflowExecutionClosedInvariantFailure = "runtime_invariant_failed"
)

type Options struct {
	Finalizer        executionapplication.WorkflowFinalizer
	Logger           *slog.Logger
	OperationTimeout time.Duration
	Starter          executionapplication.WorkflowStarter
	Store            executionapplication.RunStore
}

type Reconciler struct {
	activeWorkflowCursor string
	finalizer            executionapplication.WorkflowFinalizer
	logger               *slog.Logger
	mu                   sync.Mutex
	operationTimeout     time.Duration
	projectionStore      executionapplication.RunStore
	run                  *reconcilerRun
	starter              executionapplication.WorkflowStarter
	stopDone             chan struct{}
	stopping             bool
}

type reconcilerRun struct {
	cancel context.CancelFunc
	done   chan struct{}
	wake   chan struct{}
}

func New(options Options) *Reconciler {
	operationTimeout := options.OperationTimeout
	if operationTimeout <= 0 {
		operationTimeout = 5 * time.Second
	}
	return &Reconciler{
		finalizer:        options.Finalizer,
		logger:           options.Logger,
		operationTimeout: operationTimeout,
		projectionStore:  options.Store,
		starter:          options.Starter,
	}
}

func (r *Reconciler) Start(parent context.Context) {
	if r == nil || r.projectionStore == nil || r.starter == nil {
		return
	}
	if parent == nil {
		parent = context.Background()
	}
	r.mu.Lock()
	if r.run != nil || r.stopping {
		r.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(parent)
	current := &reconcilerRun{
		cancel: cancel,
		done:   make(chan struct{}),
		wake:   make(chan struct{}, 1),
	}
	r.run = current
	r.mu.Unlock()
	go r.loop(ctx, current)
}

func (r *Reconciler) Stop() {
	if r == nil {
		return
	}
	r.mu.Lock()
	current := r.run
	if current == nil {
		stopDone := r.stopDone
		r.mu.Unlock()
		if stopDone != nil {
			<-stopDone
		}
		return
	}
	r.run = nil
	r.stopping = true
	stopDone := make(chan struct{})
	r.stopDone = stopDone
	r.mu.Unlock()

	current.cancel()
	<-current.done

	r.mu.Lock()
	r.stopping = false
	r.stopDone = nil
	close(stopDone)
	r.mu.Unlock()
}

func (r *Reconciler) ReconcileOnce(ctx context.Context) {
	if r == nil || r.projectionStore == nil || r.starter == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	r.reconcile(ctx)
}

func (r *Reconciler) Wake() {
	if r == nil {
		return
	}
	r.mu.Lock()
	current := r.run
	r.mu.Unlock()
	if current == nil {
		return
	}
	select {
	case current.wake <- struct{}{}:
	default:
	}
}

func (r *Reconciler) loop(ctx context.Context, current *reconcilerRun) {
	defer close(current.done)
	r.reconcile(ctx)
	ticker := time.NewTicker(temporalReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-current.wake:
			r.reconcile(ctx)
		case <-ticker.C:
			r.reconcile(ctx)
		}
	}
}

func (r *Reconciler) reconcile(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	r.ReconcileCancellations(ctx)
	r.ReconcileStarts(ctx)
	r.ReconcileWorkflowTimeouts(ctx)
}

func LifecycleNow() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }

func lifecycleLeaseToken(prefix string) (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return strings.TrimSpace(prefix) + "-" + hex.EncodeToString(bytes), nil
}

func lifecycleRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	if attempt > 6 {
		attempt = 6
	}
	delay := time.Second << (attempt - 1)
	if delay > temporalRetryMaximum {
		return temporalRetryMaximum
	}
	return delay
}

func boundedLifecycleErrorCode(code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return "temporal_reconciliation_failed"
	}
	if len(code) > 64 {
		return code[:64]
	}
	for _, char := range code {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return "temporal_reconciliation_failed"
	}
	return code
}

func temporalStartErrorCode(err error) string {
	if err == nil {
		return ""
	}
	return "temporal_workflow_start_uncertain"
}

func lifecycleErrorHash(code string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(code)))
	return hex.EncodeToString(digest[:])
}

func (r *Reconciler) store() executionapplication.RunStore {
	if r == nil {
		return nil
	}
	return r.projectionStore
}

func (r *Reconciler) logWarn(_ string, args ...any) {
	if r == nil || r.logger == nil {
		return
	}
	attributes := []any{
		"event_type", "execution_control.reconciliation_warning",
		"status", "failed",
		"failure_kind", "temporal_reconciliation_failed",
		"source", "temporal_reconciler",
	}
	for index := 0; index+1 < len(args); index += 2 {
		if key, ok := args[index].(string); ok && key == "request_id" {
			attributes = append(attributes, key, args[index+1])
		}
	}
	r.logger.Warn("execution_control.reconciliation_warning", attributes...)
}
