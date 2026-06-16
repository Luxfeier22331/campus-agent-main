package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

const (
	personalMemorySemanticDuplicateScore = 0.92
	personalMemorySemanticReviewScore    = 0.84
)

func (e qdrantPersonalMemoryExecutor) ResolveCandidate(
	ctx context.Context,
	request memoryruntime.ResolveCandidateRequest,
) (memoryruntime.ResolveCandidateResult, error) {
	if err := memoryruntime.ValidateResolveCandidateRequest(request); err != nil {
		return memoryruntime.ResolveCandidateResult{}, err
	}
	if exact, ok, err := e.findMemoryByCanonicalKey(ctx, request); err != nil {
		return memoryruntime.ResolveCandidateResult{}, err
	} else if ok {
		return memoryruntime.ResolveCandidateResult{
			Action:   "refresh",
			Existing: &exact,
			Reason:   "canonical_key_match",
			Score:    1,
		}, nil
	}
	embedding, err := e.embedMemoryText(ctx, request.CompactText)
	if err != nil {
		return memoryruntime.ResolveCandidateResult{}, err
	}
	similar, ok, err := e.querySimilarMemoryForCandidate(ctx, request, embedding)
	if err != nil {
		return memoryruntime.ResolveCandidateResult{}, err
	}
	if !ok {
		return memoryruntime.ResolveCandidateResult{Action: "create"}, nil
	}
	if similar.Score >= personalMemorySemanticDuplicateScore {
		record, ok := memoryRecordFromQdrantPoint(similar)
		if !ok {
			return memoryruntime.ResolveCandidateResult{}, fmt.Errorf("similar personal memory point missing payload")
		}
		return memoryruntime.ResolveCandidateResult{
			Action:   "merge",
			Existing: &record,
			Reason:   "semantic_duplicate",
			Score:    similar.Score,
		}, nil
	}
	if similar.Score >= personalMemorySemanticReviewScore {
		return memoryruntime.ResolveCandidateResult{
			Action: "skip",
			Reason: "dedupe_review_required",
			Score:  similar.Score,
		}, nil
	}
	return memoryruntime.ResolveCandidateResult{Action: "create", Score: similar.Score}, nil
}

func (e qdrantPersonalMemoryExecutor) findMemoryByCanonicalKey(
	ctx context.Context,
	request memoryruntime.ResolveCandidateRequest,
) (memoryruntime.MemoryRecord, bool, error) {
	filter := map[string]any{
		"must": []map[string]any{
			qdrantMatchCondition("user_id", strings.TrimSpace(request.UserID)),
			qdrantMatchCondition("tenant_id", strings.TrimSpace(request.TenantID)),
			qdrantMatchCondition("canonical_key", strings.TrimSpace(request.CanonicalKey)),
			qdrantMatchAnyCondition("status", []string{"active", "stale"}),
		},
	}
	body := map[string]any{
		"limit":        1,
		"with_payload": true,
		"with_vector":  false,
		"filter":       filter,
	}
	points, err := e.scrollMemoryPoints(ctx, body)
	if err != nil || len(points) == 0 {
		return memoryruntime.MemoryRecord{}, false, err
	}
	record, ok := memoryRecordFromQdrantPoint(points[0])
	return record, ok, nil
}

func (e qdrantPersonalMemoryExecutor) querySimilarMemoryForCandidate(
	ctx context.Context,
	request memoryruntime.ResolveCandidateRequest,
	embedding []float64,
) (qdrantPoint, bool, error) {
	filter := map[string]any{
		"must": []map[string]any{
			qdrantMatchCondition("user_id", strings.TrimSpace(request.UserID)),
			qdrantMatchCondition("tenant_id", strings.TrimSpace(request.TenantID)),
			qdrantMatchCondition("memory_type", strings.TrimSpace(request.MemoryType)),
			qdrantMatchAnyCondition("status", []string{"active", "stale"}),
			qdrantMatchAnyCondition("capability", []string{strings.TrimSpace(request.Capability), "any"}),
		},
	}
	body := map[string]any{
		"limit":        1,
		"with_payload": true,
		"with_vector":  false,
		"using":        "dense",
		"query":        embedding,
		"filter":       filter,
	}
	points, err := e.queryMemoryPointsRaw(ctx, body)
	if err != nil || len(points) == 0 {
		return qdrantPoint{}, false, err
	}
	return points[0], true, nil
}

