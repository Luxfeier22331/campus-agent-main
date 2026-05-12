package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
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
	StatusNote                string   `json:"status_note,omitempty"`
	QueriedTimeAnchor         string   `json:"queried_time_anchor,omitempty"`
	EffectiveFrom             string   `json:"effective_from,omitempty"`
	EffectiveUntil            string   `json:"effective_until,omitempty"`
	OverrideSourceRefs        []string `json:"override_source_refs,omitempty"`
	RelatedNoticeRefs         []string `json:"related_notice_refs,omitempty"`
	FailCloseReason           string   `json:"fail_close_reason,omitempty"`
}

type serviceStatusRecord struct {
	SubjectID          string             `json:"subject_id"`
	DisplayName        string             `json:"display_name"`
	ServiceFamily      string             `json:"service_family"`
	Aliases            []string           `json:"aliases"`
	CampusScope        string             `json:"campus_scope"`
	LocationRefs       []serviceStatusRef `json:"location_refs"`
	PlatformRefs       []serviceStatusRef `json:"platform_refs"`
	AffectedScope      string             `json:"affected_scope"`
	ObservedStatus     string             `json:"observed_status"`
	StatusReason       string             `json:"status_reason"`
	StatusNote         string             `json:"status_note"`
	Severity           string             `json:"severity"`
	EffectiveFrom      string             `json:"effective_from"`
	EffectiveUntil     string             `json:"effective_until"`
	OverrideSourceRefs []string           `json:"override_source_refs"`
	RelatedNoticeRefs  []string           `json:"related_notice_refs"`
	ExtractionStatus   string             `json:"extraction_status"`
	SearchText         string             `json:"search_text"`
}

type serviceStatusRef struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	DisplayName string `json:"display_name"`
	Name        string `json:"name"`
	PlaceID     string `json:"place_id"`
	PlatformID  string `json:"platform_id"`
}

type serviceStatusRecordStatus struct {
	effectiveFrom  time.Time
	effectiveUntil time.Time
}

type serviceStatusMatch struct {
	record       serviceStatusRecord
	score        int
	recordStatus serviceStatusRecordStatus
}

