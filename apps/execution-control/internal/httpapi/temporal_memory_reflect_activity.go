package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) MemoryReflectActivity(ctx context.Context, input temporalruntime.MemoryReflectActivityInput) (temporalruntime.MemoryReflectActivityOutput, error) {
	run, err := s.temporalActivityRunAllowTerminal(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.MemoryReflectActivityOutput{}, err
	}
	startedAt := time.Now().UTC()
	request, err := memoryReflectRequestForRun(run, input)
	if err != nil {
		output, projectErr := s.projectMemoryReflectFailure(ctx, run, "memory_reflect_request_invalid", err)
		if projectErr == nil {
			s.recordPersonalMemoryOperation("reflect", "failed", "memory_reflect_request_invalid", startedAt, 0, 0)
		}
		return output, projectErr
	}
	if s.personalMemoryErr != nil {
		output, projectErr := s.projectMemoryReflectFailure(ctx, run, "personal_memory_not_configured", s.personalMemoryErr)
		if projectErr == nil {
			s.recordPersonalMemoryOperation("reflect", "failed", "personal_memory_not_configured", startedAt, 0, 0)
		}
		return output, projectErr
	}
	if s.personalMemoryExecutor == nil {
		output, projectErr := s.projectMemoryReflectFailure(ctx, run, "personal_memory_not_configured", errors.New("personal memory executor is not configured"))
		if projectErr == nil {
			s.recordPersonalMemoryOperation("reflect", "failed", "personal_memory_not_configured", startedAt, 0, 0)
		}
		return output, projectErr
	}
	result, err := s.personalMemoryExecutor.Reflect(ctx, request)
	if err != nil {
		output, projectErr := s.projectMemoryReflectFailure(ctx, run, "hindsight_reflect_failed", err)
		if projectErr == nil {
			s.recordPersonalMemoryOperation("reflect", "failed", "hindsight_reflect_failed", startedAt, 0, 0)
		}
		return output, projectErr
	}
	output, err := s.projectMemoryReflectResult(ctx, run, memoryReflectActivityOutput(result))
	if err == nil {
		s.recordPersonalMemoryOperation("reflect", output.Status, "none", startedAt, len(output.BasedOnMemoryItems), len([]rune(output.Text)))
	}
	return output, err
}

func memoryReflectRequestForRun(run execution.DurableRun, input temporalruntime.MemoryReflectActivityInput) (memoryruntime.ReflectRequest, error) {
	payload, ok := run.Metadata["execution_payload"].(map[string]any)
	if !ok {
		return memoryruntime.ReflectRequest{}, errors.New("run metadata.execution_payload must be an object")
	}
	query := strings.TrimSpace(input.Query)
	if query == "" {
		query = strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	}
	ownerGeneration, ownerSequence, err := memoryOwnerFenceFromPayload(payload)
	if err != nil {
		return memoryruntime.ReflectRequest{}, err
	}
	request := memoryruntime.ReflectRequest{
		Context:         strings.TrimSpace(input.Context),
		IncludeBasedOn:  input.IncludeBasedOn,
		OwnerGeneration: ownerGeneration,
		OwnerSequence:   ownerSequence,
		Query:           query,
		RunID:           run.RunID,
		SessionSlots:    memorySessionSlotsFromPayload(payload),
		TenantID:        firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id")),
		ThreadID:        run.ConversationID,
		UserID: firstNonEmptyText(
			nestedAny(payload, "actor", "user_id"),
			nestedAny(payload, "context", "actor", "user_id"),
			run.OwnerUserID,
		),
	}
	if len(input.SessionSlots) > 0 {
		request.SessionSlots = input.SessionSlots
	}
	if err := memoryruntime.ValidateReflectRequest(request); err != nil {
		return memoryruntime.ReflectRequest{}, err
	}
	return request, nil
}

