package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"
)

const (
	ToolServiceStatusLookup     = "service_status_lookup"
	ToolTransportScheduleLookup = "transport_schedule_lookup"
)

type Options struct {
	ProjectionPath     string
	TrustedTimeRFC3339 string
}

type Runtime struct {
	projectionPath string
	trustedTime    time.Time
}

type Status struct {
	Configured                   bool   `json:"configured"`
	ProjectionSource             string `json:"projection_source"`
	ServiceStatusProjectionReady bool   `json:"service_status_projection_ready"`
	TransportScheduleImplemented bool   `json:"transport_schedule_implemented"`
}

type Response struct {
	StatusCode int
	Outcome    string
	Body       any
}

type HTTPError struct {
	Status  int
	Code    string
	Message string
}

type serviceStatusRequest struct {
	SubjectQuery  string        `json:"subject_query"`
	TemporalQuery temporalQuery `json:"temporal_query"`
	CampusScope   string        `json:"campus_scope"`
}

type temporalQuery struct {
	Mode     string `json:"mode"`
	AsOf     string `json:"as_of"`
	YearHint string `json:"year_hint"`
}

type serviceStatusResult struct {
	SubjectQuery              string   `json:"subject_query"`
	Outcome                   string   `json:"outcome"`
	ResolvedSubject           string   `json:"resolved_subject,omitempty"`
	ObservedStatus            string   `json:"observed_status,omitempty"`
	QueriedTimeAnchor         string   `json:"queried_time_anchor,omitempty"`
	EffectiveFrom             string   `json:"effective_from,omitempty"`
	EffectiveUntil            string   `json:"effective_until,omitempty"`
	OverrideSourceRefs        []string `json:"override_source_refs,omitempty"`
	RelatedNoticeRefs         []string `json:"related_notice_refs,omitempty"`
	HistoricalDowngradeReason string   `json:"historical_downgrade_reason,omitempty"`
	FailCloseReason           string   `json:"fail_close_reason,omitempty"`
}

type transportScheduleRequest struct {
	QueryText string `json:"query_text"`
	Intent    string `json:"intent"`
}

type transportScheduleResult struct {
	QueryText         string `json:"query_text"`
	Intent            string `json:"intent"`
	Outcome           string `json:"outcome"`
	ServiceStatus     string `json:"service_status"`
	QueriedTimeAnchor string `json:"queried_time_anchor"`
	FailCloseReason   string `json:"fail_close_reason"`
}

type projectionBundle struct {
	SchemaVersion        string                `json:"schema_version"`
	ServiceStatusRecords []serviceStatusRecord `json:"service_status_records"`
}

type serviceStatusRecord struct {
	SubjectID          string   `json:"subject_id"`
	DisplayName        string   `json:"display_name"`
	Aliases            []string `json:"aliases"`
	CampusScope        string   `json:"campus_scope"`
	ObservedStatus     string   `json:"observed_status"`
	EffectiveFrom      string   `json:"effective_from"`
	EffectiveUntil     string   `json:"effective_until"`
	OverrideSourceRefs []string `json:"override_source_refs"`
	RelatedNoticeRefs  []string `json:"related_notice_refs"`
}

func NewRuntime(options Options) *Runtime {
	runtime := &Runtime{
		projectionPath: strings.TrimSpace(options.ProjectionPath),
	}
	if trustedTime := strings.TrimSpace(options.TrustedTimeRFC3339); trustedTime != "" {
		parsed, err := time.Parse(time.RFC3339, trustedTime)
		if err == nil {
			runtime.trustedTime = parsed
		}
	}
	return runtime
}

func (r *Runtime) Status() Status {
	status := Status{
		Configured:                   r.projectionPath != "",
		ProjectionSource:             "file",
		TransportScheduleImplemented: false,
	}
	if r.projectionPath == "" {
		status.ProjectionSource = ""
		return status
	}
	bundle, err := r.loadBundle()
	status.ServiceStatusProjectionReady = err == nil && len(bundle.ServiceStatusRecords) > 0
	return status
}

