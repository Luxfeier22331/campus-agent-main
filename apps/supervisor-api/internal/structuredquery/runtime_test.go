package structuredquery

import (
	"context"
	"testing"
)

func TestLookupTransportScheduleReturnsCurrentSnapshotMetadata(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

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

func TestLookupTransportScheduleCurrentYearMissFailsClosedWithoutHistoricalDowngrade(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"2025 年校车时刻表是什么时候发布的",
		"intent":"schedule_snapshot_metadata",
		"snapshot_query":{"mode":"current_year","year_hint":"2025"}
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(transportScheduleResult)
	if !ok {
		t.Fatalf("body = %T, want transportScheduleResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "current_state_unverifiable" {
		t.Fatalf("fail_close_reason = %q, want current_state_unverifiable", result.FailCloseReason)
	}
	if result.ScheduleSnapshot != nil {
		t.Fatalf("schedule_snapshot = %#v, want nil", result.ScheduleSnapshot)
	}
}

func TestLookupTransportScheduleReadsPostgresReadModelWithoutProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			bundle: mustProjectionBundle(t, transportProjectionFixture()),
		},
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
	if result.SelectedDeparture == nil ||
		result.SelectedDeparture.DepartureAt != "2026-04-25T06:50:00+08:00" {
		t.Fatalf("selected_departure = %#v", result.SelectedDeparture)
	}
	status := runtime.Status(context.Background())
	if status.ProjectionSource != "postgres" || !status.TransportScheduleReadModelConfigured {
		t.Fatalf("status = %#v", status)
	}
}

func TestStatusUsesProjectionReadinessChecksWithoutLoadingBundles(t *testing.T) {
	serviceStatusStore := &fakeServiceStatusReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	transportStore := &fakeTransportScheduleReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	serviceGuideStore := &fakeServiceGuideReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	contactDirectoryStore := &fakeContactDirectoryReadModelStore{
		projectionReadySet: true,
		projectionReady:    true,
	}
	runtime := NewRuntime(Options{
		ServiceStatusReadModelStore:     serviceStatusStore,
		TransportScheduleReadModelStore: transportStore,
		ServiceGuideReadModelStore:      serviceGuideStore,
		ContactDirectoryReadModelStore:  contactDirectoryStore,
	})

	status := runtime.Status(context.Background())

	if !status.ServiceStatusProjectionReady {
		t.Fatal("service status projection must be ready")
	}
	if !status.TransportScheduleImplemented {
		t.Fatal("transport schedule projection must be ready")
	}
	if !status.ServiceGuideProjectionReady {
		t.Fatal("service guide projection must be ready")
	}
	if !status.ContactDirectoryProjectionReady {
		t.Fatal("contact directory projection must be ready")
	}
	if serviceStatusStore.loadCount != 0 {
		t.Fatalf("service status load count = %d, want 0", serviceStatusStore.loadCount)
	}
	if transportStore.loadCount != 0 {
		t.Fatalf("transport load count = %d, want 0", transportStore.loadCount)
	}
	if serviceGuideStore.loadCount != 0 {
		t.Fatalf("service guide load count = %d, want 0", serviceGuideStore.loadCount)
	}
	if contactDirectoryStore.loadCount != 0 {
		t.Fatalf("contact directory load count = %d, want 0", contactDirectoryStore.loadCount)
	}
}