func memoryReflectActivityOutput(result memoryruntime.ReflectResult) temporalruntime.MemoryReflectActivityOutput {
	items := make([]temporalruntime.MemoryReflectContextItem, 0, len(result.BasedOnMemoryItems))
	for _, item := range result.BasedOnMemoryItems {
		items = append(items, temporalruntime.MemoryReflectContextItem{
			Tool: item.Tool, CompactText: item.CompactText, MemoryID: item.MemoryID,
			MemoryType: item.MemoryType, Score: item.Score, UpdatedAt: item.UpdatedAt,
		})
	}
	return temporalruntime.MemoryReflectActivityOutput{
		BasedOnMemoryItems: items, PayloadSHA256: result.PayloadSHA256, Provider: result.Provider,
		ReflectRef: result.ReflectRef, RunID: result.RunID, SchemaVersion: result.SchemaVersion,
		Status: result.Status, StructuredOutput: copyAnyMap(result.StructuredOutput), Text: result.Text,
		ThreadID: result.ThreadID,
		Usage: temporalruntime.MemoryReflectTokenUsage{
			CachedTokens: result.Usage.CachedTokens, InputTokens: result.Usage.InputTokens,
			OutputTokens: result.Usage.OutputTokens, TotalTokens: result.Usage.TotalTokens,
		},
	}
}

func (s *Server) projectMemoryReflectResult(ctx context.Context, run execution.DurableRun, output temporalruntime.MemoryReflectActivityOutput) (temporalruntime.MemoryReflectActivityOutput, error) {
	now := time.Now().UTC()
	if strings.TrimSpace(output.ReflectRef) == "" {
		output.ReflectRef = temporalProjectionRef(run.RunID, "memory/reflect")
	}
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt: 1, Tool: "memory", Run: run, Status: output.Status, StepID: "memory.reflect",
		StepKind: "memory", TaskQueue: temporalruntime.ActivityTaskQueueCore,
		WorkerID: s.config.TemporalWorkerIdentity, StartedAt: now, CompletedAt: now, UpdatedAt: now,
		ResultKind: "memory_reflect_result", ProjectionRef: output.ReflectRef,
		Payload: memoryReflectProjectionPayload(output),
	}); err != nil {
		return temporalruntime.MemoryReflectActivityOutput{}, err
	}
	return output, nil
}

func (s *Server) projectMemoryReflectFailure(ctx context.Context, run execution.DurableRun, failureKind string, cause error) (temporalruntime.MemoryReflectActivityOutput, error) {
	output := temporalruntime.MemoryReflectActivityOutput{
		ReflectRef: temporalProjectionRef(run.RunID, "memory/reflect"), RunID: run.RunID,
		SchemaVersion: "memory_reflect_result_v1", Status: "failed",
	}
	now := time.Now().UTC()
	payload := memoryReflectProjectionPayload(output)
	payload["failure_kind"] = failureKind
	payload["failure_hash"] = memoryFailureHash(cause)
	if err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt: 1, Tool: "memory", Run: run, Status: "failed", StepID: "memory.reflect",
		StepKind: "memory", TaskQueue: temporalruntime.ActivityTaskQueueCore,
		WorkerID: s.config.TemporalWorkerIdentity, StartedAt: now, CompletedAt: now, UpdatedAt: now,
		ResultKind: "memory_reflect_result", ProjectionRef: output.ReflectRef, Payload: payload,
	}); err != nil {
		return temporalruntime.MemoryReflectActivityOutput{}, err
	}
	return output, nil
}

func memoryReflectProjectionPayload(output temporalruntime.MemoryReflectActivityOutput) map[string]any {
	return map[string]any{
		"based_on_memory_context_items": output.BasedOnMemoryItems, "payload_sha256": output.PayloadSHA256,
		"provider": output.Provider, "reflect_ref": output.ReflectRef, "schema_version": output.SchemaVersion,
		"status": output.Status, "structured_output": copyAnyMap(output.StructuredOutput), "text": output.Text,
		"thread_id": output.ThreadID, "usage": output.Usage,
	}
}
