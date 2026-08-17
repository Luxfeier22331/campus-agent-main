package executionreconciler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

const (
	temporalReconcileInterval = time.Second
	temporalReconcileBatch    = 32
	temporalIntentLease       = 30 * time.Second
	temporalRetryMaximum      = 30 * time.Second

	WorkflowStartNotDispatchedFailure    = "workflow_start_not_dispatched_invalid"
	WorkflowStartPostDispatchFailure     = "workflow_start_after_dispatch_invalid"
	WorkflowStartRemoteConflictFailure   = "workflow_start_remote_identity_conflict"
	WorkflowExecutionTerminatedFailure   = "workflow_terminated_without_terminal_projection"
	WorkflowCompletedUnprojectedFailure  = "workflow_completed_without_terminal_projection"
	WorkflowFailedUnprojectedFailure     = "workflow_failed_without_terminal_projection"
	WorkflowCanceledUnprojectedFailure   = "workflow_canceled_without_terminal_projection"
	WorkflowUnauthorizedSuccessorFailure = "workflow_successor_without_authorization"
)

type Finalizer interface {
	FailWorkflowStart(context.Context, execution.DurableRun, string, error) error
	FinalizeExecutionCancellation(
		context.Context,
		temporalruntime.FinalizeExecutionCancellationActivityInput,
	) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error)
	FinalizeWorkflowClosure(context.Context, execution.DurableRun, time.Time, string) error
	FinalizeWorkflowTimeout(context.Context, execution.DurableRun, time.Time) error
	ValidateWorkflowAdmission(temporalruntime.AgentAdmissionSnapshot, []string) error
}

type Options struct {
	Finalizer        Finalizer
	Logger           *slog.Logger
	OperationTimeout time.Duration
	Starter          temporalruntime.ChatWorkflowStarter
	Store            execution.RunProjectionStore
}

type Reconciler struct {
	activeWorkflowCursor string
	cancel               context.CancelFunc
	finalizer            Finalizer
	logger               *slog.Logger
	mu                   sync.Mutex
	operationTimeout     time.Duration
	projectionStore      execution.RunProjectionStore
	starter              temporalruntime.ChatWorkflowStarter
	wake                 chan struct{}
	wg                   sync.WaitGroup
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
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		return
	}
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithCancel(parent)
	r.cancel = cancel
	r.wake = make(chan struct{}, 1)
	r.wg.Add(1)
	go r.loop(ctx)
}

func (r *Reconciler) Stop() {
	if r == nil {
		return
	}
	r.mu.Lock()
	cancel := r.cancel
	r.cancel = nil
	r.wake = nil
	r.mu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	r.wg.Wait()
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
	defer r.mu.Unlock()
	if r.wake == nil {
		return
	}
	select {
	case r.wake <- struct{}{}:
	default:
	}
}

func (r *Reconciler) loop(ctx context.Context) {
	defer r.wg.Done()
	r.reconcile(ctx)
	ticker := time.NewTicker(temporalReconcileInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.wake:
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

func (r *Reconciler) store() execution.RunProjectionStore {
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
		if key, ok := args[index].(string); ok && key == "run_id" {
			attributes = append(attributes, key, args[index+1])
		}
	}
	r.logger.Warn("execution_control.reconciliation_warning", attributes...)
}
