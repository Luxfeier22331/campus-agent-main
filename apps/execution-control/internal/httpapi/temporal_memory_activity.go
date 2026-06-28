package httpapi

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) MemoryRecallActivity(
	ctx context.Context,
	input temporalruntime.MemoryRecallActivityInput,
) (temporalruntime.MemoryRecallActivityOutput, error) {
	recordTemporalActivityHeartbeat(ctx, "memory.recall.started")
	run, err := s.temporalActivityRun(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	startedAt := time.Now().UTC()
	payload, ok := run.Metadata["execution_payload"].(map[string]any)
	if !ok {
		s.recordPersonalMemoryOperation("recall", "failed", "memory_recall_request_invalid", startedAt, 0, 0)
		return s.failMemoryRecallActivity(
			ctx,
			run,
			"memory_recall_request_invalid",
			errors.New("run metadata.execution_payload must be an object"),
		)
	}
	enabled, known := memoryEnabledFromExecutionPayload(payload)
	if !known {
		output, err := s.projectSkippedMemoryRecall(ctx, run, input.RequestedTool, "memory_enabled_unknown", startedAt)
		if err == nil {
			s.recordPersonalMemoryOperation("recall", "skipped", "memory_enabled_unknown", startedAt, 0, 0)
		}
		return output, err
	}
	if !enabled {
		output, err := s.projectSkippedMemoryRecall(ctx, run, input.RequestedTool, "memory_disabled", startedAt)
		if err == nil {
			s.recordPersonalMemoryOperation("recall", "skipped", "memory_disabled", startedAt, 0, 0)
		}
		return output, err
	}
	request, err := memoryRecallRequestForRun(run, input.RequestedTool)
	if err != nil {
		s.recordPersonalMemoryOperation("recall", "failed", "memory_recall_request_invalid", startedAt, 0, 0)
		return s.failMemoryRecallActivity(ctx, run, "memory_recall_request_invalid", err)
	}
	recordTemporalActivityHeartbeat(ctx, "memory.recall.request_ready")
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          request.RequestedTool,
		Run:           run,
		Status:        "started",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		UpdatedAt:     startedAt,
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/recall"),
		Payload: map[string]any{
			"requested_tool": request.RequestedTool,
			"user_id":        request.UserID,
		},
	}); err != nil {
		s.recordPersonalMemoryOperation("recall", "failed", "projection_failed", startedAt, 0, 0)
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	recordTemporalActivityHeartbeat(ctx, "memory.recall.call_hindsight")
	result, err := s.recallPersonalMemory(ctx, request)
	if err != nil {
		s.recordPersonalMemoryOperation("recall", "failed", "memory_recall_failed", startedAt, 0, 0)
		return s.failMemoryRecallActivity(ctx, run, "memory_recall_failed", err)
	}
	recordTemporalActivityHeartbeat(ctx, "memory.recall.project_result")
	if err := s.replaceTemporalMemoryMetadata(ctx, run, func(metadata map[string]any) {
		metadata["memory_ref"] = result.MemoryRef
		metadata["recall_result"] = result
	}); err != nil {
		s.recordPersonalMemoryOperation("recall", "failed", "projection_failed", startedAt, 0, 0)
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          request.RequestedTool,
		Run:           run,
		Status:        "completed",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
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
		s.recordPersonalMemoryOperation("recall", "failed", "projection_failed", startedAt, 0, 0)
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	s.recordPersonalMemoryOperation(
		"recall",
		"completed",
		"none",
		startedAt,
		result.SelectedMemoryCount,
		result.SelectedMemoryChars,
	)
	recordTemporalActivityHeartbeat(ctx, "memory.recall.completed")
	return temporalruntime.MemoryRecallActivityOutput{
		ContextBlock:        result.ContextBlock,
		MemoryRef:           result.MemoryRef,
		Provider:            result.Provider,
		RetrievalMode:       result.RetrievalMode,
		RunID:               run.RunID,
		SchemaVersion:       result.SchemaVersion,
		SelectedMemoryChars: result.SelectedMemoryChars,
		SelectedMemoryCount: result.SelectedMemoryCount,
		Status:              "completed",
	}, nil
}

func (s *Server) projectSkippedMemoryRecall(
	ctx context.Context,
	run execution.DurableRun,
	requestedTool string,
	reason string,
	startedAt time.Time,
) (temporalruntime.MemoryRecallActivityOutput, error) {
	tool := memoryRecallToolForRun(run, requestedTool)
	output := temporalruntime.MemoryRecallActivityOutput{
		RunID:         run.RunID,
		SchemaVersion: "memory_recall_result_v1",
		SkipReasons:   []string{reason},
		SkippedCount:  1,
		Status:        "skipped",
	}
	completedAt := time.Now().UTC()
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Tool:          tool,
		Run:           run,
		Status:        "skipped",
		StepID:        "memory.recall",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueCore,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     startedAt,
		CompletedAt:   completedAt,
		UpdatedAt:     completedAt,
		ResultKind:    "memory_recall_result",
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/recall"),
		Payload: map[string]any{
			"schema_version": output.SchemaVersion,
			"skip_reasons":   output.SkipReasons,
			"skipped_count":  output.SkippedCount,
			"status":         output.Status,
		},
	}); err != nil {
		return temporalruntime.MemoryRecallActivityOutput{}, err
	}
	return output, nil
}
