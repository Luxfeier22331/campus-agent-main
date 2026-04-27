package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type serviceStatusRequest struct {
	SubjectQuery  string        `json:"subject_query"`
	TemporalQuery temporalQuery `json:"temporal_query"`
	CampusScope   string        `json:"campus_scope"`
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

type serviceStatusRecordStatus struct {
	effectiveFrom  time.Time
	effectiveUntil time.Time
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
	timeAnchor := r.timeAnchor()
	if err := ctx.Err(); err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, "source_truth_unavailable")
	}

	bundle, err := r.loadServiceStatusBundle(ctx)
	if err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, "source_truth_unavailable")
	}
	record, ok := matchServiceStatusRecord(bundle.ServiceStatusRecords, request)
	if !ok {
		body := serviceStatusResult{
			SubjectQuery:      request.SubjectQuery,
			Outcome:           "not_found",
			QueriedTimeAnchor: timeAnchor,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	queryTime, err := serviceStatusQueryTime(request, timeAnchor)
	if err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, "temporal_scope_ambiguous")
	}
	recordStatus, err := validateServiceStatusRecord(record)
	if err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, "source_truth_unavailable")
	}
	if queryTime.Before(recordStatus.effectiveFrom) || !queryTime.Before(recordStatus.effectiveUntil) {
		return failClosedServiceStatusWithHistoricalReason(
			request.SubjectQuery,
			timeAnchor,
			"current_state_unverifiable",
			"current_effective_miss",
		)
	}
	body := serviceStatusResult{
		SubjectQuery:       request.SubjectQuery,
		Outcome:            "resolved_current",
		ResolvedSubject:    record.DisplayName,
		ObservedStatus:     record.ObservedStatus,
		QueriedTimeAnchor:  timeAnchor,
		EffectiveFrom:      record.EffectiveFrom,
		EffectiveUntil:     record.EffectiveUntil,
		OverrideSourceRefs: append([]string(nil), record.OverrideSourceRefs...),
		RelatedNoticeRefs:  append([]string(nil), record.RelatedNoticeRefs...),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func failClosedServiceStatus(subjectQuery string, timeAnchor string, reason string) Response {
	return failClosedServiceStatusWithHistoricalReason(subjectQuery, timeAnchor, reason, "")
}

func failClosedServiceStatusWithHistoricalReason(
	subjectQuery string,
	timeAnchor string,
	reason string,
	historicalDowngradeReason string,
) Response {
	body := serviceStatusResult{
		SubjectQuery:              subjectQuery,
		Outcome:                   "temporarily_unverifiable",
		ObservedStatus:            "unknown",
		QueriedTimeAnchor:         timeAnchor,
		FailCloseReason:           reason,
		HistoricalDowngradeReason: historicalDowngradeReason,
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

func serviceStatusQueryTime(request serviceStatusRequest, timeAnchor string) (time.Time, error) {
	if asOf := strings.TrimSpace(request.TemporalQuery.AsOf); asOf != "" {
		return time.Parse(time.RFC3339, asOf)
	}
	return time.Parse(time.RFC3339, timeAnchor)
}

func validateServiceStatusRecord(record serviceStatusRecord) (serviceStatusRecordStatus, error) {
	if strings.TrimSpace(record.DisplayName) == "" {
		return serviceStatusRecordStatus{}, errors.New("display_name is required")
	}
	if !isAllowedObservedStatus(record.ObservedStatus) {
		return serviceStatusRecordStatus{}, errors.New("observed_status is invalid")
	}
	effectiveFrom, err := time.Parse(time.RFC3339, strings.TrimSpace(record.EffectiveFrom))
	if err != nil {
		return serviceStatusRecordStatus{}, err
	}
	effectiveUntil, err := time.Parse(time.RFC3339, strings.TrimSpace(record.EffectiveUntil))
	if err != nil {
		return serviceStatusRecordStatus{}, err
	}
	if !effectiveUntil.After(effectiveFrom) {
		return serviceStatusRecordStatus{}, errors.New("effective_until must be after effective_from")
	}
	return serviceStatusRecordStatus{effectiveFrom: effectiveFrom, effectiveUntil: effectiveUntil}, nil
}

func isAllowedObservedStatus(value string) bool {
	switch strings.TrimSpace(value) {
	case "open", "closed", "temporarily_closed", "limited_service", "unknown":
		return true
	default:
		return false
	}
}
