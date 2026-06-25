package structuredquery

import (
	"context"
	"testing"
)

func TestLookupTransportScheduleUsesBaselineWhenOpsReleaseHasNoOverrides(t *testing.T) {
	runtime := NewRuntime(Options{
		CampusServicesOpsReleaseStore: &fakeCampusServicesOpsReleaseStore{
			release: campusServicesOpsRelease{
				ReleaseID:   "services-release-empty",
				PublishedAt: "2026-04-24T08:00:00+08:00",
				CurrentEffective: campusServicesOpsCurrentEffectiveSnapshot{
					GeneratedAt:        "2026-04-24T08:00:00+08:00",
					TransportOverrides: nil,
				},
			},
		},
		TransportScheduleReadModelStore: &fakeTransportScheduleReadModelStore{
			bundle: mustProjectionBundle(t, transportProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupTransportSchedule(context.Background(), []byte(`{
		"query_text":"今天去丰台有哪些班车",
		"intent":"departure_list",
		"route_selector":{"route_id":"route:haidian-to-fengtai"},
		"snapshot_query":{"mode":"current"},
		"service_time_query":{"date_mode":"today"}
	}`))

	result := response.Body.(transportScheduleResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ServiceStatus != "running" {
		t.Fatalf("service_status = %q, want running", result.ServiceStatus)
	}
	if len(result.DepartureOptions) == 0 {
		t.Fatal("departure_options is empty, want baseline departures")
	}
}
