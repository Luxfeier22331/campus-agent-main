package httpapi

import (
	"context"
	"errors"
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
	if s.memoryExtractionErr != nil {
		return temporalruntime.ExtractMemoryCandidatesActivityOutput{}, s.memoryExtractionErr
	}
	extractor := s.memoryExtraction
	if providerBacked, ok := extractor.(providerBackedMemoryExtractionExecutor); ok {
		providerBacked.configResolver = s.providerConfigResolver
		extractor = providerBacked
	}
	if extractor == nil {
		return temporalruntime.ExtractMemoryCandidatesActivityOutput{}, errors.New("memory extraction executor is not configured")
	}
	result, err := extractor.ExtractMemoryCandidates(ctx, run, payload)
	if err != nil {
		return temporalruntime.ExtractMemoryCandidatesActivityOutput{}, err
	}
	output := temporalruntime.ExtractMemoryCandidatesActivityOutput{
		CandidateCount: len(result.Candidates),
		Candidates:     result.Candidates,
		RunID:          run.RunID,
		SchemaVersion:  "memory_update_extract_result_v1",
		SkipReasons:    result.SkipReasons,
		SkippedCount:   result.SkippedCount,
		Status:         "completed",
	}
	if len(result.Candidates) == 0 {
		output.Status = "skipped"
		if output.SkippedCount == 0 {
			output.SkippedCount = 1
		}
		if len(output.SkipReasons) == 0 {
			output.SkipReasons = []string{"no_high_confidence_memory"}
		}
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
	created := 0
	refreshed := 0
	merged := 0
	superseded := 0
	skipped := 0
	reasons := []string{}
	for _, candidate := range input.Candidates {
		if reason := memoryCandidateUpsertSkipReason(candidate); reason != "" {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, reason)
			continue
		}
		tenantID := firstNonEmptyText(payload["tenant_id"], nestedAny(payload, "context", "tenant_id"))
		userID := firstNonEmptyText(
			nestedAny(payload, "actor", "user_id"),
			nestedAny(payload, "context", "actor", "user_id"),
			run.OwnerUserID,
		)
		candidate = normalizeMemoryCandidateIdentity(candidate, userID, tenantID)
		resolveRequest := memoryruntime.ResolveCandidateRequest{
			Capability:       strings.TrimSpace(candidate.Capability),
			CanonicalKey:     strings.TrimSpace(candidate.CanonicalKey),
			CanonicalSubject: strings.TrimSpace(candidate.CanonicalSubject),
			CompactText:      strings.TrimSpace(candidate.CompactText),
			Confidence:       candidate.Confidence,
			MemoryType:       strings.TrimSpace(candidate.MemoryType),
			ReasonCode:       strings.TrimSpace(candidate.ReasonCode),
			SourceHash:       strings.TrimSpace(candidate.SourceHash),
			TenantID:         tenantID,
			UpdatedAt:        now,
			UserID:           userID,
		}
		if err := memoryruntime.ValidateResolveCandidateRequest(resolveRequest); err != nil {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, "invalid_candidate")
			continue
		}
		resolution, err := s.resolvePersonalMemoryCandidate(ctx, resolveRequest)
		if err != nil {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, "dedupe_failed")
			continue
		}
		if resolution.Action == "skip" {
			skipped++
			reasons = appendUniqueMemoryUpdateReason(reasons, firstNonEmptyText(resolution.Reason, "dedupe_review_required"))
			continue
		}
		if resolution.Action == "merge" {
			mergedCandidate, err := s.mergePersonalMemoryCandidate(ctx, resolution, resolveRequest)
			if err != nil {
				skipped++
				reasons = appendUniqueMemoryUpdateReason(reasons, "merge_failed")
				continue
			}
			resolveRequest.CompactText = mergedCandidate.CompactText
			resolveRequest.Confidence = mergedCandidate.Confidence
			resolveRequest.ReasonCode = mergedCandidate.ReasonCode
		}
		request := buildResolvedMemoryUpsertRequest(resolveRequest, resolution)
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
		switch resolution.Action {
		case "refresh":
			refreshed++
		case "merge":
			merged++
		case "supersede":
			superseded++
		default:
			created++
		}
	}
	output := temporalruntime.UpsertInferredMemoryActivityOutput{
		CreatedCount:    created,
		MergedCount:     merged,
		RefreshedCount:  refreshed,
		RunID:           run.RunID,
		SchemaVersion:   "memory_update_result_v1",
		SkipReasons:     reasons,
		SkippedCount:    skipped,
		Status:          "completed",
		SupersededCount: superseded,
		UpsertedCount:   upserted,
	}
	if upserted == 0 {
		output.Status = "skipped"
	}
	hash, err := memoryruntime.HashProjection(map[string]any{
		"created_count":    output.CreatedCount,
		"merged_count":     output.MergedCount,
		"refreshed_count":  output.RefreshedCount,
		"run_id":           output.RunID,
		"schema_version":   output.SchemaVersion,
		"skip_reasons":     output.SkipReasons,
		"skipped_count":    output.SkippedCount,
		"status":           output.Status,
		"superseded_count": output.SupersededCount,
		"upserted_count":   output.UpsertedCount,
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

func memoryCandidateUpsertSkipReason(candidate temporalruntime.MemoryCandidate) string {
	if candidate.Confidence < inferredMemoryConfidenceThreshold {
		return "low_confidence"
	}
	if memoryruntime.ContainsForbiddenMemoryPayload(candidate.CompactText) {
		return "forbidden_payload"
	}
	if reason := memoryCandidateReasonSkipReason(candidate.ReasonCode); reason != "" {
		return reason
	}
	if strings.TrimSpace(candidate.SourceHash) == "" {
		return "missing_source_hash"
	}
	return ""
}

func (s *Server) projectMemoryUpdateResult(
	ctx context.Context,
	run execution.DurableRun,
	output temporalruntime.UpsertInferredMemoryActivityOutput,
) (temporalruntime.UpsertInferredMemoryActivityOutput, error) {
	now := time.Now().UTC()
	payload := map[string]any{
		"created_count":    output.CreatedCount,
		"merged_count":     output.MergedCount,
		"payload_sha256":   output.PayloadSHA256,
		"refreshed_count":  output.RefreshedCount,
		"schema_version":   output.SchemaVersion,
		"skip_reasons":     output.SkipReasons,
		"skipped_count":    output.SkippedCount,
		"status":           output.Status,
		"superseded_count": output.SupersededCount,
		"upserted_count":   output.UpsertedCount,
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
