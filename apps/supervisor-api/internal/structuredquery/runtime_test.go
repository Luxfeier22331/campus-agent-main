package structuredquery

import (
	"context"
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

func TestLookupTransportScheduleSelectsTemporaryOverlayByRequestedServiceDate(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, transportProjectionFixtureWithTemporaryOverlay()),
		TrustedTimeRFC3339: "2026-03-05T10:30:00+08:00",
	})

	temporaryResponse := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"2月24日丰台回海淀最早的班车是几点",
		"intent":"first_departure",
		"route_selector":{"route_id":"route:fengtai-to-haidian"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"date","service_date":"2026-02-24","daypart":"morning"}
	}`))

	temporaryResult := temporaryResponse.Body.(transportScheduleResult)
	if temporaryResult.Outcome != "resolved_current" {
		t.Fatalf("temporary outcome = %q, want resolved_current", temporaryResult.Outcome)
	}
	if temporaryResult.ScheduleSnapshot == nil ||
		temporaryResult.ScheduleSnapshot.SnapshotID != "snapshot:transport-schedule:2026-01-21:354578" {
		t.Fatalf("temporary schedule snapshot = %#v", temporaryResult.ScheduleSnapshot)
	}
	if temporaryResult.SelectedDeparture == nil ||
		temporaryResult.SelectedDeparture.DepartureAt != "2026-02-24T07:30:00+08:00" {
		t.Fatalf("temporary selected_departure = %#v", temporaryResult.SelectedDeparture)
	}

	baselineResponse := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"3月2日丰台回海淀最早的班车是几点",
		"intent":"first_departure",
		"route_selector":{"route_id":"route:fengtai-to-haidian"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"date","service_date":"2026-03-02","daypart":"morning"}
	}`))

	baselineResult := baselineResponse.Body.(transportScheduleResult)
	if baselineResult.Outcome != "resolved_current" {
		t.Fatalf("baseline outcome = %q, want resolved_current", baselineResult.Outcome)
	}
	if baselineResult.ScheduleSnapshot == nil ||
		baselineResult.ScheduleSnapshot.SnapshotID != "snapshot:transport-schedule:2026-03-02:baseline" {
		t.Fatalf("baseline schedule snapshot = %#v", baselineResult.ScheduleSnapshot)
	}
	if baselineResult.SelectedDeparture == nil ||
		baselineResult.SelectedDeparture.DepartureAt != "2026-03-02T06:50:00+08:00" {
		t.Fatalf("baseline selected_departure = %#v", baselineResult.SelectedDeparture)
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

func TestLookupServiceGuideReturnsPublicMedicalRequiredMaterials(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuidePublicMedicalProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销需要什么材料",
		"guide_focus":"required_materials",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.DisplayName != "公费医疗报销办理指南" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	materialNames := map[string]bool{}
	for _, material := range result.RequiredMaterials {
		materialNames[material.Name] = true
	}
	for _, name := range []string{"急诊证明", "住院收据", "住院费明细单", "出院手续"} {
		if !materialNames[name] {
			t.Fatalf("required_materials missing %q: %#v", name, result.RequiredMaterials)
		}
	}
	if len(result.SourceRefs) == 0 || result.SourceRefs[0] != "handbook:student_rules:pages:259-260#page=259" {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupServiceGuideUsesDedicatedProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath: writeTransportProjectionFixture(t, transportProjectionFixture()),
		ServiceGuideProjectionPath: writeTransportProjectionFixture(
			t,
			serviceGuidePublicMedicalProjectionFixture(),
		),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销需要什么材料",
		"guide_focus":"required_materials",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.DisplayName != "公费医疗报销办理指南" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
}

func TestLookupServiceGuideFailsClosedForManualReviewSource(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuideManualReviewSourceFixture()),
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

func TestLookupServiceGuideRejectsInvalidTemporalQuery(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuideProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current_year"},
		"audience":"student"
	}`))

	if response.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
	if response.Outcome != "invalid_request" {
		t.Fatalf("outcome = %q, want invalid_request", response.Outcome)
	}
}

func TestLookupServiceGuideFailsClosedWhenRequestedFocusIsNotBackedBySource(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuidePublicMedicalProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销联系电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceGuideIncludesContactSourceRefs(t *testing.T) {
	runtime := NewRuntime(Options{
		ProjectionPath:     writeTransportProjectionFixture(t, serviceGuideContactProjectionFixture()),
		TrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销联系电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.ContactRefs) != 1 || result.ContactRefs[0].Phone != "68930000" {
		t.Fatalf("contact_refs = %#v", result.ContactRefs)
	}
	if !testStringSliceContains(result.SourceRefs, "handbook:student_rules:pages:261-261#page=261") {
		t.Fatalf("source_refs = %#v, want contact source ref", result.SourceRefs)
	}
}
