//go:build postgres_integration

package postgres_test

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type schemaEvidence struct {
	GeneratedAt string `json:"generated_at"`
	Mode        string `json:"mode"`
	Passed      bool   `json:"passed"`
	SchemaReady bool   `json:"schema_ready"`
	Store       string `json:"store"`
}

func testSchemaCommand(t *testing.T, harness *postgresHarness) {
	_, databaseURL := harness.ownerDatabase(t)
	binaryPath := filepath.Join(t.TempDir(), "run-projection-schema")
	build := exec.CommandContext(t.Context(), "go", "build", "-o", binaryPath, "./cmd/run-projection-schema")
	build.Dir = harness.moduleDir
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build run-projection-schema: %v\n%s", err, output)
	}

	for index, mode := range []string{"install", "install", "check"} {
		evidencePath := filepath.Join(t.TempDir(), mode+"-evidence.json")
		command := exec.CommandContext(
			t.Context(),
			binaryPath,
			"--mode", mode,
			"--database-url", databaseURL,
			"--evidence-path", evidencePath,
		)
		command.Dir = harness.moduleDir
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("run schema command %s #%d: %v\n%s", mode, index+1, err, output)
		}
		raw, err := os.ReadFile(evidencePath)
		if err != nil {
			t.Fatalf("read schema evidence: %v", err)
		}
		var evidence schemaEvidence
		if err := json.Unmarshal(raw, &evidence); err != nil {
			t.Fatalf("decode schema evidence: %v", err)
		}
		if evidence.Mode != mode || !evidence.Passed || !evidence.SchemaReady ||
			evidence.Store != "postgres" || evidence.GeneratedAt == "" {
			t.Fatalf("schema evidence = %#v", evidence)
		}
	}
}

func testTransportScheduleReadModel(t *testing.T, harness *postgresHarness) {
	databaseName, ownerURL := harness.ownerDatabase(t)
	ownerConn := connect(t, ownerURL)
	defer closeConn(t, ownerConn)
	for _, relativePath := range []string{
		filepath.Join("..", "app-api", "db", "shared-product-schema", "campus_services.sql"),
		filepath.Join("..", "app-api", "db", "shared-product-schema", "testdata", "transport_integration.sql"),
	} {
		path := filepath.Clean(filepath.Join(harness.moduleDir, relativePath))
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read canonical transport SQL %s: %v", path, err)
		}
		if _, err := ownerConn.Exec(t.Context(), string(raw)); err != nil {
			t.Fatalf("apply canonical transport SQL %s: %v", path, err)
		}
	}
	if _, err := ownerConn.Exec(
		t.Context(),
		`revoke all on schema campus_services from public;
		revoke all on all tables in schema campus_services from public;
		grant usage on schema campus_services to execution_control;
		grant select on all tables in schema campus_services to execution_control;`,
	); err != nil {
		t.Fatalf("install execution-control transport read grants: %v", err)
	}

	runtimeURL := harness.databaseURL(t, databaseName, executionRole, executionPassword)
	store := toolreadmodel.NewPostgresTransportScheduleReadModelStore(
		toolreadmodel.TransportSchedulePostgresOptions{DatabaseURL: runtimeURL},
	)
	if store == nil {
		t.Fatal("PostgreSQL transport schedule store is nil")
	}
	if closer, ok := store.(interface{ Close() }); ok {
		t.Cleanup(closer.Close)
	}
	if err := store.HealthCheck(t.Context()); err != nil {
		t.Fatalf("transport store health check: %v", err)
	}
	releaseID, err := store.CurrentReleaseID(t.Context())
	if err != nil {
		t.Fatalf("current transport release: %v", err)
	}
	if releaseID != "transport:integration:2026-03-20" {
		t.Fatalf("release ID = %q", releaseID)
	}
	ready, err := store.ProjectionReady(t.Context())
	if err != nil || !ready {
		t.Fatalf("transport projection ready = %t, error = %v", ready, err)
	}
	bundle, err := store.LoadBundleForRelease(t.Context(), releaseID)
	if err != nil {
		t.Fatalf("load transport bundle: %v", err)
	}
	if len(bundle.TransportRoutes) != 1 || len(bundle.ScheduledDepartures) != 2 {
		t.Fatalf(
			"transport bundle rows = %d routes/%d departures, want 1/2",
			len(bundle.TransportRoutes),
			len(bundle.ScheduledDepartures),
		)
	}
	if serviceDates := bundle.ScheduledDepartures[1].ServiceDates; len(serviceDates) != 1 || serviceDates[0] != "2026-03-21" {
		t.Fatalf("temporary service dates = %#v", serviceDates)
	}

	runtime := toolreadmodel.NewRuntime(toolreadmodel.Options{
		TransportScheduleReadModelStore: store,
		TrustedTimeRFC3339:              "2026-03-21T07:00:00+08:00",
	})
	response := runtime.LookupTransportSchedule(t.Context(), []byte(`{
		"query_text":"current transport schedule version",
		"intent":"schedule_snapshot_metadata",
		"snapshot_query":{"mode":"current"}
	}`))
	if response.StatusCode != 200 || response.Outcome != "resolved_current" {
		t.Fatalf("transport tool response = %#v", response)
	}
}
