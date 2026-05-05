package structuredquery

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"
)

type academicCalendarRequest struct {
	QueryText         string        `json:"query_text"`
	TemporalQuery     temporalQuery `json:"temporal_query"`
	AcademicYearLabel string        `json:"academic_year_label"`
	DateHint          string        `json:"date_hint"`
}

type academicCalendarResult struct {
	QueryText         string   `json:"query_text"`
	Outcome           string   `json:"outcome"`
	RequestedDate     string   `json:"requested_date,omitempty"`
	ResolvedDate      string   `json:"resolved_date,omitempty"`
	AcademicYearLabel string   `json:"academic_year_label,omitempty"`
	TermLabel         string   `json:"term_label,omitempty"`
	WeekIndex         int      `json:"week_index,omitempty"`
	DayKind           string   `json:"day_kind,omitempty"`
	ClassDayPattern   string   `json:"class_day_pattern,omitempty"`
	IsMakeupClass     *bool    `json:"is_makeup_class,omitempty"`
	HolidayName       string   `json:"holiday_name,omitempty"`
	SourceRefs        []string `json:"source_refs,omitempty"`
	QueriedTimeAnchor string   `json:"queried_time_anchor,omitempty"`
	EffectiveFrom     string   `json:"effective_from,omitempty"`
	EffectiveUntil    string   `json:"effective_until,omitempty"`
	FailCloseReason   string   `json:"fail_close_reason,omitempty"`
}

func (r *Runtime) LookupAcademicCalendar(ctx context.Context, rawBody []byte) Response {
	payloadBody, err := structuredQueryPayloadBody(rawBody)
	if err != nil {
		return invalidRequest("Academic calendar request body must be a JSON object.")
	}
	var request academicCalendarRequest
	if err := json.Unmarshal(payloadBody, &request); err != nil {
		return invalidRequest("Academic calendar request body must be a JSON object.")
	}
	request.QueryText = strings.TrimSpace(request.QueryText)
	request.AcademicYearLabel = strings.TrimSpace(request.AcademicYearLabel)
	request.DateHint = strings.TrimSpace(request.DateHint)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if err := ctx.Err(); err != nil {
		return failClosedAcademicCalendar(request, r.timeAnchor(), "source_truth_unavailable")
	}
	return r.lookupAcademicCalendar(ctx, request)
}

