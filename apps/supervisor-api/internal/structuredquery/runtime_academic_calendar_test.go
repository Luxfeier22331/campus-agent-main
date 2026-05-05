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
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-04",
				"end_date":"2026-05-10",
				"week_index":10,
				"day_kind":"teaching_day",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			},
			{
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-01",
				"end_date":"2026-05-05",
				"week_index":9,
				"day_kind":"holiday",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"劳动节假期",
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
