package structuredquery

import (
	"context"
	"os"
	"path/filepath"
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