func TestLookupTransportScheduleCachesReadModelBundleUntilReleaseChanges(t *testing.T) {
	store := &fakeTransportScheduleReadModelStore{
		releaseID: "transport-release-1",
		bundle:    mustProjectionBundle(t, transportProjectionFixture()),
	}
	runtime := NewRuntime(Options{
		TransportScheduleReadModelStore: store,
		TrustedTimeRFC3339:              "2026-04-24T20:30:00+08:00",
	})
	requestBody := []byte(`{
		"query_text":"我明天早上要去丰台上课，最早的班车是几点",
		"intent":"first_departure",
		"route_selector":{"destination_campus":"fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"tomorrow","daypart":"morning"}
	}`)

	first := runtime.LookupTransportSchedule(context.Background(), requestBody)
	second := runtime.LookupTransportSchedule(context.Background(), requestBody)

	if first.Outcome != "resolved_current" || second.Outcome != "resolved_current" {
		t.Fatalf("outcomes = %q/%q, want resolved_current", first.Outcome, second.Outcome)
	}
	if store.loadCount != 1 {
		t.Fatalf("load count = %d, want one bundle load for unchanged release", store.loadCount)
	}

	store.releaseID = "transport-release-2"
	store.bundle = mustProjectionBundle(t, transportProjectionFixtureWithTemporaryOverlay())
	runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"3月2日丰台回海淀最早的班车是几点",
		"intent":"first_departure",
		"route_selector":{"route_id":"route:fengtai-to-haidian"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"date","service_date":"2026-03-02","daypart":"morning"}
	}`))

	if store.loadCount != 2 {
		t.Fatalf("load count after release change = %d, want cache invalidation", store.loadCount)
	}
}

func TestLookupTransportScheduleClarifiesMissingRouteSelector(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

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
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T20:30:00+08:00",
	)

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

func TestLookupTransportScheduleResolvesDirectionFromOriginAndDestinationStops(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T16:45:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"海淀东门到丰台南门下一班车几点",
		"intent":"next_departure",
		"route_selector":{"origin_stop_query":"海淀东门","destination_stop_query":"丰台南门"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedRoute == nil || result.ResolvedRoute.RouteID != "route:haidian-to-fengtai" {
		t.Fatalf("resolved_route = %#v", result.ResolvedRoute)
	}
	if result.SelectedDeparture == nil ||
		result.SelectedDeparture.DepartureAt != "2026-04-24T17:10:00+08:00" {
		t.Fatalf("selected_departure = %#v", result.SelectedDeparture)
	}
}

func TestLookupTransportScheduleNextDepartureAfterLastBusReturnsNotFoundWithSnapshot(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T20:30:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天去丰台下一班车几点",
		"intent":"next_departure",
		"route_selector":{"route_id":"route:haidian-to-fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "not_found" {
		t.Fatalf("outcome = %q, want not_found", result.Outcome)
	}
	if result.ServiceStatus != "not_running" {
		t.Fatalf("service_status = %q, want not_running", result.ServiceStatus)
	}
	if result.SelectedDeparture != nil {
		t.Fatalf("selected_departure = %#v, want nil", result.SelectedDeparture)
	}
	if result.ScheduleSnapshot == nil ||
		result.ScheduleSnapshot.SnapshotID != "snapshot:bus:2026-04-20" {
		t.Fatalf("schedule_snapshot = %#v", result.ScheduleSnapshot)
	}
}

func TestLookupTransportScheduleFailsClosedOutsideProjectedServiceWindow(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"4月26日去丰台最早一班车几点",
		"intent":"first_departure",
		"route_selector":{"route_id":"route:haidian-to-fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"date","service_date":"2026-04-26","daypart":"morning"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "current_state_unverifiable" {
		t.Fatalf("fail_close_reason = %q, want current_state_unverifiable", result.FailCloseReason)
	}
}

func TestLookupTransportScheduleReturnsNotFoundInsideExplicitNoServiceDateRange(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixtureWithExplicitNoServiceDateRange(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"4月26日去丰台最早一班车几点",
		"intent":"first_departure",
		"route_selector":{"route_id":"route:haidian-to-fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"date","service_date":"2026-04-26","daypart":"morning"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "not_found" {
		t.Fatalf("outcome = %q, want not_found", result.Outcome)
	}
	if result.ServiceStatus != "not_running" {
		t.Fatalf("service_status = %q, want not_running", result.ServiceStatus)
	}
	if result.ScheduleSnapshot == nil ||
		result.ScheduleSnapshot.SnapshotID != "snapshot:bus:2026-04-20" {
		t.Fatalf("schedule_snapshot = %#v", result.ScheduleSnapshot)
	}
}

func TestLookupTransportScheduleListsDeparturesAfterTimeWithLimit(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T16:45:00+08:00",
	)

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
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixtureWithDepartures(25),
		"2026-04-24T05:00:00+08:00",
	)

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
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

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

func TestLookupTransportScheduleFailsClosedOnConflictingServiceExceptions(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixtureWithConflictingExceptions(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天地铁接驳车是不是停运了",
		"intent":"service_window",
		"route_selector":{"service_family":"subway_shuttle"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_conflict" {
		t.Fatalf("fail_close_reason = %q, want source_conflict", result.FailCloseReason)
	}
}

func TestLookupTransportScheduleMergesDuplicateServiceExceptionRefs(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixtureWithDuplicateExceptions(),
		"2026-04-24T10:30:00+08:00",
	)

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
	if len(result.RelatedNoticeRefs) != 2 ||
		result.RelatedNoticeRefs[0] != "notice:muc_internal_portal:metro-suspended-a" ||
		result.RelatedNoticeRefs[1] != "notice:muc_internal_portal:metro-suspended-b" {
		t.Fatalf("related_notice_refs = %#v", result.RelatedNoticeRefs)
	}
}

func TestLookupTransportScheduleIncludesOperationalNoticeForRoute(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixtureWithOperationalNotice(),
		"2026-01-02T10:30:00+08:00",
	)

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天丰台回海淀班车怎么坐",
		"intent":"service_window",
		"route_selector":{"route_id":"route:fengtai-to-haidian"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"}
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result := response.Body.(transportScheduleResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.OperationalNotices) != 1 {
		t.Fatalf("operational_notices = %#v", result.OperationalNotices)
	}
	notice := result.OperationalNotices[0]
	if notice.NoticeKind != "boarding_point_change" {
		t.Fatalf("notice_kind = %q", notice.NoticeKind)
	}
	if notice.OperationalComment != "通勤班车丰台校区乘车点调整至南门外停车区" {
		t.Fatalf("operational_comment = %q", notice.OperationalComment)
	}
	if len(result.RelatedNoticeRefs) != 1 ||
		result.RelatedNoticeRefs[0] != "notice:muc_internal_portal:353903" {
		t.Fatalf("related_notice_refs = %#v", result.RelatedNoticeRefs)
	}
}

func TestLookupTransportScheduleSelectsTemporaryOverlayByRequestedServiceDate(t *testing.T) {
	runtime := newRuntimeWithTransportReadModel(
		t,
		transportProjectionFixtureWithTemporaryOverlay(),
		"2026-03-05T10:30:00+08:00",
	)

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
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"海淀校区图书馆今天开门吗",
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
}

func TestLookupServiceStatusReadsPostgresReadModelWithoutProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		ServiceStatusReadModelStore: &fakeServiceStatusReadModelStore{
			bundle: mustProjectionBundle(t, serviceStatusProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"海淀校区图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedSubject != "海淀校区图书馆" {
		t.Fatalf("resolved_subject = %q", result.ResolvedSubject)
	}
	if result.StatusNote != "工作日开放，节假日另行通知" {
		t.Fatalf("status_note = %q", result.StatusNote)
	}
	status := runtime.Status(context.Background())
	if status.ProjectionSource != "postgres" || !status.ServiceStatusReadModelConfigured {
		t.Fatalf("status = %#v", status)
	}
}

func TestLookupServiceStatusSelectsNarrowTemporaryOverride(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithTemporaryOverride(),
		"2026-04-24T13:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ObservedStatus != "temporarily_closed" {
		t.Fatalf("observed_status = %q, want temporarily_closed", result.ObservedStatus)
	}
	if result.StatusNote != "13:00-18:00 因活动临时闭馆" {
		t.Fatalf("status_note = %q", result.StatusNote)
	}
	if result.EffectiveFrom != "2026-04-24T13:00:00+08:00" {
		t.Fatalf("effective_from = %q", result.EffectiveFrom)
	}
	if len(result.OverrideSourceRefs) != 1 ||
		result.OverrideSourceRefs[0] != "notice:library-temporary-close" {
		t.Fatalf("override_source_refs = %#v", result.OverrideSourceRefs)
	}
}

func TestLookupServiceStatusFailsClosedOnConflictingCurrentRecords(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithConflictingCurrentRecords(),
		"2026-04-24T13:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"海淀校区图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_conflict" {
		t.Fatalf("fail_close_reason = %q, want source_conflict", result.FailCloseReason)
	}
}

func TestLookupServiceStatusFailsClosedWhenMatchedRecordIsIncomplete(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		incompleteServiceStatusProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

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

func TestLookupServiceStatusRejectsUnknownSourceObservedStatus(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithUnknownSourceStatus(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.ObservedStatus != "unknown" {
		t.Fatalf("observed_status = %q, want fail-close unknown", result.ObservedStatus)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceStatusMatchesPlatformRefs(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithPlatformRefs(),
		"2026-04-28T02:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"信息门户现在能用吗",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedSubject != "统一身份认证平台" {
		t.Fatalf("resolved_subject = %q", result.ResolvedSubject)
	}
	if result.ObservedStatus != "temporarily_closed" {
		t.Fatalf("observed_status = %q, want temporarily_closed", result.ObservedStatus)
	}
}

func TestLookupServiceStatusRequiresClarificationForAmbiguousCampusSubjects(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithAmbiguousCampusSubjects(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.FailCloseReason != "" {
		t.Fatalf("fail_close_reason = %q, want empty", result.FailCloseReason)
	}
}
