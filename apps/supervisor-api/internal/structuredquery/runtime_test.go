package structuredquery

import (
	"context"
	"encoding/json"
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

func TestLookupServiceStatusReadsPostgresReadModelWithoutProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		ServiceStatusReadModelStore: &fakeServiceStatusReadModelStore{
			bundle: mustProjectionBundle(t, serviceStatusProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
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
	status := runtime.Status(context.Background())
	if status.ProjectionSource != "postgres" || !status.ServiceStatusReadModelConfigured {
		t.Fatalf("status = %#v", status)
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

func newRuntimeWithTransportReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

func newRuntimeWithServiceStatusReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		ServiceStatusReadModelStore: &fakeServiceStatusReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

type fakeTransportScheduleReadModelStore struct {
	releaseID string
	bundle    projectionBundle
	loadCount int
}

func (s fakeTransportScheduleReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeTransportScheduleReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "transport-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeTransportScheduleReadModelStore) LoadBundleForRelease(
	_ context.Context,
	_ string,
) (projectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}

type fakeServiceStatusReadModelStore struct {
	releaseID string
	bundle    projectionBundle
	loadCount int
}

func (s fakeServiceStatusReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeServiceStatusReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "service-status-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeServiceStatusReadModelStore) LoadBundleForRelease(
	context.Context,
	string,
) (projectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}

func mustProjectionBundle(t *testing.T, payload string) projectionBundle {
	t.Helper()
	var bundle projectionBundle
	if err := json.Unmarshal([]byte(payload), &bundle); err != nil {
		t.Fatalf("decode projection bundle: %v", err)
	}
	return bundle
}
