package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) ExtractMemoryCandidatesActivity(
	ctx context.Context,
	input temporalruntime.ExtractMemoryCandidatesActivityInput,
) (temporalruntime.ExtractMemoryCandidatesActivityOutput, error) {
	run, err := s.temporalActivityRunAllowTerminal(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.ExtractMemoryCandidatesActivityOutput{}, err
	}
	payload, _ := run.Metadata["execution_payload"].(map[string]any)
	enabled, known := memoryEnabledFromExecutionPayload(payload)
	if !known {
		return skippedMemoryExtractOutput(run.RunID, "memory_enabled_unknown"), nil
	}
	if !enabled {
		return skippedMemoryExtractOutput(run.RunID, "memory_disabled"), nil
	}
	userGoal := strings.TrimSpace(optionalStringFromAny(payload["user_goal"]))
	candidates := inferredMemoryCandidatesFromUserGoal(run, userGoal)
	output := temporalruntime.ExtractMemoryCandidatesActivityOutput{
		CandidateCount: len(candidates),
		Candidates:     candidates,
		RunID:          run.RunID,
		SchemaVersion:  "memory_update_extract_result_v1",
		Status:         "completed",
	}
	if len(candidates) == 0 {
		output.Status = "skipped"
		output.SkippedCount = 1
		output.SkipReasons = []string{"no_high_confidence_memory"}
	}
	return output, nil
}

func (s *Server) UpsertInferredMemoryActivity(
	ctx context.Context,
	input temporalruntime.UpsertInferredMemoryActivityInput,
) (temporalruntime.UpsertInferredMemoryActivityOutput, error) {
	run, err := s.temporalActivityRunAllowTerminal(ctx, input.RunID, input.TraceID)
	if err != nil {
		return temporalruntime.UpsertInferredMemoryActivityOutput{}, err
	}
	payload, _ := run.Metadata["execution_payload"].(map[string]any)
	enabled, known := memoryEnabledFromExecutionPayload(payload)
	if !known {
		return s.projectMemoryUpdateResult(
			ctx,
			run,
			skippedMemoryUpsertOutput(run.RunID, "memory_enabled_unknown"),
		)
	}
	if !enabled {
		return s.projectMemoryUpdateResult(ctx, run, skippedMemoryUpsertOutput(run.RunID, "memory_disabled"))
	}
	if len(input.Candidates) == 0 {
		return s.projectMemoryUpdateResult(ctx, run, skippedMemoryUpsertOutput(run.RunID, "no_candidates"))
	}
	now := time.Now().UTC().Format(time.RFC3339)
	upserted := 0
	skipped := 0
	reasons := []string{}
	for _, candidate := range input.Candidates {
		request := memoryruntime.UpsertRequest{
			Capability:  strings.TrimSpace(candidate.Capability),
			CompactText: strings.TrimSpace(candidate.CompactText),
			MemoryID:    strings.TrimSpace(candidate.MemoryID),
			MemoryType:  strings.TrimSpace(candidate.MemoryType),
			Source:      "inferred",
			Status:      "active",
			TenantID:    firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id")),
			UpdatedAt:   now,
			UserID: firstNonEmptyText(
				nestedAny(payload, "actor", "user_id"),
				nestedAny(payload, "context", "actor", "user_id"),
				run.OwnerUserID,
			),
		}
		if err := memoryruntime.ValidateUpsertRequest(request); err != nil {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, "invalid_candidate")
			continue
		}
		if _, err := s.upsertPersonalMemory(ctx, request); err != nil {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, "upsert_failed")
			continue
		}
		upserted++
	}
	output := temporalruntime.UpsertInferredMemoryActivityOutput{
		RunID:         run.RunID,
		SchemaVersion: "memory_update_result_v1",
		SkipReasons:   reasons,
		SkippedCount:  skipped,
		Status:        "completed",
		UpsertedCount: upserted,
	}
	if upserted == 0 {
		output.Status = "skipped"
	}
	hash, err := memoryruntime.HashProjection(map[string]any{
		"run_id":         output.RunID,
		"schema_version": output.SchemaVersion,
		"skip_reasons":   output.SkipReasons,
		"skipped_count":  output.SkippedCount,
		"status":         output.Status,
		"upserted_count": output.UpsertedCount,
	})
	if err == nil {
		output.PayloadSHA256 = hash
	}
	return s.projectMemoryUpdateResult(ctx, run, output)
}

