package httpapi

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

type stageTimingDuration struct {
	field    string
	duration time.Duration
}

func (s *Server) stageTimingForRun(
	ctx context.Context,
	run execution.DurableRun,
	base map[string]any,
	additional ...stageTimingDuration,
) (map[string]any, error) {
	timing := cloneAnyMapFromMetadata(base)
	if timing == nil {
		timing = map[string]any{}
	}
	addStageTimingDuration(timing, "execution.admission_ms", durationBetween(run.QueuedAt, run.AdmittedAt))
	attempts, err := s.runProjectionStore.ListStepAttempts(ctx, run.RunID)
	if err != nil {
		return nil, fmt.Errorf("stage timing step attempts unavailable: %w", err)
	}
	for _, attempt := range attempts {
		duration := stepAttemptDuration(attempt)
		switch attempt.StepID {
		case "memory.recall":
			addStageTimingDuration(timing, "memory.recall_ms", duration)
		case "agent.primary":
			addStageTimingDuration(timing, "agent.primary_ms", duration)
		case "typed_tool.execute":
			addStageTimingDuration(timing, "tool.total_ms", duration)
			if field := stageTimingToolField(attempt); field != "" {
				addStageTimingDuration(timing, field, duration)
			}
		case "rag.plan":
			addStageTimingDuration(timing, "rag.plan_ms", duration)
		case "retrieval.indexed_lookup", "retrieval.live_source_lookup", "evidence.selection":
			addStageTimingDuration(timing, "rag.lookup_ms", duration)
		case "rag.rerank":
			addStageTimingDuration(timing, "rag.rerank_ms", duration)
		case "synthesis":
			addStageTimingDuration(timing, "rag.synthesis_ms", duration)
			addStageTimingDuration(timing, "tool.total_ms", duration)
			addStageTimingDuration(timing, "tool.knowledge_query_ms", duration)
		case "grounding.verify":
			addStageTimingDuration(timing, "rag.grounding_ms", duration)
		case "finalization.write":
			addStageTimingDuration(timing, "finalization.write_ms", duration)
		}
	}
	for _, item := range additional {
		addStageTimingDuration(timing, item.field, item.duration)
	}
	return timing, nil
}

func stageTimingToolField(attempt execution.StepAttemptProjection) string {
	tool := stringValue(attempt.SanitizedPayload["selected_tool"])
	if tool == "" {
		tool = stringValue(attempt.SanitizedPayload["tool_name"])
	}
	switch tool {
	case "knowledge_query":
		return "tool.knowledge_query_ms"
	case "transport_schedule_lookup":
		return "tool.transport_schedule_lookup_ms"
	case "campus_notice_discover":
		return "tool.campus_notice_discover_ms"
	default:
		return ""
	}
}

func (s *Server) attachStageTimingToFinalizedResponse(
	ctx context.Context,
	run execution.DurableRun,
	response map[string]any,
	additional ...stageTimingDuration,
) (map[string]any, error) {
	next := cloneAnyMapFromMetadata(response)
	stageTiming, err := s.stageTimingForRun(
		ctx,
		run,
		cloneAnyMapFromMetadata(next["stage_timing"]),
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