func (e qdrantPersonalMemoryExecutor) scrollMemoryPoints(
	ctx context.Context,
	body map[string]any,
) ([]qdrantPoint, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(e.collection) + "/points/scroll"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("api-key", e.qdrantQueryAPIKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := e.httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant personal memory scroll status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Points []qdrantPoint `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant personal memory scroll response: %w", err)
	}
	return payload.Result.Points, nil
}

func (e qdrantPersonalMemoryExecutor) queryMemoryPointsRaw(
	ctx context.Context,
	body map[string]any,
) ([]qdrantPoint, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	endpoint := e.qdrantURL + "/collections/" + url.PathEscape(e.collection) + "/points/query"
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("api-key", e.qdrantQueryAPIKey)
	httpRequest.Header.Set("content-type", "application/json")
	response, err := e.httpClient.Do(httpRequest)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("qdrant personal memory query status %d", response.StatusCode)
	}
	var payload struct {
		Result struct {
			Points []qdrantPoint `json:"points"`
		} `json:"result"`
	}
	if err := json.Unmarshal(responseBody, &payload); err != nil {
		return nil, fmt.Errorf("parse qdrant personal memory response: %w", err)
	}
	return payload.Result.Points, nil
}

func memoryRecordFromQdrantPoint(point qdrantPoint) (memoryruntime.MemoryRecord, bool) {
	payload := point.Payload
	if len(payload) == 0 {
		return memoryruntime.MemoryRecord{}, false
	}
	record := memoryruntime.MemoryRecord{
		Capability:          strings.TrimSpace(optionalStringFromAny(payload["capability"])),
		CanonicalKey:        strings.TrimSpace(optionalStringFromAny(payload["canonical_key"])),
		CanonicalSubject:    strings.TrimSpace(optionalStringFromAny(payload["canonical_subject"])),
		CompactText:         strings.TrimSpace(optionalStringFromAny(payload["compact_text"])),
		Confidence:          optionalFloatFromAny(payload["confidence"]),
		FirstSeenAt:         strings.TrimSpace(optionalStringFromAny(payload["first_seen_at"])),
		LastSeenAt:          strings.TrimSpace(optionalStringFromAny(payload["last_seen_at"])),
		MemoryID:            strings.TrimSpace(optionalStringFromAny(payload["memory_id"])),
		MemoryType:          strings.TrimSpace(optionalStringFromAny(payload["memory_type"])),
		MergeCount:          optionalIntFromAny(payload["merge_count"]),
		ReasonCode:          strings.TrimSpace(optionalStringFromAny(payload["reason_code"])),
		SourceHashes:        optionalStringSliceFromAny(payload["source_hashes"]),
		Status:              strings.TrimSpace(optionalStringFromAny(payload["status"])),
		SupersedesMemoryIDs: optionalStringSliceFromAny(payload["supersedes_memory_ids"]),
		UpdatedAt:           strings.TrimSpace(optionalStringFromAny(payload["updated_at"])),
	}
	return record, record.MemoryID != "" && record.CompactText != ""
}

func normalizedStringSlice(values []string) []string {
	return memoryruntime.MergeSourceHashes(values)
}

func optionalStringSliceFromAny(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		normalized := strings.TrimSpace(optionalStringFromAny(item))
		if normalized != "" {
			result = append(result, normalized)
		}
	}
	return result
}

func optionalFloatFromAny(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, _ := typed.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed
	default:
		return 0
	}
}

func optionalIntFromAny(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return 0
	}
}
