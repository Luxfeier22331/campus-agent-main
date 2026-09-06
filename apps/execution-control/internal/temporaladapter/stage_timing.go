package temporaladapter

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type stageTimingDuration struct {
	field    string
	duration time.Duration
}

const (
	stageTimingWorkflowSolveMS       = "workflow.solve_ms"
	stageTimingWorkflowExecuteStepMS = "workflow.execute_step_ms"
	stageTimingWorkflowReplanMS      = "workflow.replan_ms"
	stageTimingWorkflowSynthesizeMS  = "workflow.synthesize_ms"
	stageTimingWorkflowScheduleMS    = "workflow.schedule_to_start_ms"
	stageTimingWorkflowFirstDeltaMS  = "workflow.first_delta_ms"
)

func (s *Adapter) stageTimingForRun(
	ctx context.Context,
	run execution.DurableRun,
	base map[string]any,
	additional ...stageTimingDuration,
) (map[string]any, error) {
	timing := execution.CloneAnyMapFromValue(base)
	if timing == nil {
		timing = map[string]any{}
	}
	addStageTimingDuration(timing, "execution.dispatch_ms", durationBetween(run.CreatedAt, run.QueuedAt))
	addStageTimingDuration(timing, "execution.admission_ms", durationBetween(run.QueuedAt, run.AdmittedAt))
	addStageTimingDuration(
		timing,
		"stream.first_delta_persist_ms",
		durationBetween(run.StartedAt, run.StreamingStartedAt),
	)
	attempts, err := s.runProjectionStore.ListStepAttempts(ctx, run.RequestID)
	if err != nil {
		return nil, fmt.Errorf("stage timing step attempts unavailable: %w", err)
	}
	results, err := s.runProjectionStore.ListStepResults(ctx, run.RequestID)
	if err != nil {
		return nil, fmt.Errorf("stage timing step results unavailable: %w", err)
	}
	for field, value := range workflowRuntimeStageTimingForResults(results) {
		timing[field] = value
	}
	delete(timing, stageTimingWorkflowScheduleMS)
	for _, attempt := range attempts {
		duration := stepAttemptDuration(attempt)
		stepID := strings.TrimSpace(attempt.StepID)
		switch {
		case strings.HasPrefix(stepID, "sdk_tool.execute."):
			addStageTimingDuration(timing, "tool.total_ms", duration)
			if field := stageTimingToolField(attempt); field != "" {
				addStageTimingDuration(timing, field, duration)
			}
		case workflowOperationForStepID(stepID) != "":
			addStageTimingDuration(
				timing,
				stageTimingWorkflowScheduleMS,
				time.Duration(attempt.ScheduleToStartMS)*time.Millisecond,
			)
		}
	}
	for _, item := range additional {
		addStageTimingDuration(timing, item.field, item.duration)
	}
	return timing, nil
}

func workflowOperationForStepID(stepID string) string {
	switch normalized := strings.TrimSpace(stepID); {
	case normalized == "solve.initial":
		return "solve"
	case strings.HasPrefix(normalized, "task.step."):
		return "execute_step"
	case strings.HasPrefix(normalized, "solve.replan."):
		return "replan"
	case normalized == "answer.synthesize":
		return "synthesize"
	default:
		return ""
	}
}

func workflowRuntimeStageTimingForResults(
	results []execution.StepResultProjection,
) map[string]float64 {
	current := map[string]execution.StepResultProjection{}
	currentAttempts := map[string]int{}
	for _, result := range results {
		if result.Status != "completed" || workflowOperationForStepID(result.StepID) == "" {
			continue
		}
		activityAttempt, valid := execution.PositiveIntValue(result.SanitizedPayload["activity_attempt"])
		if !valid || activityAttempt < currentAttempts[result.StepID] {
			continue
		}
		currentAttempts[result.StepID] = activityAttempt
		current[result.StepID] = result
	}
	values := map[string]float64{}
	for stepID, result := range current {
		operation := workflowOperationForStepID(stepID)
		stageTiming := execution.CloneAnyMapFromValue(result.SanitizedPayload["stage_timing"])
		for field, rawValue := range stageTiming {
			if !workflowRuntimeStageTimingFieldAllowed(operation, field) {
				continue
			}
			value, ok := stageTimingNumber(rawValue)
			if !ok {
				continue
			}
			if field == stageTimingWorkflowFirstDeltaMS {
				values[field] = value
				continue
			}
			values[field] += value
		}
	}
	return values
}

func workflowRuntimeStageTimingFieldAllowed(operation string, field string) bool {
	if field == stageTimingWorkflowFirstDeltaMS {
		return operation == "synthesize"
	}
	return field == "workflow."+operation+"_ms"
}

func stageTimingNumber(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case uint:
		number = float64(typed)
	case uint64:
		number = float64(typed)
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0) && number >= 0
}

func stageTimingToolField(attempt execution.StepAttemptProjection) string {
	tool := execution.StringValue(attempt.SanitizedPayload["tool_name"])
	if tool == "" {
		parts := strings.Split(strings.TrimSpace(attempt.StepID), ".")
		if len(parts) >= 4 && parts[0] == "sdk_tool" && parts[1] == "execute" {
			tool = parts[2]
		}
	}
	switch tool {
	case "personal_memory_recall":
		return "memory.recall_ms"
	default:
		return ""
	}
}

func (s *Adapter) attachStageTimingToFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
	response map[string]any,
	additional ...stageTimingDuration,
) (map[string]any, error) {
	next := execution.CloneAnyMapFromValue(response)
	stageTiming, err := s.stageTimingForRun(
		ctx,
		run,
		execution.CloneAnyMapFromValue(next["stage_timing"]),
		additional...,
	)
	if err != nil {
		return nil, err
	}
	next["stage_timing"] = stageTiming
	return next, nil
}

func stepAttemptDuration(attempt execution.StepAttemptProjection) time.Duration {
	if attempt.DurationMS > 0 {
		return time.Duration(attempt.DurationMS) * time.Millisecond
	}
	return durationBetween(attempt.StartedAt, attempt.CompletedAt)
}

func durationBetween(startedAt time.Time, completedAt time.Time) time.Duration {
	if startedAt.IsZero() || completedAt.IsZero() || completedAt.Before(startedAt) {
		return 0
	}
	return completedAt.Sub(startedAt)
}

func addStageTimingDuration(timing map[string]any, field string, duration time.Duration) {
	if timing == nil || field == "" || duration <= 0 {
		return
	}
	next := float64(duration) / float64(time.Millisecond)
	if next == 0 && duration > 0 {
		next = 0.001
	}
	if math.IsNaN(next) || math.IsInf(next, 0) || next < 0 {
		return
	}
	if existing, ok := timing[field]; ok {
		if numeric, ok := existing.(float64); ok && !math.IsNaN(numeric) && !math.IsInf(numeric, 0) && numeric >= 0 {
			timing[field] = numeric + next
			return
		}
	}
	timing[field] = next
}
