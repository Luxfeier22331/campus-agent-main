package toolreadmodel

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestPostgresTransportScheduleReadModelIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(
		os.Getenv("EXECUTION_CONTROL_TRANSPORT_SCHEDULE_TEST_DATABASE_URL"),
	)
	if databaseURL == "" {
		t.Skip("EXECUTION_CONTROL_TRANSPORT_SCHEDULE_TEST_DATABASE_URL is not configured")
	}

	store := NewPostgresTransportScheduleReadModelStore(TransportSchedulePostgresOptions{
		DatabaseURL: databaseURL,
	})
	if store == nil {
		t.Fatal("PostgreSQL transport schedule store is nil")
	}
	if closer, ok := store.(interface{ Close() }); ok {
		t.Cleanup(closer.Close)
	}

	ctx := context.Background()
	if err := store.HealthCheck(ctx); err != nil {
		t.Fatalf("health check failed: %v", err)
	}
	releaseID, err := store.CurrentReleaseID(ctx)
	if err != nil {
		t.Fatalf("current release lookup failed: %v", err)
	}
	if releaseID != "transport:integration:2026-03-20" {
		t.Fatalf("release id = %q, want transport:integration:2026-03-20", releaseID)
	}
	ready, err := store.ProjectionReady(ctx)
	if err != nil {
		t.Fatalf("projection readiness failed: %v", err)
	}
	if !ready {
		t.Fatal("transport schedule projection is not ready")
	}

	bundle, err := store.LoadBundleForRelease(ctx, releaseID)
	if err != nil {
		t.Fatalf("bundle load failed: %v", err)
	}
	if len(bundle.TransportRoutes) != 1 || len(bundle.ScheduledDepartures) != 2 {
		t.Fatalf(
			"bundle rows = %d routes/%d departures, want 1/2",
			len(bundle.TransportRoutes),
			len(bundle.ScheduledDepartures),
		)
	}
	if serviceDates := bundle.ScheduledDepartures[1].ServiceDates; len(serviceDates) != 1 ||
		serviceDates[0] != "2026-03-21" {
		t.Fatalf("temporary service dates = %#v, want [2026-03-21]", serviceDates)
	}

	runtime := NewRuntime(Options{
		TransportScheduleReadModelStore: store,
		TrustedTimeRFC3339:              "2026-03-21T07:00:00+08:00",
	})
	response := runtime.LookupTransportSchedule(ctx, []byte(`{
		"query_text":"当前班车时刻表是什么版本",
		"intent":"schedule_snapshot_metadata",
		"snapshot_query":{"mode":"current"}
	}`))
	if response.StatusCode != 200 || response.Outcome != "resolved_current" {
		t.Fatalf("tool response = %#v, want resolved_current", response)
	}
}
