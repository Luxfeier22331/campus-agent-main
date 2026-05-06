package execution

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

const MaxNoticeContextProjectionBodyChars = 1600
const MaxScheduleBaselineProjectionSummaryChars = 1600
const MaxEvidenceBundleProjectionQueryChars = 1600
const MaxGroundingVerdictProjectionSummaryChars = 1600

type ProjectionKind string

const (
	ProjectionKindNoticeContext    ProjectionKind = "notice_context"
	ProjectionKindScheduleBaseline ProjectionKind = "schedule_baseline"
	ProjectionKindEvidenceBundle   ProjectionKind = "evidence_bundle"
	ProjectionKindGroundingVerdict ProjectionKind = "grounding_verdict"
)

type ProjectionSafetySummary struct {
	Truncated     bool     `json:"truncated"`
	Redacted      bool     `json:"redacted"`
	MaxChars      int      `json:"max_chars"`
	FieldsPresent []string `json:"fields_present"`
}

type StepOutputProjection struct {
	ProjectionID   string                  `json:"projection_id"`
	SourceStepID   string                  `json:"source_step_id"`
	ProjectionKind ProjectionKind          `json:"projection_kind"`
	ContentHash    string                  `json:"content_hash"`
	Payload        map[string]any          `json:"payload"`
	Safety         ProjectionSafetySummary `json:"safety"`
}

func NewNoticeContextProjection(
	sourceStepID string,
	title string,
	body string,
	sourceURL string,
) (StepOutputProjection, bool) {
	payload := map[string]any{
		"title":        strings.TrimSpace(title),
		"body_excerpt": "",
		"source_url":   strings.TrimSpace(sourceURL),
	}
	bodyExcerpt, truncated := truncateRunes(strings.TrimSpace(body), MaxNoticeContextProjectionBodyChars)
	payload["body_excerpt"] = bodyExcerpt
	fieldsPresent := projectionFieldsPresent(payload)
	if len(fieldsPresent) == 0 {
		return StepOutputProjection{}, false
	}
	contentHash := projectionContentHash(payload)
	return StepOutputProjection{
		ProjectionID:   "projection:notice_context:" + strings.TrimPrefix(contentHash, "sha256:")[:16],
		SourceStepID:   sourceStepID,
		ProjectionKind: ProjectionKindNoticeContext,
		ContentHash:    contentHash,
		Payload:        payload,
		Safety: ProjectionSafetySummary{
			Truncated:     truncated,
			Redacted:      false,
			MaxChars:      MaxNoticeContextProjectionBodyChars,
			FieldsPresent: fieldsPresent,
		},
	}, true
}

func NewScheduleBaselineProjection(
	sourceStepID string,
	routeID string,
	routeDisplayName string,
	serviceFamily string,
	summary string,
	sourceRefs []string,
) (StepOutputProjection, bool) {
	payload := map[string]any{
		"route_id":           strings.TrimSpace(routeID),
		"route_display_name": strings.TrimSpace(routeDisplayName),
		"service_family":     strings.TrimSpace(serviceFamily),
		"summary":            "",
		"source_refs":        normalizedProjectionStringSlice(sourceRefs),
	}
	summaryExcerpt, truncated := truncateRunes(
		strings.TrimSpace(summary),
		MaxScheduleBaselineProjectionSummaryChars,
	)
	payload["summary"] = summaryExcerpt
	fieldsPresent := projectionFieldsPresentForPayload(payload)
	if len(fieldsPresent) == 0 {
		return StepOutputProjection{}, false
	}
	contentHash := projectionContentHash(payload)
	return StepOutputProjection{
		ProjectionID:   "projection:schedule_baseline:" + strings.TrimPrefix(contentHash, "sha256:")[:16],
		SourceStepID:   sourceStepID,
		ProjectionKind: ProjectionKindScheduleBaseline,
		ContentHash:    contentHash,
		Payload:        payload,
		Safety: ProjectionSafetySummary{
			Truncated:     truncated,
			Redacted:      false,
			MaxChars:      MaxScheduleBaselineProjectionSummaryChars,
			FieldsPresent: fieldsPresent,
		},
	}, true
}

func NewEvidenceBundleProjection(
	sourceStepID string,
	corpus string,
	collection string,
	queryText string,
	sourceRefs []string,
) (StepOutputProjection, bool) {
	payload := map[string]any{
		"corpus":     strings.TrimSpace(corpus),
		"collection": strings.TrimSpace(collection),
		"query_text": "",
		"source_refs": normalizedProjectionStringSlice(
			sourceRefs,
		),
	}
	queryExcerpt, truncated := truncateRunes(
		strings.TrimSpace(queryText),
		MaxEvidenceBundleProjectionQueryChars,
	)
	payload["query_text"] = queryExcerpt
	fieldsPresent := projectionFieldsPresentForPayload(payload)
	if len(fieldsPresent) == 0 {
		return StepOutputProjection{}, false
	}
	contentHash := projectionContentHash(payload)
	return StepOutputProjection{
		ProjectionID:   "projection:evidence_bundle:" + strings.TrimPrefix(contentHash, "sha256:")[:16],
		SourceStepID:   sourceStepID,
		ProjectionKind: ProjectionKindEvidenceBundle,
		ContentHash:    contentHash,
		Payload:        payload,
		Safety: ProjectionSafetySummary{
			Truncated:     truncated,
			Redacted:      false,
			MaxChars:      MaxEvidenceBundleProjectionQueryChars,
			FieldsPresent: fieldsPresent,
		},
	}, true
}

