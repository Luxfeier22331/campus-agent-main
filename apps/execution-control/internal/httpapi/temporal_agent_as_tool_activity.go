package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) ExecuteAgentAsToolActivity(
	ctx context.Context,
	input temporalruntime.ExecuteAgentAsToolActivityInput,
) (temporalruntime.ExecuteAgentAsToolActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.ExecuteAgentAsToolActivityOutput{}, err
	}
	if err := validateAgentAsToolActivityInput(input); err != nil {
		return s.failAgentAsToolActivity(ctx, run, "agent_as_tool_input_invalid", err)
	}
	return s.failAgentAsToolActivity(
		ctx,
		run,
		"agent_as_tool_not_admitted",
		fmt.Errorf("agent-as-tool %s has no admitted online implementation", input.AdmittedAgentID),
	)
}

func validateAgentAsToolActivityInput(input temporalruntime.ExecuteAgentAsToolActivityInput) error {
	if strings.TrimSpace(input.RunID) == "" ||
		strings.TrimSpace(input.StepID) == "" ||
		strings.TrimSpace(input.AdmittedAgentID) == "" {
		return fmt.Errorf("run_id, step_id, and admitted_agent_id are required")
	}
	if len(input.AllowedTools) == 0 {
		return fmt.Errorf("allowed_tools is required")
	}
	if len(input.ContextProjectionRefs) == 0 {
		return fmt.Errorf("context_projection_refs is required")
	}
	if strings.TrimSpace(input.BudgetRef) == "" || strings.TrimSpace(input.TimeoutRef) == "" {
		return fmt.Errorf("budget_ref and timeout_ref are required")
	}
	return nil
}

func (s *Server) failAgentAsToolActivity(
	ctx context.Context,
	run execution.DurableRun,
	failureKind string,
	cause error,
) (temporalruntime.ExecuteAgentAsToolActivityOutput, error) {
	_, err := s.failTemporalRunStep(ctx, run, temporalStepFailureProjection{
		FailureKind:   failureKind,
		ProjectionRef: temporalProjectionRef(run.RunID, "agent-as-tool/failure"),
		ResultKind:    "activity_failure",
		StepID:        "agent_as_tool.execute",
		StepKind:      "agent_as_tool",
		TaskQueue:     temporalruntime.ActivityTaskQueueStructured,
		Payload: map[string]any{
			"failure_kind": failureKind,
			"message":      cause.Error(),
			"occurred_at":  time.Now().UTC().Format(time.RFC3339Nano),
		},
	}, cause)
	return temporalruntime.ExecuteAgentAsToolActivityOutput{}, err
}
