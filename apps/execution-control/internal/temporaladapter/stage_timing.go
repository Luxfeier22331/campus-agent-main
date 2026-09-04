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
	for _, attempt := range attempts {
		duration := stepAttemptDuration(attempt)
		stepID := strings.TrimSpace(attempt.StepID)
		switch {
		case strings.HasPrefix(stepID, "sdk_tool.execute."):
			addStageTimingDuration(timing, "tool.total_ms", duration)
			if field := stageTimingToolField(attempt); field != "" {
				addStageTimingDuration(timing, field, duration)
			}
		case stepID == "agent.primary":
			addStageTimingDuration(timing, "agent.primary_ms", duration)
			addStageTimingDuration(
				timing,
				"agent.schedule_to_start_ms",
				time.Duration(attempt.ScheduleToStartMS)*time.Millisecond,
			)
		}
	}
	for _, item := range additional {
		addStageTimingDuration(timing, item.field, item.duration)
	}
	return timing, nil
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