func NewGroundingVerdictProjection(
	sourceStepID string,
	groundingVerdict string,
	semanticOutcome string,
	sourceRefCount int,
) (StepOutputProjection, bool) {
	payload := map[string]any{
		"grounding_verdict": strings.TrimSpace(groundingVerdict),
		"semantic_outcome":  "",
	}
	semanticOutcomeSummary, truncated := truncateRunes(
		strings.TrimSpace(semanticOutcome),
		MaxGroundingVerdictProjectionSummaryChars,
	)
	payload["semantic_outcome"] = semanticOutcomeSummary
	if sourceRefCount > 0 {
		payload["source_ref_count"] = sourceRefCount
	}
	fieldsPresent := projectionFieldsPresentForPayload(payload)
	if len(fieldsPresent) == 0 {
		return StepOutputProjection{}, false
	}
	contentHash := projectionContentHash(payload)
	return StepOutputProjection{
		ProjectionID:   "projection:grounding_verdict:" + strings.TrimPrefix(contentHash, "sha256:")[:16],
		SourceStepID:   sourceStepID,
		ProjectionKind: ProjectionKindGroundingVerdict,
		ContentHash:    contentHash,
		Payload:        payload,
		Safety: ProjectionSafetySummary{
			Truncated:     truncated,
			Redacted:      false,
			MaxChars:      MaxGroundingVerdictProjectionSummaryChars,
			FieldsPresent: fieldsPresent,
		},
	}, true
}

func (projection StepOutputProjection) Map() map[string]any {
	return map[string]any{
		"projection_id":   projection.ProjectionID,
		"source_step_id":  projection.SourceStepID,
		"projection_kind": string(projection.ProjectionKind),
		"content_hash":    projection.ContentHash,
		"payload":         cloneAnyMap(projection.Payload),
		"safety":          projection.Safety.Map(),
	}
}

func (projection StepOutputProjection) SummaryMap() map[string]any {
	return map[string]any{
		"projection_id":   projection.ProjectionID,
		"source_step_id":  projection.SourceStepID,
		"projection_kind": string(projection.ProjectionKind),
		"content_hash":    projection.ContentHash,
		"safety":          projection.Safety.Map(),
	}
}

func (summary ProjectionSafetySummary) Map() map[string]any {
	return map[string]any{
		"truncated":      summary.Truncated,
		"redacted":       summary.Redacted,
		"max_chars":      summary.MaxChars,
		"fields_present": append([]string{}, summary.FieldsPresent...),
	}
}

func (projection StepOutputProjection) NoticeTitle() string {
	return stringFromProjectionPayload(projection.Payload, "title")
}

func (projection StepOutputProjection) NoticeBodyExcerpt() string {
	return stringFromProjectionPayload(projection.Payload, "body_excerpt")
}

func (projection StepOutputProjection) NoticeSourceURL() string {
	return stringFromProjectionPayload(projection.Payload, "source_url")
}

func (projection StepOutputProjection) ScheduleRouteDisplayName() string {
	return stringFromProjectionPayload(projection.Payload, "route_display_name")
}

func (projection StepOutputProjection) ScheduleSummary() string {
	return stringFromProjectionPayload(projection.Payload, "summary")
}

func CloneStepOutputProjection(projection StepOutputProjection) StepOutputProjection {
	clone := projection
	clone.Payload = cloneAnyMap(projection.Payload)
	clone.Safety.FieldsPresent = append([]string{}, projection.Safety.FieldsPresent...)
	return clone
}

func WorkflowContextProjectionMaps(projections []StepOutputProjection) []map[string]any {
	items := make([]map[string]any, 0, len(projections))
	for _, projection := range projections {
		items = append(items, projection.SummaryMap())
	}
	return items
}

func FirstProjectionOfKind(
	projections []StepOutputProjection,
	kind ProjectionKind,
) (StepOutputProjection, bool) {
	for _, projection := range projections {
		if projection.ProjectionKind == kind {
			return CloneStepOutputProjection(projection), true
		}
	}
	return StepOutputProjection{}, false
}

func projectionFieldsPresent(payload map[string]any) []string {
	return projectionFieldsPresentForPayload(payload)
}

func projectionFieldsPresentForPayload(payload map[string]any) []string {
	fields := make([]string, 0, len(payload))
	for _, key := range []string{
		"title",
		"body_excerpt",
		"source_url",
		"route_id",
		"route_display_name",
		"service_family",
		"summary",
		"corpus",
		"collection",
		"query_text",
		"grounding_verdict",
		"semantic_outcome",
	} {
		if value, _ := payload[key].(string); strings.TrimSpace(value) != "" {
			fields = append(fields, key)
		}
	}
	if values, _ := payload["source_refs"].([]string); len(values) > 0 {
		fields = append(fields, "source_refs")
	}
	if value, _ := payload["source_ref_count"].(int); value > 0 {
		fields = append(fields, "source_ref_count")
	}
	return fields
}

func projectionContentHash(payload map[string]any) string {
	raw, err := json.Marshal(payload)
	if err != nil {
		raw = []byte("{}")
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func truncateRunes(value string, maxRunes int) (string, bool) {
	if maxRunes <= 0 {
		return "", value != ""
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value, false
	}
	return string(runes[:maxRunes]) + "...", true
}

func stringFromProjectionPayload(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}

func normalizedProjectionStringSlice(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(value)
		if normalized == "" || containsProjectionString(result, normalized) {
			continue
		}
		result = append(result, normalized)
	}
	return result
}

func containsProjectionString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