func (r *Runtime) LookupServiceStatus(ctx context.Context, rawBody []byte) Response {
	var request serviceStatusRequest
	if err := json.Unmarshal(rawBody, &request); err != nil {
		return invalidRequest("Service status request body must be a JSON object.")
	}
	request.SubjectQuery = strings.TrimSpace(request.SubjectQuery)
	request.CampusScope = strings.TrimSpace(request.CampusScope)
	if request.SubjectQuery == "" {
		return invalidRequest("subject_query is required.")
	}
	if err := ctx.Err(); err != nil {
		return failClosedServiceStatus(request.SubjectQuery, r.timeAnchor(), "source_truth_unavailable")
	}

	bundle, err := r.loadBundle()
	if err != nil {
		return failClosedServiceStatus(request.SubjectQuery, r.timeAnchor(), "source_truth_unavailable")
	}
	record, ok := matchServiceStatusRecord(bundle.ServiceStatusRecords, request)
	if !ok {
		body := serviceStatusResult{
			SubjectQuery:      request.SubjectQuery,
			Outcome:           "not_found",
			QueriedTimeAnchor: r.timeAnchor(),
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	body := serviceStatusResult{
		SubjectQuery:       request.SubjectQuery,
		Outcome:            "resolved_current",
		ResolvedSubject:    record.DisplayName,
		ObservedStatus:     record.ObservedStatus,
		QueriedTimeAnchor:  r.timeAnchor(),
		EffectiveFrom:      record.EffectiveFrom,
		EffectiveUntil:     record.EffectiveUntil,
		OverrideSourceRefs: append([]string(nil), record.OverrideSourceRefs...),
		RelatedNoticeRefs:  append([]string(nil), record.RelatedNoticeRefs...),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func (r *Runtime) LookupTransportSchedule(ctx context.Context, rawBody []byte) Response {
	var request transportScheduleRequest
	if err := json.Unmarshal(rawBody, &request); err != nil {
		return invalidRequest("Transport schedule request body must be a JSON object.")
	}
	request.QueryText = strings.TrimSpace(request.QueryText)
	request.Intent = strings.TrimSpace(request.Intent)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if request.Intent == "" {
		return invalidRequest("intent is required.")
	}
	if err := ctx.Err(); err != nil {
		return failClosedTransportSchedule(request, r.timeAnchor())
	}
	body := transportScheduleResult{
		QueryText:         request.QueryText,
		Intent:            request.Intent,
		Outcome:           "temporarily_unverifiable",
		ServiceStatus:     "unknown",
		QueriedTimeAnchor: r.timeAnchor(),
		FailCloseReason:   "source_family_unavailable",
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func (r *Runtime) loadBundle() (projectionBundle, error) {
	if r.projectionPath == "" {
		return projectionBundle{}, errors.New("projection path is not configured")
	}
	raw, err := os.ReadFile(r.projectionPath)
	if err != nil {
		return projectionBundle{}, err
	}
	var bundle projectionBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		return projectionBundle{}, err
	}
	return bundle, nil
}

func (r *Runtime) timeAnchor() string {
	if !r.trustedTime.IsZero() {
		return r.trustedTime.Format(time.RFC3339)
	}
	return time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format(time.RFC3339)
}

func invalidRequest(message string) Response {
	return Response{
		StatusCode: 400,
		Outcome:    "invalid_request",
		Body: map[string]any{
			"error": map[string]any{
				"code":      "invalid_request",
				"message":   message,
				"retryable": false,
			},
		},
	}
}

func failClosedServiceStatus(subjectQuery string, timeAnchor string, reason string) Response {
	body := serviceStatusResult{
		SubjectQuery:      subjectQuery,
		Outcome:           "temporarily_unverifiable",
		ObservedStatus:    "unknown",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func failClosedTransportSchedule(
	request transportScheduleRequest,
	timeAnchor string,
) Response {
	body := transportScheduleResult{
		QueryText:         request.QueryText,
		Intent:            request.Intent,
		Outcome:           "temporarily_unverifiable",
		ServiceStatus:     "unknown",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   "source_family_unavailable",
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func matchServiceStatusRecord(
	records []serviceStatusRecord,
	request serviceStatusRequest,
) (serviceStatusRecord, bool) {
	query := normalizeSearchText(request.SubjectQuery)
	campusScope := normalizeSearchText(request.CampusScope)
	for _, record := range records {
		if campusScope != "" && normalizeSearchText(record.CampusScope) != campusScope {
			continue
		}
		if matchesServiceStatusRecord(query, record) {
			return record, true
		}
	}
	return serviceStatusRecord{}, false
}

func matchesServiceStatusRecord(query string, record serviceStatusRecord) bool {
	candidates := append([]string{record.SubjectID, record.DisplayName}, record.Aliases...)
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		if strings.Contains(query, normalized) || strings.Contains(normalized, query) {
			return true
		}
	}
	return false
}

func normalizeSearchText(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}
