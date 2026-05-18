package structuredquery

import (
	"context"
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"time"
)

type academicCalendarRequest struct {
	QueryText         string        `json:"query_text"`
	TemporalQuery     temporalQuery `json:"temporal_query"`
	AcademicYearLabel string        `json:"academic_year_label"`
	DateHint          string        `json:"date_hint"`
	QueryKind         string        `json:"query_kind"`
	AnswerFocus       string        `json:"answer_focus"`
	EventQuery        string        `json:"event_query"`
	TargetDate        string        `json:"target_date"`
	Audience          string        `json:"audience"`
	TermLabel         string        `json:"term_label"`
}

type academicCalendarRelatedContext struct {
	Relation         string   `json:"relation"`
	EventName        string   `json:"event_name,omitempty"`
	EventType        string   `json:"event_type,omitempty"`
	DisplayStartDate string   `json:"display_start_date,omitempty"`
	DisplayEndDate   string   `json:"display_end_date,omitempty"`
	DurationDays     int      `json:"duration_days,omitempty"`
	AppliesTo        []string `json:"applies_to,omitempty"`
	SourceRefs       []string `json:"source_refs,omitempty"`
	SourceTitle      string   `json:"source_title,omitempty"`
	SourceURL        string   `json:"source_url,omitempty"`
}