func (s *Server) temporalActivityRunAllowTerminal(
	ctx context.Context,
	runID string,
	traceID string,
) (execution.DurableRun, error) {
	if s == nil || s.runProjectionStore == nil {
		return execution.DurableRun{}, execution.ErrRunProjectionStoreNotConfigured
	}
	run, err := s.runProjectionStore.GetRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return execution.DurableRun{}, err
	}
	if run.TraceID != traceID {
		return execution.DurableRun{}, fmt.Errorf(
			"activity trace_id %s does not match run trace_id %s",
			traceID,
			run.TraceID,
		)
	}
	return run, nil
}

func memoryEnabledFromExecutionPayload(payload map[string]any) (bool, bool) {
	value := nestedAny(payload, "context", "memory", "enabled")
	enabled, ok := value.(bool)
	return enabled, ok
}

func skippedMemoryExtractOutput(runID string, reason string) temporalruntime.ExtractMemoryCandidatesActivityOutput {
	return temporalruntime.ExtractMemoryCandidatesActivityOutput{
		RunID:         strings.TrimSpace(runID),
		SchemaVersion: "memory_update_extract_result_v1",
		SkipReasons:   []string{reason},
		SkippedCount:  1,
		Status:        "skipped",
	}
}

func skippedMemoryUpsertOutput(runID string, reason string) temporalruntime.UpsertInferredMemoryActivityOutput {
	return temporalruntime.UpsertInferredMemoryActivityOutput{
		RunID:         strings.TrimSpace(runID),
		SchemaVersion: "memory_update_result_v1",
		SkipReasons:   []string{reason},
		SkippedCount:  1,
		Status:        "skipped",
	}
}

func inferredMemoryCandidatesFromUserGoal(
	run execution.DurableRun,
	userGoal string,
) []temporalruntime.MemoryCandidate {
	normalized := strings.TrimSpace(userGoal)
	if normalized == "" || containsForbiddenMemoryIntent(normalized) {
		return nil
	}
	for _, marker := range []string{"之后主要关注", "以后主要关注", "长期关注"} {
		before, after, ok := strings.Cut(normalized, marker)
		if !ok || strings.TrimSpace(before) != "我" {
			continue
		}
		target := strings.Trim(after, " 。.，,")
		if target == "" {
			return nil
		}
		compactText := "近期目标: 关注" + target
		return []temporalruntime.MemoryCandidate{{
			Capability:  "any",
			CompactText: compactText,
			Confidence:  0.95,
			MemoryID:    "inf_" + memoryruntime.PointID(run.OwnerUserID, compactText)[:16],
			MemoryType:  "goal",
		}}
	}
	return nil
}

func containsForbiddenMemoryIntent(value string) bool {
	normalized := strings.ToLower(value)
	for _, marker := range []string{
		"api_key",
		"authorization",
		"bearer",
		"权限",
		"角色",
		"密钥",
		"secret",
		"token",
	} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}

func (s *Server) projectMemoryUpdateResult(
	ctx context.Context,
	run execution.DurableRun,
	output temporalruntime.UpsertInferredMemoryActivityOutput,
) (temporalruntime.UpsertInferredMemoryActivityOutput, error) {
	now := time.Now().UTC()
	payload := map[string]any{
		"payload_sha256": output.PayloadSHA256,
		"schema_version": output.SchemaVersion,
		"skip_reasons":   output.SkipReasons,
		"skipped_count":  output.SkippedCount,
		"status":         output.Status,
		"upserted_count": output.UpsertedCount,
	}
	err := s.projectTemporalStep(ctx, temporalStepProjection{
		Attempt:       1,
		Capability:    "memory",
		Run:           run,
		Status:        output.Status,
		StepID:        "memory.update.upsert",
		StepKind:      "memory",
		TaskQueue:     temporalruntime.ActivityTaskQueueContext,
		WorkerID:      s.config.TemporalWorkerIdentity,
		StartedAt:     now,
		CompletedAt:   now,
		UpdatedAt:     now,
		ResultKind:    "memory_update_result",
		ProjectionRef: temporalProjectionRef(run.RunID, "memory/update"),
		Payload:       payload,
	})
	return output, err
}

func appendUniqueMemoryUpdateReason(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
