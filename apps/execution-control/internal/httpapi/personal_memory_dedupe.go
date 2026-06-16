package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func (s *Server) resolvePersonalMemoryCandidate(
	ctx context.Context,
	request memoryruntime.ResolveCandidateRequest,
) (memoryruntime.ResolveCandidateResult, error) {
	if s.personalMemoryErr != nil {
		return memoryruntime.ResolveCandidateResult{}, s.personalMemoryErr
	}
	if s.personalMemoryExecutor == nil {
		return memoryruntime.ResolveCandidateResult{}, errors.New("personal memory executor is not configured")
	}
	return s.personalMemoryExecutor.ResolveCandidate(ctx, request)
}

func normalizeMemoryCandidateIdentity(
	candidate temporalruntime.MemoryCandidate,
	userID string,
	tenantID string,
) temporalruntime.MemoryCandidate {
	candidate.Capability = strings.TrimSpace(candidate.Capability)
	candidate.MemoryType = strings.TrimSpace(candidate.MemoryType)
	candidate.CanonicalSubject = memoryruntime.NormalizeCanonicalSubject(candidate.CanonicalSubject)
	if candidate.CanonicalSubject == "" {
		candidate.CanonicalSubject = fallbackCanonicalSubject(candidate.CompactText)
	}
	candidate.CanonicalKey = strings.TrimSpace(candidate.CanonicalKey)
	if candidate.CanonicalKey == "" {
		candidate.CanonicalKey = memoryruntime.CanonicalKey(
			candidate.MemoryType,
			candidate.Capability,
			candidate.CanonicalSubject,
		)
	}
	candidate.MemoryID = strings.TrimSpace(candidate.MemoryID)
	stableID := memoryruntime.StableMemoryID(userID, tenantID, candidate.CanonicalKey)
	if candidate.MemoryID == "" || strings.HasPrefix(candidate.MemoryID, "inf_") {
		candidate.MemoryID = stableID
	}
	return candidate
}

func (s *Server) mergePersonalMemoryCandidate(
	ctx context.Context,
	resolution memoryruntime.ResolveCandidateResult,
	request memoryruntime.ResolveCandidateRequest,
) (memoryMergeResult, error) {
	if resolution.Existing == nil {
		return memoryMergeResult{}, errors.New("semantic memory merge requires existing memory")
	}
	extractor := s.memoryExtraction
	if providerBacked, ok := extractor.(providerBackedMemoryExtractionExecutor); ok {
		providerBacked.configResolver = s.providerConfigResolver
		extractor = providerBacked
	}
	if s.memoryExtractionErr != nil {
		return memoryMergeResult{}, s.memoryExtractionErr
	}
	if extractor == nil {
		return memoryMergeResult{}, errors.New("memory extraction executor is not configured")
	}
	result, err := extractor.MergeMemoryCandidate(ctx, *resolution.Existing, request)
	if err != nil {
		return memoryMergeResult{}, err
	}
	if result.Confidence < inferredMemoryConfidenceThreshold ||
		strings.TrimSpace(result.CompactText) == "" ||
		memoryruntime.ContainsForbiddenMemoryPayload(result.CompactText) {
		return memoryMergeResult{}, errors.New("memory merge output failed admission")
	}
	if reason := memoryCandidateReasonSkipReason(result.ReasonCode); reason != "" {
		return memoryMergeResult{}, errors.New("memory merge output reason failed admission")
	}
	return result, nil
}

func buildResolvedMemoryUpsertRequest(
	request memoryruntime.ResolveCandidateRequest,
	resolution memoryruntime.ResolveCandidateResult,
) memoryruntime.UpsertRequest {
	memoryID := memoryruntime.StableMemoryID(request.UserID, request.TenantID, request.CanonicalKey)
	compactText := strings.TrimSpace(request.CompactText)
	sourceHashes := memoryruntime.MergeSourceHashes(nil, request.SourceHash)
	firstSeenAt := strings.TrimSpace(request.UpdatedAt)
	mergeCount := 0
	reasonCode := strings.TrimSpace(request.ReasonCode)
	if resolution.Existing != nil {
		existing := resolution.Existing
		memoryID = firstNonEmptyText(existing.MemoryID, memoryID)
		firstSeenAt = firstNonEmptyText(existing.FirstSeenAt, existing.UpdatedAt, firstSeenAt)
		sourceHashes = memoryruntime.MergeSourceHashes(existing.SourceHashes, request.SourceHash)
		mergeCount = existing.MergeCount + 1
		reasonCode = firstNonEmptyText(request.ReasonCode, existing.ReasonCode)
		if resolution.Action == "refresh" && strings.TrimSpace(existing.CompactText) != "" {
			compactText = longerMemoryText(existing.CompactText, compactText)
		}
	}
	return memoryruntime.UpsertRequest{
		Capability:       strings.TrimSpace(request.Capability),
		CanonicalKey:     strings.TrimSpace(request.CanonicalKey),
		CanonicalSubject: strings.TrimSpace(request.CanonicalSubject),
		CompactText:      compactText,
		Confidence:       request.Confidence,
		FirstSeenAt:      firstSeenAt,
		LastSeenAt:       strings.TrimSpace(request.UpdatedAt),
		MemoryID:         memoryID,
		MemoryType:       strings.TrimSpace(request.MemoryType),
		MergeCount:       mergeCount,
		ReasonCode:       reasonCode,
		Source:           "inferred",
		SourceHashes:     sourceHashes,
		Status:           "active",
		TenantID:         strings.TrimSpace(request.TenantID),
		UpdatedAt:        strings.TrimSpace(request.UpdatedAt),
		UserID:           strings.TrimSpace(request.UserID),
	}
}

func longerMemoryText(left string, right string) string {
	normalizedLeft := strings.TrimSpace(left)
	normalizedRight := strings.TrimSpace(right)
	if len([]rune(normalizedRight)) > len([]rune(normalizedLeft)) {
		return normalizedRight
	}
	return normalizedLeft
}
