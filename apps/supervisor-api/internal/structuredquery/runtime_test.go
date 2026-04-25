package structuredquery

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLookupTransportScheduleReturnsCurrentSnapshotMetadata(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"最近一版校车时刻表是什么时候发布的",
		"intent":"schedule_snapshot_metadata",
		"snapshot_query":{"mode":"current"}
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(transportScheduleResult)
	if !ok {
		t.Fatalf("body = %T, want transportScheduleResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ScheduleSnapshot == nil {
		t.Fatal("schedule snapshot is nil")
	}
	if result.ScheduleSnapshot.SnapshotID != "snapshot:bus:2026-04-20" {
		t.Fatalf("snapshot_id = %q", result.ScheduleSnapshot.SnapshotID)
	}
	if result.ScheduleSnapshot.PublishedAt != "2026-04-20T18:00:00+08:00" {
		t.Fatalf("published_at = %q", result.ScheduleSnapshot.PublishedAt)
	}
	if result.ResolvedRoute != nil {
		t.Fatalf("resolved_route = %#v, want nil", result.ResolvedRoute)
	}
}

func TestLookupTransportScheduleClarifiesMissingRouteSelector(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"最近一班校车是什么时候",
		"intent":"next_departure",
		"snapshot_query":{"mode":"current"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.ClarificationReason != "route_family_required" {
		t.Fatalf("clarification_reason = %q", result.ClarificationReason)
	}
	if len(result.CandidateRoutes) != 3 {
		t.Fatalf("candidate_routes length = %d, want 3", len(result.CandidateRoutes))
	}
	if result.SelectedDeparture != nil {
		t.Fatalf("selected_departure = %#v, want nil", result.SelectedDeparture)
	}
}

func TestLookupTransportScheduleFindsTomorrowMorningFirstDepartureToFengtai(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-24T20:30:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"我明天早上要去丰台上课，最早的班车是几点",
		"intent":"first_departure",
		"route_selector":{"destination_campus":"fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"tomorrow","daypart":"morning"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.RequestedServiceDate != "2026-04-25" {
		t.Fatalf("requested_service_date = %q", result.RequestedServiceDate)
	}
	if result.ResolvedRoute == nil || result.ResolvedRoute.RouteID != "route:haidian-to-fengtai" {
		t.Fatalf("resolved_route = %#v", result.ResolvedRoute)
	}
	if result.SelectedDeparture == nil {
		t.Fatal("selected_departure is nil")
	}
	if result.SelectedDeparture.DepartureAt != "2026-04-25T06:50:00+08:00" {
		t.Fatalf("departure_at = %q", result.SelectedDeparture.DepartureAt)
	}
}

func TestLookupTransportScheduleListsDeparturesAfterTimeWithLimit(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-24T16:45:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天下午 5 点以后去丰台还有哪些班车",
		"intent":"departure_list",
		"route_selector":{"destination_campus":"fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today","departure_not_before":"17:00"},
		"result_limit":2
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.DepartureOptions) != 2 {
		t.Fatalf("departure_options length = %d, want 2", len(result.DepartureOptions))
	}
	if result.DepartureOptions[0].DepartureAt != "2026-04-24T17:10:00+08:00" {
		t.Fatalf("first departure_at = %q", result.DepartureOptions[0].DepartureAt)
	}
	if result.DepartureOptions[1].DepartureAt != "2026-04-24T18:00:00+08:00" {
		t.Fatalf("second departure_at = %q", result.DepartureOptions[1].DepartureAt)
	}
}

func TestLookupTransportScheduleClampsDepartureListResultLimit(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixtureWithDepartures(25)),
		TrustedTimeRFC3339: "2026-04-24T05:00:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天去丰台有哪些班车",
		"intent":"departure_list",
		"route_selector":{"route_id":"route:haidian-to-fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"},
		"result_limit":9999
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(transportScheduleResult)
	if !ok {
		t.Fatalf("body = %T, want transportScheduleResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.DepartureOptions) != 20 {
		t.Fatalf("departure_options length = %d, want 20", len(result.DepartureOptions))
	}
}

func TestLookupTransportScheduleAppliesTemporarySuspension(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天地铁接驳车是不是停运了",
		"intent":"service_window",
		"route_selector":{"service_family":"subway_shuttle"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ServiceStatus != "temporarily_suspended" {
		t.Fatalf("service_status = %q, want temporarily_suspended", result.ServiceStatus)
	}
	if len(result.RelatedNoticeRefs) != 1 || result.RelatedNoticeRefs[0] != "notice:metro-shuttle-suspended" {
		t.Fatalf("related_notice_refs = %#v", result.RelatedNoticeRefs)
	}
	if result.ServiceWindow != nil {
		t.Fatalf("service_window = %#v, want nil", result.ServiceWindow)
	}
}

func TestLookupServiceStatusFailsClosedWhenEffectiveWindowExpired(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceStatusProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(serviceStatusResult)
	if !ok {
		t.Fatalf("body = %T, want serviceStatusResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "current_state_unverifiable" {
		t.Fatalf("fail_close_reason = %q, want current_state_unverifiable", result.FailCloseReason)
	}
	if result.HistoricalDowngradeReason != "current_effective_miss" {
		t.Fatalf("historical_downgrade_reason = %q", result.HistoricalDowngradeReason)
	}
}

func TestLookupServiceStatusFailsClosedWhenMatchedRecordIsIncomplete(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, incompleteServiceStatusProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceGuideResolvesReadyProcedure(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuideProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(serviceGuideResult)
	if !ok {
		t.Fatalf("body = %T, want serviceGuideResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.DisplayName != "公寓楼新生办理入住手续流程" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "到指定公寓楼报到") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
	if len(result.SourceRefs) != 1 || result.SourceRefs[0] != "handbook:student_rules:pages:252-255#page=253" {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupServiceGuideClarifiesAmbiguousService(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuideProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"退宿怎么办",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.ClarificationReason != "service_ambiguous" {
		t.Fatalf("clarification_reason = %q", result.ClarificationReason)
	}
	if len(result.CandidateServices) != 2 {
		t.Fatalf("candidate_services length = %d, want 2", len(result.CandidateServices))
	}
}

func TestLookupServiceGuideFailsClosedForManualReviewRecord(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuideManualReviewFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "manual_review_required" {
		t.Fatalf("fail_close_reason = %q, want manual_review_required", result.FailCloseReason)
	}
}

func writeTransportProjectionFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "campus-services-projection.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write projection fixture: %v", err)
	}
	return path
}

func transportProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		],
		"transport_routes":[
			{
				"route_id":"route:haidian-to-fengtai",
				"display_name":"海淀到丰台通勤车",
				"service_family":"intercampus_commute",
				"aliases":["去丰台","丰台线"],
				"origin_campus":"haidian",
				"destination_campus":"fengtai",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门","aliases":["海淀东门"]},
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门","aliases":["丰台南门"]}
				]
			},
			{
				"route_id":"route:fengtai-to-haidian",
				"display_name":"丰台到海淀通勤车",
				"service_family":"intercampus_commute",
				"aliases":["回海淀","海淀线"],
				"origin_campus":"fengtai",
				"destination_campus":"haidian",
				"stops":[
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门","aliases":["丰台南门"]},
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门","aliases":["海淀东门"]}
				]
			},
			{
				"route_id":"route:subway-shuttle",
				"display_name":"地铁接驳车",
				"service_family":"subway_shuttle",
				"aliases":["地铁接驳车","metro_shuttle"],
				"origin_campus":"haidian",
				"destination_campus":"subway",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门","aliases":["海淀东门"]},
					{"stop_id":"stop:subway-station","display_name":"地铁站","aliases":["地铁站"]}
				]
			}
		],
		"scheduled_departures":[
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":"16:40","arrival_time":"17:40","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":"17:10","arrival_time":"18:10","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":"18:00","arrival_time":"19:00","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-25"],"departure_time":"06:50","arrival_time":"08:05","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-25"],"departure_time":"07:20","arrival_time":"08:35","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-25"],"departure_time":"13:20","arrival_time":"14:35","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:subway-shuttle","service_dates":["2026-04-24"],"departure_time":"08:00","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:subway-station"}
		],
		"transport_service_exceptions":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"route_id":"route:subway-shuttle",
				"service_date":"2026-04-24",
				"service_status":"temporarily_suspended",
				"related_notice_refs":["notice:metro-shuttle-suspended"]
			}
		]
	}`
}

func transportProjectionFixtureWithDepartures(count int) string {
	var departures strings.Builder
	for index := 0; index < count; index++ {
		if index > 0 {
			departures.WriteString(",")
		}
		departureTime := fmt.Sprintf("%02d:%02d", 6+index/4, (index%4)*15)
		fmt.Fprintf(
			&departures,
			`{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":%q,"origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"}`,
			departureTime,
		)
	}
	return fmt.Sprintf(`{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		],
		"transport_routes":[
			{
				"route_id":"route:haidian-to-fengtai",
				"display_name":"海淀到丰台通勤车",
				"service_family":"intercampus_commute",
				"origin_campus":"haidian",
				"destination_campus":"fengtai",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门"},
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门"}
				]
			}
		],
		"scheduled_departures":[%s]
	}`, departures.String())
}

func serviceStatusProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆","海淀校区图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"override_source_refs":["notice:library-hours"],
				"related_notice_refs":["notice:library-hours"]
			}
		]
	}`
}

func incompleteServiceStatusProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00"
			}
		]
	}`
}

func serviceGuideProjectionFixture() string {
	return `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-04-25T10:00:00+08:00",
		"source_families":["handbook_service_navigation_projection_v1"],
		"service_guide_records":[
			{
				"service_id":"service:handbook:check-in",
				"display_name":"公寓楼新生办理入住手续流程",
				"aliases":["公寓楼新生办理入住手续流程","入住","住宿","宿舍"],
				"category":"student_housing",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:252-255#page=253"],
				"guide_sections":[
					{
						"section_id":"service:handbook:check-in:section:procedure",
						"section_type":"procedure",
						"title":"公寓楼新生办理入住手续流程",
						"content":"1. 持通知书到院系注册。\n2. 到指定公寓楼报到。",
						"order":1,
						"source_refs":["handbook:student_rules:pages:252-255#page=253"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["新生"],
				"extraction_status":"ready"
			},
			{
				"service_id":"service:handbook:undergrad-check-out",
				"display_name":"本科生特殊情况申请办理退宿手续",
				"aliases":["本科生特殊情况申请办理退宿手续","本科生退宿","退宿"],
				"category":"student_housing",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:252-255#page=255"],
				"guide_sections":[
					{
						"section_id":"service:handbook:undergrad-check-out:section:procedure",
						"section_type":"procedure",
						"title":"本科生特殊情况申请办理退宿手续",
						"content":"1. 写好退宿申请。",
						"order":1,
						"source_refs":["handbook:student_rules:pages:252-255#page=255"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["本科生"],
				"extraction_status":"ready"
			},
			{
				"service_id":"service:handbook:grad-check-out",
				"display_name":"研究生申请办理退宿手续",
				"aliases":["研究生申请办理退宿手续","研究生退宿","退宿"],
				"category":"student_housing",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:252-255#page=255"],
				"guide_sections":[
					{
						"section_id":"service:handbook:grad-check-out:section:procedure",
						"section_type":"procedure",
						"title":"研究生申请办理退宿手续",
						"content":"1. 写好退宿申请。",
						"order":1,
						"source_refs":["handbook:student_rules:pages:252-255#page=255"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["研究生"],
				"extraction_status":"ready"
			}
		],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
}

func serviceGuideManualReviewFixture() string {
	return strings.Replace(
		serviceGuideProjectionFixture(),
		`"extraction_status":"ready"`,
		`"extraction_status":"needs_manual_review"`,
		1,
	)
}
