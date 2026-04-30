package execution

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

const MaxNoticeContextProjectionBodyChars = 1600

type ProjectionKind string

const (
	ProjectionKindNoticeContext ProjectionKind = "notice_context"
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
	fields := make([]string, 0, len(payload))
	for _, key := range []string{"title", "body_excerpt", "source_url"} {
		if value, _ := payload[key].(string); strings.TrimSpace(value) != "" {
			fields = append(fields, key)
		}
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
