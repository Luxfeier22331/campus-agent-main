package lifecycle

import (
	"context"
	"errors"
	"sync"
	"time"
)

var (
	ErrDuplicateExecution = errors.New("execution already in flight")
	ErrExecutionNotFound  = errors.New("execution not found")
	ErrExecutionCanceled  = errors.New("execution canceled")
)

type State string

const (
	StateAccepted        State = "accepted"
	StateCancelRequested State = "cancel_requested"
	StateCompleted       State = "completed"
	StateFailed          State = "failed"
	StateTimedOut        State = "timed_out"
)

type Metadata struct {
	RequestID string
}

type Execution struct {
	metadata Metadata
	cancel   context.CancelCauseFunc
}

type CancelResult struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

type Status struct {
	ActiveExecutions     int            `json:"active_executions"`
	CancelRequestedCount int            `json:"cancel_requested_count"`
	CompletedRetained    int            `json:"completed_retained"`
	CompletedByState     map[string]int `json:"completed_by_state"`
	States               map[string]int `json:"states"`
}

type Registry struct {
	mu sync.Mutex

	executions           map[string]*record
	cancelRequestedCount int
	completedRetained    int
	completedByState     map[string]int
}

type record struct {
	metadata Metadata
	state    State
	cancel   context.CancelCauseFunc
	started  time.Time
}

func NewRegistry() *Registry {
	return &Registry{
		executions:       make(map[string]*record),
		completedByState: make(map[string]int),
	}
}

func (r *Registry) Register(ctx context.Context, metadata Metadata) (*Execution, context.Context, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if metadata.RequestID == "" {
		return nil, nil, ErrExecutionNotFound
	}
	executionCtx, cancel := context.WithCancelCause(ctx)

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.executions[metadata.RequestID]; exists {
		cancel(ErrDuplicateExecution)
		return nil, nil, ErrDuplicateExecution
	}
	r.executions[metadata.RequestID] = &record{
		metadata: metadata,
		state:    StateAccepted,
		cancel:   cancel,
		started:  time.Now().UTC(),
	}
	return &Execution{metadata: metadata, cancel: cancel}, executionCtx, nil
}

func (r *Registry) Transition(requestID string, state State) {
	r.mu.Lock()
	defer r.mu.Unlock()

	record := r.executions[requestID]
	if record == nil {
		return
	}
	record.state = state
}

func (r *Registry) Complete(requestID string, state State) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.executions[requestID]; !exists {
		return
	}
	if state == "" {
		state = StateFailed
	}
	delete(r.executions, requestID)
	r.completedRetained++
	r.completedByState[string(state)]++
}

func (r *Registry) Cancel(requestID string, reason string) (CancelResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	record := r.executions[requestID]
	if record == nil {
		return CancelResult{}, ErrExecutionNotFound
	}
	record.state = StateCancelRequested
	r.cancelRequestedCount++
	record.cancel(ErrExecutionCanceled)
	return CancelResult{
		RequestID: record.metadata.RequestID,
		Status:    string(StateCancelRequested),
	}, nil
}

func (r *Registry) Canceled(requestID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	record := r.executions[requestID]
	return record != nil && record.state == StateCancelRequested
}

func (r *Registry) Snapshot() Status {
	r.mu.Lock()
	defer r.mu.Unlock()

	states := make(map[string]int)
	for _, record := range r.executions {
		states[string(record.state)]++
	}
	completedByState := make(map[string]int, len(r.completedByState))
	for state, count := range r.completedByState {
		completedByState[state] = count
	}
	return Status{
		ActiveExecutions:     len(r.executions),
		CancelRequestedCount: r.cancelRequestedCount,
		CompletedRetained:    r.completedRetained,
		CompletedByState:     completedByState,
		States:               states,
	}
}

func (e *Execution) RequestID() string {
	if e == nil {
		return ""
	}
	return e.metadata.RequestID
}

func (e *Execution) Cancel() {
	if e == nil || e.cancel == nil {
		return
	}
	e.cancel(ErrExecutionCanceled)
}
