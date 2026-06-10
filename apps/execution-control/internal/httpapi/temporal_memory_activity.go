package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) MemoryRecallActivity(
	ctx context.Context,
	input temporalruntime.MemoryRecallActivityInput,
) (temporalruntime.MemoryRecallActivityOutput, error) {
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	request, err := memoryRecallRequestForRun(run, input.RequestedCapability)
	if err != nil {
		return s.failMemoryRecallActivity(ctx, run, "memory_recall_request_invalid", err)
	}
	startedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    defaultString(strings.TrimSpace(input.RequestedCapability), "knowledge"),
		Run:           run,
		Status:        "started",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/recall"),
		Payload: map[string]any{
			"requested_capability": request.RequestedCapability,
			"user_id":              request.UserID,
		},
	}); err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	result, err := s.recallPersonalMemory(ctx, request)
	if err != nil {
		return s.failMemoryRecallActivity(ctx, run, "memory_recall_failed", err)
	}
	if err := s.replaceTemporalMemoryMetadata(ctx, run, func(metadata map[string]any) {
		metadata["memory_ref"] = result.MemoryRef
		metadata["recall_result"] = result
	}); err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    request.RequestedCapability,
		Run:           run,
		Status:        "completed",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "memory_recall_result",
		ProjectionRef: result.MemoryRef,
		Payload: map[string]any{
			"memory_ref":            result.MemoryRef,
			"payload_sha256":        result.PayloadSHA256,
			"selected_memory_chars": result.SelectedMemoryChars,
			"selected_memory_count": result.SelectedMemoryCount,
			"schema_version":        result.SchemaVersion,
		},
	}); err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	return temporalruntime.MemoryRecallActivityOutput{
		MemoryRef:           result.MemoryRef,
		RunID:               run.RunID,
		SelectedMemoryChars: result.SelectedMemoryChars,
		SelectedMemoryCount: result.SelectedMemoryCount,
		Status:              "completed",
	}, nil
}