func (r *Runtime) lookupAcademicCalendar(ctx context.Context, request academicCalendarRequest) Response {
	timeAnchor := r.timeAnchor()
	bundle, err := r.loadAcademicCalendarBundle(ctx)
	if err != nil {
		return failClosedAcademicCalendar(request, timeAnchor, "source_truth_unavailable")
	}
	if len(bundle.AcademicCalendarRecords) == 0 {
		return failClosedAcademicCalendar(request, timeAnchor, "source_family_unavailable")
	}
	targetDate := academicCalendarRequestedDate(request, timeAnchor)
	holidayQuery := academicCalendarHolidayQuery(request.QueryText)
	if holidayQuery != "" {
		targetDate = ""
	}
	makeupQuery := academicCalendarMakeupQuery(request.QueryText)
	if makeupQuery && request.DateHint == "" && !academicCalendarRelativeDateQuery(request.QueryText) {
		targetDate = ""
	}
	matches := academicCalendarMatches(
		bundle.AcademicCalendarRecords,
		request,
		targetDate,
		holidayQuery,
		timeAnchor,
	)
	if len(matches) == 0 {
		return Response{
			StatusCode: 200,
			Outcome:    "not_found",
			Body: academicCalendarResult{
				QueryText:         request.QueryText,
				Outcome:           "not_found",
				RequestedDate:     targetDate,
				QueriedTimeAnchor: timeAnchor,
			},
		}
	}
	record := matches[0]
	resolvedDate := targetDate
	if resolvedDate == "" && record.StartDate == record.EndDate {
		resolvedDate = record.StartDate
	}
	isMakeup := record.IsMakeupClass
	body := academicCalendarResult{
		QueryText:         request.QueryText,
		Outcome:           "resolved_current",
		RequestedDate:     targetDate,
		ResolvedDate:      resolvedDate,
		AcademicYearLabel: record.AcademicYearLabel,
		TermLabel:         record.TermLabel,
		WeekIndex:         record.WeekIndex,
		DayKind:           record.DayKind,
		ClassDayPattern:   record.ClassDayPattern,
		IsMakeupClass:     &isMakeup,
		HolidayName:       record.HolidayName,
		SourceRefs:        append([]string(nil), record.SourceRefs...),
		QueriedTimeAnchor: timeAnchor,
		EffectiveFrom:     record.StartDate,
		EffectiveUntil:    record.EndDate,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func academicCalendarRequestedDate(request academicCalendarRequest, timeAnchor string) string {
	if request.DateHint != "" {
		return request.DateHint
	}
	parsedAnchor, err := time.Parse(time.RFC3339, timeAnchor)
	if err != nil {
		return ""
	}
	return parsedAnchor.Format("2006-01-02")
}

func academicCalendarMatches(
	records []academicCalendarRecord,
	request academicCalendarRequest,
	targetDate string,
	holidayQuery string,
	timeAnchor string,
) []academicCalendarRecord {
	weekQuery := strings.Contains(request.QueryText, "教学周") || strings.Contains(request.QueryText, "第几周")
	makeupQuery := academicCalendarMakeupQuery(request.QueryText)
	matches := make([]academicCalendarRecord, 0)
	for _, record := range records {
		if request.AcademicYearLabel != "" && record.AcademicYearLabel != request.AcademicYearLabel {
			continue
		}
		if holidayQuery != "" && !academicCalendarRecordMatchesHoliday(record, holidayQuery) {
			continue
		}
		if targetDate != "" && !academicCalendarContainsDate(record, targetDate) {
			continue
		}
		matches = append(matches, record)
	}
	sort.SliceStable(matches, func(i, j int) bool {
		leftScore := academicCalendarMatchScore(
			matches[i],
			targetDate,
			weekQuery,
			makeupQuery,
			holidayQuery,
			timeAnchor,
		)
		rightScore := academicCalendarMatchScore(
			matches[j],
			targetDate,
			weekQuery,
			makeupQuery,
			holidayQuery,
			timeAnchor,
		)
		if leftScore != rightScore {
			return leftScore > rightScore
		}
		leftSpan := academicCalendarDateSpan(matches[i])
		rightSpan := academicCalendarDateSpan(matches[j])
		if leftSpan != rightSpan {
			return leftSpan < rightSpan
		}
		if matches[i].AcademicYearLabel != matches[j].AcademicYearLabel {
			return matches[i].AcademicYearLabel > matches[j].AcademicYearLabel
		}
		return matches[i].WeekIndex < matches[j].WeekIndex
	})
	return matches
}

func academicCalendarMakeupQuery(queryText string) bool {
	return strings.Contains(queryText, "补课") ||
		strings.Contains(queryText, "调休上课") ||
		strings.Contains(queryText, "上周几的课") ||
		strings.Contains(queryText, "上星期几的课") ||
		strings.Contains(queryText, "执行周")
}

func academicCalendarRelativeDateQuery(queryText string) bool {
	return strings.Contains(queryText, "今天") ||
		strings.Contains(queryText, "明天") ||
		strings.Contains(queryText, "后天") ||
		strings.Contains(queryText, "昨天")
}

func academicCalendarHolidayQuery(queryText string) string {
	normalized := strings.ToLower(strings.TrimSpace(queryText))
	for canonical, aliases := range map[string][]string{
		"劳动节": {"五一", "劳动节"},
		"国庆":  {"十一", "国庆"},
		"元旦":  {"元旦"},
		"端午":  {"端午"},
		"中秋":  {"中秋"},
		"清明":  {"清明"},
		"春假":  {"春假"},
		"寒假":  {"寒假"},
		"暑假":  {"暑假"},
	} {
		for _, alias := range aliases {
			if strings.Contains(normalized, alias) {
				return canonical
			}
		}
	}
	return ""
}

func academicCalendarRecordMatchesHoliday(record academicCalendarRecord, holidayQuery string) bool {
	normalizedHoliday := strings.ToLower(record.HolidayName)
	if strings.Contains(normalizedHoliday, strings.ToLower(holidayQuery)) {
		return true
	}
	switch holidayQuery {
	case "劳动节":
		return strings.Contains(normalizedHoliday, "五一")
	case "国庆":
		return strings.Contains(normalizedHoliday, "十一")
	default:
		return false
	}
}

func academicCalendarMatchScore(
	record academicCalendarRecord,
	targetDate string,
	weekQuery bool,
	makeupQuery bool,
	holidayQuery string,
	timeAnchor string,
) int {
	score := 0
	if holidayQuery != "" && academicCalendarRecordMatchesHoliday(record, holidayQuery) {
		score += 100
	}
	if makeupQuery && record.IsMakeupClass {
		score += 100
	}
	if weekQuery && !record.IsMakeupClass && strings.TrimSpace(record.HolidayName) == "" && record.DayKind == "teaching_day" {
		score += 100
	}
	if targetDate != "" {
		switch {
		case record.StartDate == targetDate && record.EndDate == targetDate:
			score += 20
		case record.StartDate == targetDate || record.EndDate == targetDate:
			score += 10
		case academicCalendarContainsDate(record, targetDate):
			score += 5
		}
	}
	if targetDate == "" && makeupQuery {
		score += academicCalendarFutureDateScore(record, timeAnchor)
	}
	return score
}

func academicCalendarFutureDateScore(record academicCalendarRecord, timeAnchor string) int {
	anchor, err := time.Parse(time.RFC3339, timeAnchor)
	if err != nil || record.StartDate == "" {
		return 0
	}
	anchorDate := anchor.Format("2006-01-02")
	if record.StartDate < anchorDate {
		return 0
	}
	startDate, err := time.Parse("2006-01-02", record.StartDate)
	if err != nil {
		return 0
	}
	days := int(startDate.Sub(anchor).Hours() / 24)
	if days < 0 {
		days = 0
	}
	if days > 365 {
		return 1
	}
	return 365 - days
}

func academicCalendarDateSpan(record academicCalendarRecord) int {
	if record.StartDate == "" || record.EndDate == "" {
		return 999999
	}
	start, startErr := time.Parse("2006-01-02", record.StartDate)
	end, endErr := time.Parse("2006-01-02", record.EndDate)
	if startErr != nil || endErr != nil || end.Before(start) {
		return 999999
	}
	return int(end.Sub(start).Hours() / 24)
}

func academicCalendarContainsDate(record academicCalendarRecord, targetDate string) bool {
	if record.StartDate == "" || record.EndDate == "" || targetDate == "" {
		return true
	}
	return record.StartDate <= targetDate && targetDate <= record.EndDate
}

func failClosedAcademicCalendar(
	request academicCalendarRequest,
	timeAnchor string,
	reason string,
) Response {
	return Response{
		StatusCode: 200,
		Outcome:    "temporarily_unverifiable",
		Body: academicCalendarResult{
			QueryText:         request.QueryText,
			Outcome:           "temporarily_unverifiable",
			RequestedDate:     academicCalendarRequestedDate(request, timeAnchor),
			QueriedTimeAnchor: timeAnchor,
			FailCloseReason:   reason,
		},
	}
}
