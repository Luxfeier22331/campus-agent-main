package structuredquery

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestTransportStatusProjectionReturnsCurrentEffectiveTimetable(t *testing.T) {
	runtime := NewRuntime(Options{
		CampusServicesOpsReleaseStore: &fakeCampusServicesOpsReleaseStore{
			release: campusServicesOpsRelease{
				ReleaseID:   "services_release_current",
				PublishedAt: "2026-04-24T09:00:00+08:00",
				CurrentEffective: campusServicesOpsCurrentEffectiveSnapshot{
					GeneratedAt: "2026-04-24T09:00:00+08:00",
					TransportOverrides: []campusServicesOpsTransportOverride{
						{
							OverrideID:           "services_transport_override_1",
							RouteID:              "route:haidian-to-fengtai",
							DisplayName:          "海淀到丰台通勤车",
							ServiceStatus:        "suspended",
							Message:              "今天 10:00-12:00 因临时管制暂停发车",
							EffectiveFrom:        "2026-04-24T10:00:00+08:00",
							EffectiveUntil:       "2026-04-24T12:00:00+08:00",
							SourceAttestationIDs: []string{"services_attestation_bus_1"},
							ReviewState:          "ready_for_publish",
						},
					},
				},
			},
		},
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			releaseID: "transport-release-current",
			bundle:    mustProjectionBundle(t, transportStatusProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.TransportStatusProjection(context.Background())

	if response.StatusCode != 200 || response.Outcome != "resolved_current" {
		t.Fatalf("response = %#v, want 200 resolved_current", response)
	}
	projection, ok := response.Body.(TransportStatusProjection)
	if !ok {
		t.Fatalf("body = %T, want TransportStatusProjection", response.Body)
	}
	if projection.Release.ReleaseID != "transport-release-current" {
		t.Fatalf("release_id = %q", projection.Release.ReleaseID)
	}
	if projection.Release.PublishedAt != "2026-04-20T18:00:00+08:00" {
		t.Fatalf("published_at = %q", projection.Release.PublishedAt)
	}
	wantReleaseRefs := []string{"https://portal.muc.edu.cn/notice/123"}
	if !reflect.DeepEqual(projection.Release.SourceRefs, wantReleaseRefs) {
		t.Fatalf("release.source_refs = %#v, want %#v", projection.Release.SourceRefs, wantReleaseRefs)
	}
	if len(projection.Groups) != 1 || projection.Groups[0].Kind != "daily" {
		t.Fatalf("groups = %#v, want one daily group", projection.Groups)
	}
	routes := projection.Groups[0].Routes
	if len(routes) != 2 {
		t.Fatalf("routes = %#v, want two routes with current service rows", routes)
	}
	first := routes[0]
	if first.RouteID != "route:haidian-to-fengtai" || first.DisplayName != "海淀到丰台通勤车" {
		t.Fatalf("first route = %#v", first)
	}
	if len(first.Departures) != 3 {
		t.Fatalf("departures = %#v, want route current day rows", first.Departures)
	}
	if first.Departures[0].DepartureTime != "16:40" ||
		first.Departures[0].Kind != "other" ||
		first.Departures[0].Status != "cancelled" ||
		first.Departures[0].Note != "今天 10:00-12:00 因临时管制暂停发车" {
		t.Fatalf("first departure = %#v", first.Departures[0])
	}
	wantOverrideRefs := []string{"https://portal.muc.edu.cn/notice/123"}
	if !reflect.DeepEqual(first.Departures[0].SourceRefs, wantOverrideRefs) {
		t.Fatalf("override source_refs = %#v, want %#v", first.Departures[0].SourceRefs, wantOverrideRefs)
	}
}

func transportStatusProjectionFixture() string {
	return strings.ReplaceAll(
		strings.ReplaceAll(
			transportProjectionFixture(),
			"notice:bus-schedule-2026-04-20",
			"https://portal.muc.edu.cn/notice/123",
		),
		"notice:metro-shuttle-suspended",
		"https://portal.muc.edu.cn/notice/metro-shuttle-suspended",
	)
}

func TestTransportStatusProjectionFailsClosedWhenCurrentReleaseUnavailable(t *testing.T) {
	runtime := NewRuntime(Options{
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			releaseID: "",
			bundle:    projectionBundle{},
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.TransportStatusProjection(context.Background())

	if response.StatusCode != 503 {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	body, ok := response.Body.(map[string]any)
	if !ok {
		t.Fatalf("body = %T, want error map", response.Body)
	}
	errorBody, ok := body["error"].(map[string]any)
	if !ok || errorBody["code"] != "source_truth_unavailable" {
		t.Fatalf("error = %#v", body["error"])
	}
}
