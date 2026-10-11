package executionapplication

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

type ToolAuthorizationStore interface {
	GetRun(context.Context, string) (execution.DurableRun, error)
	ListRunSteps(context.Context, string) ([]execution.RunStepProjection, error)
	GetWorkflowStartIntent(context.Context, string) (execution.WorkflowStartIntent, error)
}
type RunToolAuthorizerOptions struct {
	Store       ToolAuthorizationStore
	StoreError  error
	InputLoader execution.InputLoader
	InputError  error
}
type RunToolAuthorizer struct {
	store       ToolAuthorizationStore
	storeError  error
	inputLoader execution.InputLoader
	inputError  error
}

func NewRunToolAuthorizer(o RunToolAuthorizerOptions) *RunToolAuthorizer {
	return &RunToolAuthorizer{store: o.Store, storeError: o.StoreError, inputLoader: o.InputLoader, inputError: o.InputError}
}

type AgentToolAccessContext struct {
	ExcludedResultRefs []string
	ActivityAttempt    int
	CitationStart      int
	DeadlineAt         time.Time
	InvocationID       string
	RequestID          string
	ResultLimit        int
	UserGoal           string
	WorkflowStepID     string
}

type CampusSearchRequest struct {
	AccessContext AgentToolAccessContext
	SearchQuery   string
	SearchGoal    string
}

type PersonalMemoryRecallRequest struct {
	AccessContext AgentToolAccessContext
	Query         string
}

type agentToolConflictError struct{ cause error }

func (agentToolConflictError) Error() string {
	return "agent tool request conflicts with run state"
}

func (e agentToolConflictError) Unwrap() error { return e.cause }

func IsAgentToolConflict(err error) bool {
	var conflict agentToolConflictError
	return errors.As(err, &conflict)
}

func (s *RunToolAuthorizer) validateRun(
	ctx context.Context,
	access AgentToolAccessContext,
	toolName string,
) (execution.DurableRun, error) {
	if s == nil || s.store == nil {
		if s != nil && s.storeError != nil {
			return execution.DurableRun{}, s.storeError
		}
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.store.GetRun(ctx, strings.TrimSpace(access.RequestID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status != execution.DurableRunStatusRunning {
		return execution.DurableRun{}, newAgentToolConflict(errors.New("agent tool run is not running"))
	}
	steps, err := s.store.ListRunSteps(ctx, run.RequestID)
	if err != nil {
		return execution.DurableRun{}, err
	}
	step, latestAttempt, ok := latestWorkflowOperationStep(steps, access.WorkflowStepID)
	if !ok {
		return execution.DurableRun{}, newAgentToolConflict(
			errors.New("executor step admission projection is unavailable"),
		)
	}
	if latestAttempt != access.ActivityAttempt {
		return execution.DurableRun{}, newAgentToolConflict(
			errors.New("workflow tool activity_attempt does not match its executor attempt"),
		)
	}
	if !execution.ContainsString(
		stringSliceFromAny(step.SanitizedPayload["visible_function_tool_names"]),
		toolName,
	) {
		return execution.DurableRun{}, newAgentToolConflict(
			errors.New("agent tool is not admitted for this run"),
		)
	}
	return run, nil
}

func (s *RunToolAuthorizer) loadExecutionPayload(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	if s.inputLoader == nil {
		cause := s.inputError
		if cause == nil {
			cause = errors.New("execution input loader is not configured")
		}
		return nil, execution.NewInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	wire, err := s.inputLoader.Load(ctx, run)
	if err != nil {
		return nil, err
	}
	return execution.PayloadMap(wire), nil
}

func latestWorkflowOperationStep(
	steps []execution.RunStepProjection,
	stepID string,
) (execution.RunStepProjection, int, bool) {
	var latest execution.RunStepProjection
	latestAttempt := 0
	found := false
	stepID = strings.TrimSpace(stepID)
	for _, step := range steps {
		if step.StepID != stepID || step.Status != "started" {
			continue
		}
		if step.StepKind != "executor" && step.StepKind != "solver" {
			continue
		}
		attempt := step.ActivityAttempt
		if attempt <= 0 {
			attempt, _ = execution.PositiveIntValue(step.SanitizedPayload["activity_attempt"])
		}
		if attempt <= 0 {
			continue
		}
		if !found || attempt > latestAttempt ||
			(attempt == latestAttempt && step.UpdatedAt.After(latest.UpdatedAt)) {
			latest = step
			latestAttempt = attempt
			found = true
		}
	}
	return latest, latestAttempt, found
}

func stringSliceFromAny(value any) []string {
	var result []string
	switch typed := value.(type) {
	case []string:
		return append(result, typed...)
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
	}
	return result
}

func newAgentToolConflict(cause error) error {
	return agentToolConflictError{cause: cause}
}