type academicCalendarResult struct {
	QueryText               string                           `json:"query_text"`
	Outcome                 string                           `json:"outcome"`
	QueryKind               string                           `json:"query_kind,omitempty"`
	AnswerFocus             string                           `json:"answer_focus,omitempty"`
	RequestedDate           string                           `json:"requested_date,omitempty"`
	ResolvedDate            string                           `json:"resolved_date,omitempty"`
	AcademicYearLabel       string                           `json:"academic_year_label,omitempty"`
	TermLabel               string                           `json:"term_label,omitempty"`
	WeekIndex               int                              `json:"week_index,omitempty"`
	DayKind                 string                           `json:"day_kind,omitempty"`
	ClassDayPattern         string                           `json:"class_day_pattern,omitempty"`
	IsMakeupClass           *bool                            `json:"is_makeup_class,omitempty"`
	HolidayName             string                           `json:"holiday_name,omitempty"`
	SourceRefs              []string                         `json:"source_refs,omitempty"`
	QueriedTimeAnchor       string                           `json:"queried_time_anchor,omitempty"`
	EffectiveFrom           string                           `json:"effective_from,omitempty"`
	EffectiveUntil          string                           `json:"effective_until,omitempty"`
	FailCloseReason         string                           `json:"fail_close_reason,omitempty"`
	EventName               string                           `json:"event_name,omitempty"`
	EventType               string                           `json:"event_type,omitempty"`
	EventAliases            []string                         `json:"event_aliases,omitempty"`
	EventStartDate          string                           `json:"event_start_date,omitempty"`
	EventEndDateExclusive   string                           `json:"event_end_date_exclusive,omitempty"`
	DisplayStartDate        string                           `json:"display_start_date,omitempty"`
	DisplayEndDate          string                           `json:"display_end_date,omitempty"`
	AppliesTo               []string                         `json:"applies_to,omitempty"`
	SourceTitle             string                           `json:"source_title,omitempty"`
	SourceURL               string                           `json:"source_url,omitempty"`
	CalendarRecordID        string                           `json:"calendar_record_id,omitempty"`
	ConflictRefs            []string                         `json:"conflict_refs,omitempty"`
	DurationDays            int                              `json:"duration_days,omitempty"`
	PrimaryRecordID         string                           `json:"primary_record_id,omitempty"`
	PrimarySourceRefs       []string                         `json:"primary_source_refs,omitempty"`
	RelatedCalendarContexts []academicCalendarRelatedContext `json:"related_calendar_contexts,omitempty"`
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
	request.QueryKind = strings.TrimSpace(request.QueryKind)
	request.AnswerFocus = strings.TrimSpace(request.AnswerFocus)
	request.EventQuery = strings.TrimSpace(request.EventQuery)
	request.TargetDate = strings.TrimSpace(request.TargetDate)
	request.Audience = strings.TrimSpace(request.Audience)
	request.TermLabel = strings.TrimSpace(request.TermLabel)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if request.QueryKind != "" && !academicCalendarAllowedQueryKind(request.QueryKind) {
		return invalidRequest("unsupported query_kind: " + request.QueryKind)
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
	queryKind := academicCalendarQueryKind(request)
	answerFocus := academicCalendarAnswerFocus(request, queryKind)
	targetDate := academicCalendarRequestedDate(request, timeAnchor)
	eventQuery := academicCalendarEventQuery(request)
	if queryKind == "named_event_range" || (eventQuery != "" && request.TargetDate == "" && request.DateHint == "") {
		targetDate = ""
	}
	makeupQuery := academicCalendarMakeupQuery(request.QueryText)
	if makeupQuery && request.TargetDate == "" && request.DateHint == "" && !academicCalendarRelativeDateQuery(request.QueryText) {
		targetDate = ""
	}
	matches := academicCalendarMatches(
		bundle.AcademicCalendarRecords,
		request,
		queryKind,
		targetDate,
		eventQuery,
		timeAnchor,
	)
	if len(matches) == 0 {
		return Response{
			StatusCode: 200,
			Outcome:    "not_found",
			Body: academicCalendarResult{
				QueryText:         request.QueryText,
				Outcome:           "not_found",
				QueryKind:         queryKind,
				AnswerFocus:       answerFocus,
				RequestedDate:     targetDate,
				QueriedTimeAnchor: timeAnchor,
			},
		}
	}
	record := academicCalendarPrimaryRecord(matches, request, queryKind, answerFocus)
	if len(record.SourceRefs) == 0 {
		return failClosedAcademicCalendar(request, timeAnchor, "source_truth_unavailable")
	}
	relatedContexts := academicCalendarRelatedContexts(matches, record, answerFocus)
	resolvedDate := targetDate
	if resolvedDate == "" && record.StartDate == record.EndDate {
		resolvedDate = record.StartDate
	}
	isMakeup := record.IsMakeupClass
	durationDays := academicCalendarDurationDays(record)
	body := academicCalendarResult{
		QueryText:               request.QueryText,
		Outcome:                 "resolved_current",
		QueryKind:               queryKind,
		AnswerFocus:             answerFocus,
		RequestedDate:           targetDate,
		ResolvedDate:            resolvedDate,
		AcademicYearLabel:       record.AcademicYearLabel,
		TermLabel:               record.TermLabel,
		WeekIndex:               record.WeekIndex,
		DayKind:                 record.DayKind,
		ClassDayPattern:         record.ClassDayPattern,
		IsMakeupClass:           &isMakeup,
		HolidayName:             record.HolidayName,
		SourceRefs:              append([]string(nil), record.SourceRefs...),
		QueriedTimeAnchor:       timeAnchor,
		EffectiveFrom:           record.StartDate,
		EffectiveUntil:          record.EndDate,
		EventName:               academicCalendarRecordEventName(record),
		EventType:               record.EventType,
		EventAliases:            append([]string(nil), record.EventAliases...),
		EventStartDate:          academicCalendarDefaultString(record.EventStartDate, record.StartDate),
		EventEndDateExclusive:   academicCalendarRecordEndExclusive(record),
		DisplayStartDate:        academicCalendarDefaultString(record.DisplayStartDate, record.StartDate),
		DisplayEndDate:          academicCalendarDefaultString(record.DisplayEndDate, record.EndDate),
		AppliesTo:               append([]string(nil), record.AppliesTo...),
		SourceTitle:             record.SourceTitle,
		SourceURL:               record.SourceURL,
		CalendarRecordID:        record.CalendarRecordID,
		ConflictRefs:            append([]string(nil), record.ConflictRefs...),
		DurationDays:            durationDays,
		PrimaryRecordID:         record.CalendarRecordID,
		PrimarySourceRefs:       append([]string(nil), record.SourceRefs...),
		RelatedCalendarContexts: relatedContexts,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func academicCalendarRequestedDate(request academicCalendarRequest, timeAnchor string) string {
	if request.TargetDate != "" {
		return request.TargetDate
	}
	if request.DateHint != "" {
		return request.DateHint
	}
	if extractedDate := academicCalendarExtractDate(request.QueryText); extractedDate != "" {
		return extractedDate
	}
	parsedAnchor, err := time.Parse(time.RFC3339, timeAnchor)
	if err != nil {
		return ""
	}
	return parsedAnchor.Format("2006-01-02")
}

func academicCalendarDefaultString(value string, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return value
}

func academicCalendarMatches(
	records []academicCalendarRecord,
	request academicCalendarRequest,
	queryKind string,
	targetDate string,
	eventQuery string,
	timeAnchor string,
) []academicCalendarRecord {
	weekQuery := strings.Contains(request.QueryText, "教学周") || strings.Contains(request.QueryText, "第几周")
	makeupQuery := academicCalendarMakeupQuery(request.QueryText)
	matches := make([]academicCalendarRecord, 0)
	for _, record := range records {
		if request.AcademicYearLabel != "" && record.AcademicYearLabel != request.AcademicYearLabel {
			continue
		}
		if request.TermLabel != "" && record.TermLabel != request.TermLabel {
			continue
		}
		if queryKind != "" && !academicCalendarRecordMatchesQueryKind(record, queryKind) {
			continue
		}
		if eventQuery != "" && !academicCalendarRecordMatchesEvent(record, eventQuery) {
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
			queryKind,
			targetDate,
			weekQuery,
			makeupQuery,
			eventQuery,
			timeAnchor,
		)
		rightScore := academicCalendarMatchScore(
			matches[j],
			queryKind,
			targetDate,
			weekQuery,
			makeupQuery,
			eventQuery,
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

func academicCalendarQueryKind(request academicCalendarRequest) string {
	if request.QueryKind != "" {
		return request.QueryKind
	}
	queryText := request.QueryText
	if strings.Contains(queryText, "教学周") || strings.Contains(queryText, "第几周") {
		return "date_week"
	}
	if academicCalendarMakeupQuery(queryText) {
		return "class_day_pattern"
	}
	if strings.Contains(queryText, "学期") && (strings.Contains(queryText, "开始") || strings.Contains(queryText, "结束") || strings.Contains(queryText, "什么时候")) {
		return "term_window"
	}
	if academicCalendarEventQuery(request) != "" {
		if request.TargetDate != "" || request.DateHint != "" || strings.Contains(queryText, "上课") || strings.Contains(queryText, "吗") {
			return "day_status"
		}
		return "named_event_range"
	}
	return "date_week"
}

func academicCalendarAllowedQueryKind(queryKind string) bool {
	switch queryKind {
	case "date_week", "named_event_range", "day_status", "class_day_pattern", "term_window":
		return true
	default:
		return false
	}
}

func academicCalendarAnswerFocus(request academicCalendarRequest, queryKind string) string {
	if request.AnswerFocus != "" {
		return request.AnswerFocus
	}
	switch queryKind {
	case "date_week":
		return "teaching_week"
	case "term_window":
		return "term_window"
	case "day_status":
		return "day_status"
	case "class_day_pattern":
		return "course_adjustment"
	case "named_event_range":
		eventQuery := academicCalendarEventQuery(request)
		switch eventQuery {
		case "劳动节":
			return "holiday_duration"
		case "春假":
			return "campus_break_window"
		default:
			return "course_adjustment"
		}
	default:
		return ""
	}
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

func academicCalendarEventQuery(request academicCalendarRequest) string {
	if request.EventQuery != "" {
		return request.EventQuery
	}
	return academicCalendarHolidayQuery(request.QueryText)
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

func academicCalendarRecordMatchesEvent(record academicCalendarRecord, eventQuery string) bool {
	normalizedQuery := strings.ToLower(strings.TrimSpace(eventQuery))
	if normalizedQuery == "" {
		return true
	}
	if academicCalendarRecordMatchesHoliday(record, normalizedQuery) {
		return true
	}
	for _, alias := range record.EventAliases {
		if strings.Contains(strings.ToLower(alias), normalizedQuery) || strings.Contains(normalizedQuery, strings.ToLower(alias)) {
			return true
		}
	}
	if strings.Contains(strings.ToLower(record.EventName), normalizedQuery) {
		return true
	}
	return strings.Contains(strings.ToLower(record.TermLabel), normalizedQuery)
}

func academicCalendarRecordMatchesQueryKind(record academicCalendarRecord, queryKind string) bool {
	switch queryKind {
	case "date_week":
		return record.RecordFamily == "" || record.RecordFamily == "teaching_week" || record.DayKind == "teaching_day"
	case "named_event_range":
		return record.RecordFamily == "named_event" ||
			record.RecordFamily == "course_suspension" ||
			record.RecordFamily == "normal_rest_day" ||
			record.RecordFamily == "workday_makeup" ||
			record.HolidayName != ""
	case "day_status":
		return record.RecordFamily == "named_event" ||
			record.RecordFamily == "teaching_week" ||
			record.RecordFamily == "class_day_override" ||
			record.RecordFamily == "course_suspension" ||
			record.RecordFamily == "normal_rest_day" ||
			record.RecordFamily == "workday_makeup" ||
			record.HolidayName != "" ||
			record.DayKind == "teaching_day" ||
			record.DayKind == "makeup_class_day" ||
			record.DayKind == "course_suspension" ||
			record.DayKind == "normal_rest_day" ||
			record.DayKind == "workday_makeup"
	case "class_day_pattern":
		return record.RecordFamily == "class_day_override" ||
			record.RecordFamily == "workday_makeup" ||
			record.IsMakeupClass
	case "term_window":
		return record.RecordFamily == "term_window" || record.DayKind == "term_window"
	default:
		return true
	}
}

func academicCalendarMatchScore(
	record academicCalendarRecord,
	queryKind string,
	targetDate string,
	weekQuery bool,
	makeupQuery bool,
	holidayQuery string,
	timeAnchor string,
) int {
	score := 0
	if holidayQuery != "" && academicCalendarRecordMatchesEvent(record, holidayQuery) {
		score += 100
	}
	score += academicCalendarQueryKindScore(record, queryKind)
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

func academicCalendarPrimaryRecord(
	matches []academicCalendarRecord,
	request academicCalendarRequest,
	queryKind string,
	answerFocus string,
) academicCalendarRecord {
	if len(matches) == 0 {
		return academicCalendarRecord{}
	}
	if answerFocus == "holiday_duration" {
		eventQuery := academicCalendarEventQuery(request)
		for _, record := range matches {
			if record.RecordFamily == "named_event" && academicCalendarRecordMatchesEvent(record, eventQuery) {
				return record
			}
		}
	}
	if answerFocus == "campus_break_window" {
		for _, record := range matches {
			if record.RecordFamily == "course_suspension" {
				return record
			}
		}
	}
	if answerFocus == "course_adjustment" && queryKind == "class_day_pattern" {
		for _, record := range matches {
			if record.RecordFamily == "workday_makeup" || record.RecordFamily == "class_day_override" || record.IsMakeupClass {
				return record
			}
		}
	}
	return matches[0]
}

func academicCalendarRelatedContexts(
	matches []academicCalendarRecord,
	primary academicCalendarRecord,
	answerFocus string,
) []academicCalendarRelatedContext {
	related := make([]academicCalendarRelatedContext, 0)
	for _, record := range matches {
		if record.CalendarRecordID == primary.CalendarRecordID {
			continue
		}
		if answerFocus == "holiday_duration" && record.RecordFamily == "course_suspension" {
			related = append(related, academicCalendarRelatedContext{
				Relation:         "overlapping_campus_course_adjustment",
				EventName:        academicCalendarRecordEventName(record),
				EventType:        record.EventType,
				DisplayStartDate: academicCalendarDefaultString(record.DisplayStartDate, record.StartDate),
				DisplayEndDate:   academicCalendarDefaultString(record.DisplayEndDate, record.EndDate),
				DurationDays:     academicCalendarDurationDays(record),
				AppliesTo:        append([]string(nil), record.AppliesTo...),
				SourceRefs:       append([]string(nil), record.SourceRefs...),
				SourceTitle:      record.SourceTitle,
				SourceURL:        record.SourceURL,
			})
			continue
		}
		if answerFocus == "campus_break_window" && (record.RecordFamily == "named_event" || strings.TrimSpace(record.HolidayName) != "") {
			related = append(related, academicCalendarRelatedContext{
				Relation:         "overlapping_holiday_window",
				EventName:        academicCalendarRecordEventName(record),
				EventType:        record.EventType,
				DisplayStartDate: academicCalendarDefaultString(record.DisplayStartDate, record.StartDate),
				DisplayEndDate:   academicCalendarDefaultString(record.DisplayEndDate, record.EndDate),
				DurationDays:     academicCalendarDurationDays(record),
				AppliesTo:        append([]string(nil), record.AppliesTo...),
				SourceRefs:       append([]string(nil), record.SourceRefs...),
				SourceTitle:      record.SourceTitle,
				SourceURL:        record.SourceURL,
			})
		}
	}
	return related
}

func academicCalendarQueryKindScore(record academicCalendarRecord, queryKind string) int {
	switch queryKind {
	case "day_status":
		if record.RecordFamily == "normal_rest_day" {
			return 110
		}
		if record.RecordFamily == "course_suspension" {
			return 105
		}
		if record.RecordFamily == "workday_makeup" {
			return 100
		}
		if record.RecordFamily == "named_event" || strings.TrimSpace(record.HolidayName) != "" {
			return 90
		}
		if record.RecordFamily == "class_day_override" || record.IsMakeupClass {
			return 80
		}
		if record.RecordFamily == "teaching_week" || record.DayKind == "teaching_day" {
			return 10
		}
	case "named_event_range":
		if record.RecordFamily == "course_suspension" {
			return 100
		}
		if record.RecordFamily == "normal_rest_day" || record.RecordFamily == "workday_makeup" {
			return 95
		}
		if record.RecordFamily == "named_event" || strings.TrimSpace(record.HolidayName) != "" {
			return 90
		}
	case "class_day_pattern":
		if record.RecordFamily == "workday_makeup" {
			return 100
		}
		if record.RecordFamily == "class_day_override" || record.IsMakeupClass {
			return 90
		}
	case "term_window":
		if record.RecordFamily == "term_window" || record.DayKind == "term_window" {
			return 90
		}
	case "date_week":
		if record.RecordFamily == "teaching_week" || record.DayKind == "teaching_day" {
			return 90
		}
	}
	return 0
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

func academicCalendarDurationDays(record academicCalendarRecord) int {
	startDate := strings.TrimSpace(academicCalendarDefaultString(record.EventStartDate, record.StartDate))
	endExclusive := strings.TrimSpace(academicCalendarRecordEndExclusive(record))
	if startDate == "" || endExclusive == "" {
		return 0
	}
	start, startErr := time.Parse("2006-01-02", startDate)
	end, endErr := time.Parse("2006-01-02", endExclusive)
	if startErr != nil || endErr != nil || !end.After(start) {
		return 0
	}
	return int(end.Sub(start).Hours() / 24)
}

func academicCalendarContainsDate(record academicCalendarRecord, targetDate string) bool {
	if record.StartDate == "" || targetDate == "" {
		return true
	}
	if record.EventEndDateExclusive != "" {
		return record.StartDate <= targetDate && targetDate < record.EventEndDateExclusive
	}
	if record.EndDate == "" {
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
			QueryKind:         academicCalendarQueryKind(request),
			RequestedDate:     academicCalendarRequestedDate(request, timeAnchor),
			QueriedTimeAnchor: timeAnchor,
			FailCloseReason:   reason,
		},
	}
}

var academicCalendarDateInTextPattern = regexp.MustCompile(`20\d{2}-\d{2}-\d{2}`)

func academicCalendarRecordEventName(record academicCalendarRecord) string {
	if record.EventName != "" {
		return record.EventName
	}
	return record.HolidayName
}

func academicCalendarRecordEndExclusive(record academicCalendarRecord) string {
	if record.EventEndDateExclusive != "" {
		return record.EventEndDateExclusive
	}
	if record.EndDate == "" {
		return ""
	}
	end, err := time.Parse("2006-01-02", record.EndDate)
	if err != nil {
		return ""
	}
	return end.AddDate(0, 0, 1).Format("2006-01-02")
}

func academicCalendarExtractDate(queryText string) string {
	return academicCalendarDateInTextPattern.FindString(queryText)
}
