package execution

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

var (
	ErrWorkflowRunExists   = errors.New("workflow run already exists")
	ErrWorkflowRunNotFound = errors.New("workflow run not found")
	ErrInvalidWorkflowRun  = errors.New("invalid workflow run")
)

type WorkflowRunStore interface {
	Create(context.Context, WorkflowRun) (WorkflowRun, error)
	Get(context.Context, string) (WorkflowRun, error)
	AppendHandoff(context.Context, string, HandoffStep) (WorkflowRun, error)
	AppendStep(context.Context, string, WorkflowStep) (WorkflowRun, error)
	AppendStepOutputProjection(context.Context, string, StepOutputProjection) (WorkflowRun, error)
	Complete(context.Context, string, WorkflowState) (WorkflowRun, error)
}

type InMemoryWorkflowRunStore struct {
	mu   sync.RWMutex
	runs map[string]WorkflowRun
}

func NewInMemoryWorkflowRunStore() *InMemoryWorkflowRunStore {
	return &InMemoryWorkflowRunStore{
		runs: map[string]WorkflowRun{},
	}
}

func (s *InMemoryWorkflowRunStore) Create(_ context.Context, run WorkflowRun) (WorkflowRun, error) {
	if run.RunID == "" {
		return WorkflowRun{}, fmt.Errorf("%w: run_id is required", ErrInvalidWorkflowRun)
	}
	if run.State == "" {
		run.State = WorkflowStatePending
	}
	if err := validateWorkflowRun(run); err != nil {
		return WorkflowRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.runs[run.RunID]; exists {
		return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunExists, run.RunID)
	}
	s.runs[run.RunID] = cloneWorkflowRun(run)
	return cloneWorkflowRun(run), nil
}

func (s *InMemoryWorkflowRunStore) Get(_ context.Context, runID string) (WorkflowRun, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run, exists := s.runs[runID]
	if !exists {
		return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
	}
	return cloneWorkflowRun(run), nil
}

func (s *InMemoryWorkflowRunStore) AppendHandoff(
	_ context.Context,
	runID string,
	handoff HandoffStep,
) (WorkflowRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
	}
	run.HandoffChain = append(run.HandoffChain, cloneHandoffStep(handoff))
	if err := validateWorkflowRun(run); err != nil {
		return WorkflowRun{}, err
	}
	s.runs[runID] = cloneWorkflowRun(run)
	return cloneWorkflowRun(run), nil
}

func (s *InMemoryWorkflowRunStore) AppendStep(
	_ context.Context,
	runID string,
	step WorkflowStep,
) (WorkflowRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
	}
	run.Steps = append(run.Steps, step)
	if err := validateWorkflowRun(run); err != nil {
		return WorkflowRun{}, err
	}
	s.runs[runID] = cloneWorkflowRun(run)
	return cloneWorkflowRun(run), nil
}

func (s *InMemoryWorkflowRunStore) AppendStepOutputProjection(
	_ context.Context,
	runID string,
	projection StepOutputProjection,
) (WorkflowRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
	}
	run.ContextProjections = append(run.ContextProjections, CloneStepOutputProjection(projection))
	if err := validateWorkflowRun(run); err != nil {
		return WorkflowRun{}, err
	}
	s.runs[runID] = cloneWorkflowRun(run)
	return cloneWorkflowRun(run), nil
}

func (s *InMemoryWorkflowRunStore) Complete(
	_ context.Context,
	runID string,
	state WorkflowState,
) (WorkflowRun, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[runID]
	if !exists {
		return WorkflowRun{}, fmt.Errorf("%w: %s", ErrWorkflowRunNotFound, runID)
	}
	run.State = state
	if run.State == "" {
		run.State = WorkflowStateCompleted
	}
	if err := validateWorkflowRun(run); err != nil {
		return WorkflowRun{}, err
	}
	s.runs[runID] = cloneWorkflowRun(run)
	return cloneWorkflowRun(run), nil
}

func validateWorkflowRun(run WorkflowRun) error {
	switch run.Mode {
	case "", WorkflowModeTerminal, WorkflowModeDirectRuntime, WorkflowModeSingleHandoff, WorkflowModeMultiStep:
	default:
		return fmt.Errorf("%w: unsupported workflow mode %q", ErrInvalidWorkflowRun, run.Mode)
	}
	switch run.State {
	case "", WorkflowStatePending, WorkflowStateRunning, WorkflowStateCompleted,
		WorkflowStateFailed, WorkflowStateCanceled, WorkflowStateTimedOut:
	default:
		return fmt.Errorf("%w: unsupported workflow state %q", ErrInvalidWorkflowRun, run.State)
	}
	if run.Mode == WorkflowModeMultiStep && run.State == WorkflowStateCompleted &&
		len(run.HandoffChain) < 2 {
		return fmt.Errorf(
			"%w: completed multi_step workflow requires at least two handoff steps",
			ErrInvalidWorkflowRun,
		)
	}
	return nil
}

func cloneWorkflowRun(run WorkflowRun) WorkflowRun {
	clone := run
	clone.HandoffChain = make([]HandoffStep, 0, len(run.HandoffChain))
	for _, handoff := range run.HandoffChain {
		clone.HandoffChain = append(clone.HandoffChain, cloneHandoffStep(handoff))
	}
	clone.Steps = append([]WorkflowStep{}, run.Steps...)
	clone.ContextProjections = make([]StepOutputProjection, 0, len(run.ContextProjections))
	for _, projection := range run.ContextProjections {
		clone.ContextProjections = append(
			clone.ContextProjections,
			CloneStepOutputProjection(projection),
		)
	}
	return clone
}

func cloneHandoffStep(handoff HandoffStep) HandoffStep {
	clone := handoff
	clone.AllowedTools = append([]string{}, handoff.AllowedTools...)
	return clone
}