func (r *Runtime) LookupServiceStatus(ctx context.Context, rawBody []byte) Response {
	payloadBody, err := structuredQueryPayloadBody(rawBody)
	if err != nil {
		return invalidRequest("Service status request body must be a JSON object.")
	}
	var request serviceStatusRequest
	if err := json.Unmarshal(payloadBody, &request); err != nil {
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
	queryTime, err := serviceStatusQueryTime(request, timeAnchor)
	if err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, "temporal_scope_ambiguous")
	}
	matchResult := matchServiceStatusRecord(bundle.ServiceStatusRecords, request, queryTime)
	if matchResult.err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, matchResult.err.Error())
	}
	if matchResult.ambiguous {
		body := serviceStatusResult{
			SubjectQuery:      request.SubjectQuery,
			Outcome:           "clarification_required",
			QueriedTimeAnchor: timeAnchor,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	if !matchResult.ok {
		body := serviceStatusResult{
			SubjectQuery:      request.SubjectQuery,
			Outcome:           "not_found",
			QueriedTimeAnchor: timeAnchor,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	record := matchResult.record
	body := serviceStatusResult{
		SubjectQuery:       request.SubjectQuery,
		Outcome:            "resolved_current",
		ResolvedSubject:    record.DisplayName,
		ObservedStatus:     record.ObservedStatus,
		StatusNote:         strings.TrimSpace(record.StatusNote),
		QueriedTimeAnchor:  timeAnchor,
		EffectiveFrom:      record.EffectiveFrom,
		EffectiveUntil:     record.EffectiveUntil,
		OverrideSourceRefs: append([]string(nil), record.OverrideSourceRefs...),
		RelatedNoticeRefs:  append([]string(nil), record.RelatedNoticeRefs...),
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
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

type serviceStatusMatchResult struct {
	record                    serviceStatusRecord
	recordStatus              serviceStatusRecordStatus
	ok                        bool
	ambiguous                 bool
	err                       error
}

func matchServiceStatusRecord(
	records []serviceStatusRecord,
	request serviceStatusRequest,
	queryTime time.Time,
) serviceStatusMatchResult {
	query := normalizeSearchText(request.SubjectQuery)
	campusScope := normalizeSearchText(request.CampusScope)
	everMatched := false
	matches := []serviceStatusMatch{}
	for _, record := range records {
		if campusScope != "" && !serviceStatusCampusMatches(campusScope, record.CampusScope) {
			continue
		}
		score := scoreServiceStatusRecord(query, record)
		if score <= 0 {
			continue
		}
		everMatched = true
		recordStatus, err := validateServiceStatusRecord(record)
		if err != nil {
			return serviceStatusMatchResult{err: errors.New("source_truth_unavailable")}
		}
		if queryTime.Before(recordStatus.effectiveFrom) || !queryTime.Before(recordStatus.effectiveUntil) {
			continue
		}
		matches = append(matches, serviceStatusMatch{
			record:       record,
			score:        score,
			recordStatus: recordStatus,
		})
	}
	if len(matches) == 0 {
		if everMatched {
			return serviceStatusMatchResult{err: errors.New("current_state_unverifiable")}
		}
		return serviceStatusMatchResult{ok: false}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		return serviceStatusMatchLess(matches[i], matches[j])
	})
	top := matches[0]
	if serviceStatusHasTopAmbiguity(top, matches[1:]) {
		return serviceStatusMatchResult{ambiguous: true}
	}
	if serviceStatusHasTopConflict(top, matches[1:]) {
		return serviceStatusMatchResult{err: errors.New("source_conflict")}
	}
	return serviceStatusMatchResult{
		record:       top.record,
		recordStatus: top.recordStatus,
		ok:           true,
	}
}

func matchesServiceStatusRecord(query string, record serviceStatusRecord) bool {
	return scoreServiceStatusRecord(query, record) > 0
}

func scoreServiceStatusRecord(query string, record serviceStatusRecord) int {
	candidates := []string{
		record.SubjectID,
		record.DisplayName,
		record.ServiceFamily,
		record.CampusScope,
		record.AffectedScope,
		record.StatusReason,
		record.StatusNote,
		record.SearchText,
	}
	candidates = append(candidates, record.Aliases...)
	candidates = append(candidates, serviceStatusRefTexts(record.LocationRefs)...)
	candidates = append(candidates, serviceStatusRefTexts(record.PlatformRefs)...)
	best := 0
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		score := 0
		switch {
		case query == normalized:
			score = 100 + len([]rune(normalized))
		case strings.Contains(query, normalized):
			score = len([]rune(normalized))
		case strings.Contains(normalized, query):
			score = len([]rune(query))
		}
		if score > best {
			best = score
		}
	}
	return best
}

func serviceStatusRefTexts(refs []serviceStatusRef) []string {
	values := []string{}
	for _, ref := range refs {
		values = append(values, ref.ID, ref.Label, ref.DisplayName, ref.Name, ref.PlaceID, ref.PlatformID)
	}
	return values
}

func serviceStatusCampusMatches(queryCampus string, recordCampus string) bool {
	normalizedRecordCampus := normalizeSearchText(recordCampus)
	return normalizedRecordCampus == "" ||
		normalizedRecordCampus == "all" ||
		normalizedRecordCampus == "university" ||
		normalizedRecordCampus == queryCampus
}

func serviceStatusMatchLess(left serviceStatusMatch, right serviceStatusMatch) bool {
	if left.score != right.score {
		return left.score > right.score
	}
	if left.recordStatus.effectiveFrom != right.recordStatus.effectiveFrom {
		return left.recordStatus.effectiveFrom.After(right.recordStatus.effectiveFrom)
	}
	leftDuration := left.recordStatus.effectiveUntil.Sub(left.recordStatus.effectiveFrom)
	rightDuration := right.recordStatus.effectiveUntil.Sub(right.recordStatus.effectiveFrom)
	if leftDuration != rightDuration {
		return leftDuration < rightDuration
	}
	return left.record.SubjectID < right.record.SubjectID
}

func serviceStatusHasTopConflict(top serviceStatusMatch, rest []serviceStatusMatch) bool {
	for _, candidate := range rest {
		if !sameServiceStatusSubject(top.record, candidate.record) {
			continue
		}
		if !serviceStatusWindowsOverlap(top.recordStatus, candidate.recordStatus) {
			continue
		}
		if serviceStatusSpecificOverrideWins(top, candidate) {
			continue
		}
		if strings.TrimSpace(top.record.ObservedStatus) != strings.TrimSpace(candidate.record.ObservedStatus) ||
			strings.TrimSpace(top.record.StatusNote) != strings.TrimSpace(candidate.record.StatusNote) {
			return true
		}
	}
	return false
}

func serviceStatusHasTopAmbiguity(top serviceStatusMatch, rest []serviceStatusMatch) bool {
	for _, candidate := range rest {
		if candidate.score != top.score {
			return false
		}
		if !sameServiceStatusSubject(top.record, candidate.record) {
			return true
		}
	}
	return false
}

func serviceStatusWindowsOverlap(left serviceStatusRecordStatus, right serviceStatusRecordStatus) bool {
	return left.effectiveFrom.Before(right.effectiveUntil) && right.effectiveFrom.Before(left.effectiveUntil)
}

func serviceStatusSpecificOverrideWins(top serviceStatusMatch, candidate serviceStatusMatch) bool {
	return len(top.record.OverrideSourceRefs) > 0 &&
		top.recordStatus.effectiveFrom.After(candidate.recordStatus.effectiveFrom) &&
		top.recordStatus.effectiveUntil.Before(candidate.recordStatus.effectiveUntil)
}

func sameServiceStatusSubject(left serviceStatusRecord, right serviceStatusRecord) bool {
	leftSubjectID := normalizeSearchText(left.SubjectID)
	rightSubjectID := normalizeSearchText(right.SubjectID)
	if leftSubjectID != "" && leftSubjectID == rightSubjectID {
		return true
	}
	leftDisplayName := normalizeSearchText(left.DisplayName)
	rightDisplayName := normalizeSearchText(right.DisplayName)
	return leftDisplayName != "" && leftDisplayName == rightDisplayName
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
	if !isAllowedServiceStatusFamily(record.ServiceFamily) {
		return serviceStatusRecordStatus{}, errors.New("service_family is invalid")
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

func isAllowedServiceStatusFamily(value string) bool {
	switch strings.TrimSpace(value) {
	case "facility", "it_platform", "library", "service_counter", "transport_adjacent":
		return true
	default:
		return false
	}
}

func isAllowedObservedStatus(value string) bool {
	switch strings.TrimSpace(value) {
	case "open", "closed", "temporarily_closed", "limited_service":
		return true
	default:
		return false
	}
}
