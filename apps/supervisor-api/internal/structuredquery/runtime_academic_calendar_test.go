package structuredquery

import (
	"context"
	"testing"
)

func TestLookupAcademicCalendarResolvesTeachingWeek(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"今天第几教学周",
		"temporal_query":{"mode":"current"},
		"date_hint":"2026-05-04"
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(academicCalendarResult)
	if !ok {
		t.Fatalf("body = %T, want academicCalendarResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.WeekIndex != 10 {
		t.Fatalf("week_index = %d, want 10", result.WeekIndex)
	}
	if result.ResolvedDate != "2026-05-04" {
		t.Fatalf("resolved_date = %q, want 2026-05-04", result.ResolvedDate)
	}
}

func TestLookupAcademicCalendarResolvesExplicitTargetDateTeachingWeek(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-07 是第几教学周",
		"query_kind":"date_week",
		"target_date":"2026-05-07",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.QueryKind != "date_week" {
		t.Fatalf("query_kind = %q, want date_week", result.QueryKind)
	}
	if result.WeekIndex != 10 {
		t.Fatalf("week_index = %d, want 10", result.WeekIndex)
	}
	if result.ResolvedDate != "2026-05-07" {
		t.Fatalf("resolved_date = %q, want 2026-05-07", result.ResolvedDate)
	}
}

func TestLookupAcademicCalendarResolvesHolidayByName(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"五一放几天",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.HolidayName != "劳动节假期" {
		t.Fatalf("holiday_name = %q, want 劳动节假期", result.HolidayName)
	}
	if result.RequestedDate != "" {
		t.Fatalf("requested_date = %q, want empty for holiday-name lookup", result.RequestedDate)
	}
	if result.EventName != "劳动节假期" {
		t.Fatalf("event_name = %q, want 劳动节假期", result.EventName)
	}
	if result.EventEndDateExclusive != "2026-05-06" {
		t.Fatalf("event_end_date_exclusive = %q, want 2026-05-06", result.EventEndDateExclusive)
	}
	if result.DisplayEndDate != "2026-05-05" {
		t.Fatalf("display_end_date = %q, want 2026-05-05", result.DisplayEndDate)
	}
}

func TestLookupAcademicCalendarResolvesHolidayDurationWithRelatedCampusBreakContext(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithNoticeArrangements(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"五一放几天",
		"query_kind":"named_event_range",
		"event_query":"劳动节",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.AnswerFocus != "holiday_duration" {
		t.Fatalf("answer_focus = %q, want holiday_duration", result.AnswerFocus)
	}
	if result.EventName != "劳动节假期" {
		t.Fatalf("event_name = %q, want 劳动节假期", result.EventName)
	}
	if result.DurationDays != 5 {
		t.Fatalf("duration_days = %d, want 5", result.DurationDays)
	}
	if len(result.RelatedCalendarContexts) != 1 {
		t.Fatalf("related_calendar_contexts = %#v, want 1 item", result.RelatedCalendarContexts)
	}
	related := result.RelatedCalendarContexts[0]
	if related.Relation != "overlapping_campus_course_adjustment" {
		t.Fatalf("related.relation = %q", related.Relation)
	}
	if related.DisplayStartDate != "2026-04-27" || related.DisplayEndDate != "2026-05-05" {
		t.Fatalf("related.display range = %s..%s", related.DisplayStartDate, related.DisplayEndDate)
	}
}

func TestLookupAcademicCalendarUsesExclusiveEventEndForDayStatus(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-06 是五一假吗",
		"query_kind":"day_status",
		"target_date":"2026-05-06",
		"event_query":"五一",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "not_found" {
		t.Fatalf("outcome = %q, want not_found after exclusive holiday end", result.Outcome)
	}
}

func TestLookupAcademicCalendarResolvesDateOnlyDayStatus(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-01 上课吗",
		"query_kind":"day_status",
		"target_date":"2026-05-01",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "holiday" {
		t.Fatalf("day_kind = %q, want holiday", result.DayKind)
	}
	if result.EventName != "劳动节假期" {
		t.Fatalf("event_name = %q, want 劳动节假期", result.EventName)
	}
}

func TestLookupAcademicCalendarDayStatusPrefersHolidayOverTeachingWeek(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-04 上课吗",
		"query_kind":"day_status",
		"target_date":"2026-05-04",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "holiday" {
		t.Fatalf("day_kind = %q, want holiday", result.DayKind)
	}
	if result.EventName != "劳动节假期" {
		t.Fatalf("event_name = %q, want 劳动节假期", result.EventName)
	}
}

func TestLookupAcademicCalendarResolvesTeachingDayStatus(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-07 上课吗",
		"query_kind":"day_status",
		"target_date":"2026-05-07",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "teaching_day" {
		t.Fatalf("day_kind = %q, want teaching_day", result.DayKind)
	}
	if result.WeekIndex != 10 {
		t.Fatalf("week_index = %d, want 10", result.WeekIndex)
	}
}

func TestLookupAcademicCalendarResolvesTermWindow(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"本学期什么时候结束",
		"query_kind":"term_window",
		"term_label":"春季学期",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.EventName != "春季学期" {
		t.Fatalf("event_name = %q, want 春季学期", result.EventName)
	}
	if result.DisplayEndDate != "2026-07-12" {
		t.Fatalf("display_end_date = %q, want 2026-07-12", result.DisplayEndDate)
	}
}

func TestLookupAcademicCalendarDoesNotInferSpringBreakWithoutSourceRecord(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"今年春假是什么时候",
		"query_kind":"named_event_range",
		"event_query":"春假",
		"temporal_query":{"mode":"current_year","year_hint":"2026"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "not_found" {
		t.Fatalf("outcome = %q, want not_found without source-backed 春假", result.Outcome)
	}
}

func TestLookupAcademicCalendarResolvesSpringBreakAliasWhenSourceBacked(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithNoticeArrangements(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"今年春假是什么时候",
		"query_kind":"named_event_range",
		"event_query":"春假",
		"temporal_query":{"mode":"current_year","year_hint":"2026"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "course_suspension" {
		t.Fatalf("day_kind = %q, want course_suspension", result.DayKind)
	}
	if result.EventName != "运动会、春季社会实践周、劳动节假期课程调整" {
		t.Fatalf("event_name = %q", result.EventName)
	}
	if result.AnswerFocus != "campus_break_window" {
		t.Fatalf("answer_focus = %q, want campus_break_window", result.AnswerFocus)
	}
	if result.DisplayStartDate != "2026-04-27" || result.DisplayEndDate != "2026-05-05" {
		t.Fatalf("display range = %s..%s", result.DisplayStartDate, result.DisplayEndDate)
	}
	if !containsString(result.EventAliases, "春假") {
		t.Fatalf("event_aliases = %#v, want 春假", result.EventAliases)
	}
}

func TestLookupAcademicCalendarResolvesSocialPracticeWeekAliasWhenSourceBacked(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithNoticeArrangements(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"春季社会实践周是什么时候",
		"query_kind":"named_event_range",
		"event_query":"春季社会实践周",
		"temporal_query":{"mode":"current_year","year_hint":"2026"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.EventName != "运动会、春季社会实践周、劳动节假期课程调整" {
		t.Fatalf("event_name = %q", result.EventName)
	}
	if result.DisplayStartDate != "2026-04-27" || result.DisplayEndDate != "2026-05-05" {
		t.Fatalf("display range = %s..%s", result.DisplayStartDate, result.DisplayEndDate)
	}
	if !containsString(result.EventAliases, "春季社会实践周") {
		t.Fatalf("event_aliases = %#v, want 春季社会实践周", result.EventAliases)
	}
	if !containsString(result.SourceRefs, "https://my.muc.edu.cn/#/print?type=6&notice_id=355682&show_type=1") {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupAcademicCalendarDayStatusPrefersNoticeNormalRestDay(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithNoticeArrangements(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-09 上课吗",
		"query_kind":"day_status",
		"target_date":"2026-05-09",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "normal_rest_day" {
		t.Fatalf("day_kind = %q, want normal_rest_day", result.DayKind)
	}
	if result.IsMakeupClass == nil || *result.IsMakeupClass {
		t.Fatalf("is_makeup_class = %#v, want false", result.IsMakeupClass)
	}
	if result.ClassDayPattern != "" {
		t.Fatalf("class_day_pattern = %q, want empty", result.ClassDayPattern)
	}
	if !containsString(result.ConflictRefs, "calendar:official_web:baseline-2026-05-09") {
		t.Fatalf("conflict_refs = %#v", result.ConflictRefs)
	}
}

func TestLookupAcademicCalendarDayStatusPrefersNoticeCourseSuspension(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithNoticeArrangements(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-04-28 上课吗",
		"query_kind":"day_status",
		"target_date":"2026-04-28",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "course_suspension" {
		t.Fatalf("day_kind = %q, want course_suspension", result.DayKind)
	}
	if result.EventName != "运动会、春季社会实践周、劳动节假期课程调整" {
		t.Fatalf("event_name = %q", result.EventName)
	}
	if !containsString(result.AppliesTo, "undergraduate") {
		t.Fatalf("applies_to = %#v, want undergraduate", result.AppliesTo)
	}
}

func TestLookupAcademicCalendarResolvesNoticeWorkdayMakeup(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithNoticeArrangements(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"4月25日为什么要上课",
		"query_kind":"class_day_pattern",
		"target_date":"2026-04-25",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.DayKind != "workday_makeup" {
		t.Fatalf("day_kind = %q, want workday_makeup", result.DayKind)
	}
	if result.IsMakeupClass == nil || !*result.IsMakeupClass {
		t.Fatalf("is_makeup_class = %#v, want true", result.IsMakeupClass)
	}
	if result.ClassDayPattern != "执行2026-05-05教学计划" {
		t.Fatalf("class_day_pattern = %q, want 执行2026-05-05教学计划", result.ClassDayPattern)
	}
	if !containsString(result.SourceRefs, "https://my.muc.edu.cn/#/print?type=5&notice_id=355589&show_type=1") {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupAcademicCalendarRejectsUnsupportedQueryKind(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"今天第几教学周",
		"query_kind":"raw_calendar_scan",
		"temporal_query":{"mode":"current"}
	}`))

	if response.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
}

func TestLookupAcademicCalendarFailsClosedWhenMatchedRecordHasNoSourceRefs(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithoutSourceRefs(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"2026-05-07 是第几教学周",
		"query_kind":"date_week",
		"target_date":"2026-05-07",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupAcademicCalendarResolvesMakeupClassArrangement(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"哪周补课",
		"temporal_query":{"mode":"current"},
		"date_hint":"2026-05-09"
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.IsMakeupClass == nil || !*result.IsMakeupClass {
		t.Fatalf("is_makeup_class = %#v, want true", result.IsMakeupClass)
	}
	if result.ClassDayPattern != "执行周一课表" {
		t.Fatalf("class_day_pattern = %q, want 执行周一课表", result.ClassDayPattern)
	}
}

func TestLookupAcademicCalendarResolvesMakeupClassArrangementWithoutExplicitDate(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixture(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"哪周补课",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.IsMakeupClass == nil || !*result.IsMakeupClass {
		t.Fatalf("is_makeup_class = %#v, want true", result.IsMakeupClass)
	}
	if result.ResolvedDate != "2026-05-09" {
		t.Fatalf("resolved_date = %q, want 2026-05-09", result.ResolvedDate)
	}
}

func TestLookupAcademicCalendarOpenEndedMakeupPrefersUpcomingRecord(t *testing.T) {
	runtime := newRuntimeWithAcademicCalendarReadModel(
		t,
		academicCalendarProjectionFixtureWithPastAndUpcomingMakeup(),
		"2026-05-04T09:00:00+08:00",
	)

	response := runtime.LookupAcademicCalendar(context.Background(), []byte(`{
		"query_text":"哪周补课",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(academicCalendarResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedDate != "2026-05-09" {
		t.Fatalf("resolved_date = %q, want upcoming 2026-05-09", result.ResolvedDate)
	}
	if result.ClassDayPattern != "执行周一课表" {
		t.Fatalf("class_day_pattern = %q, want 执行周一课表", result.ClassDayPattern)
	}
}

func newRuntimeWithAcademicCalendarReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		AcademicCalendarReadModelStore: &fakeAcademicCalendarReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

type fakeAcademicCalendarReadModelStore struct {
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	loadedReleaseIDs   []string
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s fakeAcademicCalendarReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeAcademicCalendarReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "academic-calendar-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeAcademicCalendarReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.AcademicCalendarRecords) > 0, nil
}

func (s *fakeAcademicCalendarReadModelStore) LoadBundleForRelease(
	_ context.Context,
	releaseID string,
) (projectionBundle, error) {
	s.loadCount++
	s.loadedReleaseIDs = append(s.loadedReleaseIDs, releaseID)
	return s.bundle, nil
}

func academicCalendarProjectionFixture() string {
	return `{
		"schema_version":"academic_calendar_projection.v1",
		"generated_at":"2026-05-04T09:00:00+08:00",
		"source_families":["official_web_curated_academic_calendar_v1"],
		"academic_calendar_records":[
			{
				"record_family":"teaching_week",
				"calendar_record_id":"academic-calendar:2025-2026:spring:week-10",
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-04",
				"end_date":"2026-05-10",
				"event_end_date_exclusive":"2026-05-11",
				"display_start_date":"2026-05-04",
				"display_end_date":"2026-05-10",
				"source_title":"中央民族大学 2025-2026 学年校历",
				"source_url":"https://www.muc.edu.cn/ggfw/mdxl.htm",
				"applies_to":["all"],
				"week_index":10,
				"day_kind":"teaching_day",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			},
			{
				"record_family":"named_event",
				"calendar_record_id":"academic-calendar:2025-2026:spring:labor-day",
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-01",
				"end_date":"2026-05-05",
				"event_name":"劳动节假期",
				"event_type":"holiday",
				"event_aliases":["五一","劳动节"],
				"event_start_date":"2026-05-01",
				"event_end_date_exclusive":"2026-05-06",
				"display_start_date":"2026-05-01",
				"display_end_date":"2026-05-05",
				"source_title":"中央民族大学 2025-2026 学年校历",
				"source_url":"https://www.muc.edu.cn/ggfw/mdxl.htm",
				"applies_to":["all"],
				"week_index":9,
				"day_kind":"holiday",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"劳动节假期",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			},
			{
				"record_family":"class_day_override",
				"calendar_record_id":"academic-calendar:2025-2026:spring:makeup-2026-05-09",
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-09",
				"end_date":"2026-05-09",
				"event_end_date_exclusive":"2026-05-10",
				"display_start_date":"2026-05-09",
				"display_end_date":"2026-05-09",
				"source_title":"中央民族大学 2025-2026 学年校历",
				"source_url":"https://www.muc.edu.cn/ggfw/mdxl.htm",
				"applies_to":["all"],
				"week_index":10,
				"day_kind":"makeup_class_day",
				"class_day_pattern":"执行周一课表",
				"is_makeup_class":true,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			},
			{
				"record_family":"term_window",
				"calendar_record_id":"academic-calendar:2025-2026:spring:term-window",
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-03-02",
				"end_date":"2026-07-12",
				"event_name":"春季学期",
				"event_type":"term_window",
				"event_aliases":["春季学期","本学期"],
				"event_start_date":"2026-03-02",
				"event_end_date_exclusive":"2026-07-13",
				"display_start_date":"2026-03-02",
				"display_end_date":"2026-07-12",
				"source_title":"中央民族大学 2025-2026 学年校历",
				"source_url":"https://www.muc.edu.cn/ggfw/mdxl.htm",
				"applies_to":["all"],
				"week_index":0,
				"day_kind":"term_window",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			}
		]
	}`
}

func academicCalendarProjectionFixtureWithPastAndUpcomingMakeup() string {
	return `{
		"schema_version":"academic_calendar_projection.v1",
		"generated_at":"2026-05-04T09:00:00+08:00",
		"source_families":["official_web_curated_academic_calendar_v1"],
		"academic_calendar_records":[
			{
				"academic_year_label":"2025-2026学年",
				"term_label":"秋季学期",
				"start_date":"2025-09-28",
				"end_date":"2025-09-28",
				"week_index":4,
				"day_kind":"makeup_class_day",
				"class_day_pattern":"执行周五课表",
				"is_makeup_class":true,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			},
			{
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-09",
				"end_date":"2026-05-09",
				"week_index":10,
				"day_kind":"makeup_class_day",
				"class_day_pattern":"执行周一课表",
				"is_makeup_class":true,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			}
		]
	}`
}

func academicCalendarProjectionFixtureWithoutSourceRefs() string {
	return `{
		"schema_version":"academic_calendar_projection.v1",
		"generated_at":"2026-05-04T09:00:00+08:00",
		"source_families":["official_web_curated_academic_calendar_v1"],
		"academic_calendar_records":[
			{
				"record_family":"teaching_week",
				"calendar_record_id":"academic-calendar:2025-2026:spring:week-10",
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-04",
				"end_date":"2026-05-10",
				"event_end_date_exclusive":"2026-05-11",
				"display_start_date":"2026-05-04",
				"display_end_date":"2026-05-10",
				"source_title":"中央民族大学 2025-2026 学年校历",
				"source_url":"https://www.muc.edu.cn/ggfw/mdxl.htm",
				"applies_to":["all"],
				"week_index":10,
				"day_kind":"teaching_day",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"",
				"source_refs":[]
			}
		]
	}`
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
