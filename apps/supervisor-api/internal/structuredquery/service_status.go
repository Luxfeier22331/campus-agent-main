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
	HistoricalDowngradeReason string   `json:"historical_downgrade_reason,omitempty"`
	FailCloseReason           string   `json:"fail_close_reason,omitempty"`
}

type serviceStatusRecord struct {
	SubjectID          string   `json:"subject_id"`
	DisplayName        string   `json:"display_name"`
	Aliases            []string `json:"aliases"`
	CampusScope        string   `json:"campus_scope"`
	ObservedStatus     string   `json:"observed_status"`
	StatusNote         string   `json:"status_note"`
	EffectiveFrom      string   `json:"effective_from"`
	EffectiveUntil     string   `json:"effective_until"`
	OverrideSourceRefs []string `json:"override_source_refs"`
	RelatedNoticeRefs  []string `json:"related_notice_refs"`
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
	queryTime, err := serviceStatusQueryTime(request, timeAnchor)
	if err != nil {
		return failClosedServiceStatus(request.SubjectQuery, timeAnchor, "temporal_scope_ambiguous")
	}
	matchResult := matchServiceStatusRecord(bundle.ServiceStatusRecords, request, queryTime)
	if matchResult.err != nil {
		return failClosedServiceStatusWithHistoricalReason(
			request.SubjectQuery,
			timeAnchor,
			matchResult.err.Error(),
			matchResult.historicalDowngradeReason,
		)
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

type serviceStatusMatchResult struct {
	record                    serviceStatusRecord
	recordStatus              serviceStatusRecordStatus
	ok                        bool
	err                       error
	historicalDowngradeReason string
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
		if campusScope != "" && normalizeSearchText(record.CampusScope) != campusScope {
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
			return serviceStatusMatchResult{
				err:                       errors.New("current_state_unverifiable"),
				historicalDowngradeReason: "current_effective_miss",
			}
		}
		return serviceStatusMatchResult{ok: false}
	}
	sort.SliceStable(matches, func(i, j int) bool {
		return serviceStatusMatchLess(matches[i], matches[j])
	})
	top := matches[0]
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
	candidates := append([]string{record.SubjectID, record.DisplayName}, record.Aliases...)
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
		if top.recordStatus.effectiveFrom.Equal(candidate.recordStatus.effectiveFrom) &&
			top.recordStatus.effectiveUntil.Equal(candidate.recordStatus.effectiveUntil) &&
			(strings.TrimSpace(top.record.ObservedStatus) != strings.TrimSpace(candidate.record.ObservedStatus) ||
				strings.TrimSpace(top.record.StatusNote) != strings.TrimSpace(candidate.record.StatusNote)) {
			return true
		}
	}
	return false
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
