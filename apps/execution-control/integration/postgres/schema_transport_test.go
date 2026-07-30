//go:build postgres_integration

package postgres_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
	"github.com/jackc/pgx/v5/pgconn"
)

type schemaEvidence struct {
	GeneratedAt string `json:"generated_at"`
	Mode        string `json:"mode"`
	Passed      bool   `json:"passed"`
	SchemaReady bool   `json:"schema_ready"`
	Store       string `json:"store"`
}

func testSchemaCommand(t *testing.T, harness *postgresHarness) {
	databaseName, databaseURL := harness.ownerDatabase(t)
	ownerConn := connect(t, databaseURL)
	if _, err := ownerConn.Exec(t.Context(), `
		create schema runtime;
		create table runtime.request_observability_fact (request_id text primary key);
		revoke all privileges on table runtime.request_observability_fact from execution_control;
	`); err != nil {
		closeConn(t, ownerConn)
		t.Fatalf("install app-api runtime fact fixture: %v", err)
	}
	closeConn(t, ownerConn)

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

	runtimeURL := harness.databaseURL(t, databaseName, executionRole, executionPassword)
	runtimeStore := newRunProjectionStore(t, runtimeURL, false)
	if err := runtimeStore.HealthCheck(t.Context()); err != nil {
		t.Fatalf("runtime run projection health check: %v", err)
	}
	memoryStore, err := memoryruntime.NewPostgresStateStore(
		t.Context(),
		memoryruntime.PostgresStateStoreOptions{DatabaseURL: runtimeURL},
	)
	if err != nil {
		t.Fatalf("create runtime personal memory state store: %v", err)
	}
	t.Cleanup(memoryStore.Close)
	if err := memoryStore.HealthCheck(t.Context()); err != nil {
		t.Fatalf("runtime personal memory state health check: %v", err)
	}
	assertExecutionControlRuntimeAccess(t, runtimeURL)

	ownerConn = connect(t, databaseURL)
	if _, err := ownerConn.Exec(
		t.Context(),
		"revoke select on table runtime.agent_runs from execution_control",
	); err != nil {
		closeConn(t, ownerConn)
		t.Fatalf("remove required runtime grant: %v", err)
	}
	closeConn(t, ownerConn)
	failedEvidencePath := filepath.Join(t.TempDir(), "missing-grant-evidence.json")
	command := exec.CommandContext(
		t.Context(),
		binaryPath,
		"--mode", "check",
		"--database-url", databaseURL,
		"--evidence-path", failedEvidencePath,
	)
	command.Dir = harness.moduleDir
	if output, err := command.CombinedOutput(); err == nil {
		t.Fatalf("schema check succeeded without required runtime grant: %s", output)
	}
	if _, err := os.Stat(failedEvidencePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed schema check evidence stat error = %v, want not exist", err)
	}
}

func assertExecutionControlRuntimeAccess(t *testing.T, runtimeURL string) {
	t.Helper()
	conn := connect(t, runtimeURL)
	defer closeConn(t, conn)

	tables := []struct {
		name         string
		updateColumn string
	}{
		{name: "runtime.agent_runs", updateColumn: "run_id"},
		{name: "runtime.agent_run_events", updateColumn: "event_id"},
		{name: "runtime.agent_run_steps", updateColumn: "step_id"},
		{name: "runtime.agent_step_attempts", updateColumn: "attempt_id"},
		{name: "runtime.agent_step_results", updateColumn: "result_id"},
		{name: "runtime.conversation_run_locks", updateColumn: "conversation_id"},
		{name: "runtime.agent_workflow_starts", updateColumn: "run_id"},
		{name: "runtime.agent_run_cancellations", updateColumn: "run_id"},
		{name: "runtime.agent_run_cleanups", updateColumn: "run_id"},
		{name: "runtime.agent_invocation_receipts", updateColumn: "invocation_id"},
		{name: "runtime.personal_memory_owner_fences", updateColumn: "owner_scope_hash"},
		{name: "runtime.personal_memory_call_leases", updateColumn: "call_id"},
		{name: "runtime.personal_memory_command_receipts", updateColumn: "command_id"},
	}
	for _, table := range tables {
		statements := []string{
			"select 1 from " + table.name + " limit 0",
			"insert into " + table.name + " select * from " + table.name + " where false",
			fmt.Sprintf("update %s set %s=%s where false", table.name, table.updateColumn, table.updateColumn),
			"delete from " + table.name + " where false",
		}
		for _, statement := range statements {
			if _, err := conn.Exec(t.Context(), statement); err != nil {
				t.Fatalf("runtime statement %q: %v", statement, err)
			}
		}
	}

	_, err := conn.Exec(t.Context(), "select 1 from runtime.request_observability_fact limit 0")
	var postgresError *pgconn.PgError
	if !errors.As(err, &postgresError) || postgresError.Code != "42501" {
		t.Fatalf("request observability fact access error = %v, want SQLSTATE 42501", err)
	}

	for _, statement := range []string{
		"create table runtime.execution_control_must_not_create (id text)",
		"truncate table runtime.personal_memory_call_leases",
	} {
		_, err := conn.Exec(t.Context(), statement)
		postgresError = nil
		if !errors.As(err, &postgresError) || postgresError.Code != "42501" {
			t.Fatalf("forbidden runtime statement %q error = %v, want SQLSTATE 42501", statement, err)
		}
	}

	if err := runtimeStoreCRUD(t, runtimeURL); err != nil {
		t.Fatalf("runtime store CRUD: %v", err)
	}
}

func runtimeStoreCRUD(t *testing.T, runtimeURL string) error {
	t.Helper()
	store, err := execution.NewPostgresRunProjectionStore(
		t.Context(),
		execution.PostgresRunProjectionStoreOptions{DatabaseURL: runtimeURL},
	)
	if err != nil {
		return err
	}
	defer store.Close()
	now := time.Date(2026, 7, 30, 8, 0, 0, 0, time.UTC)
	run := durableRun("run-runtime-role-crud", "conversation-runtime-role-crud", now)
	if _, err := store.CreateRun(t.Context(), run); err != nil {
		return err
	}
	if err := store.ReplaceRunMetadata(t.Context(), run.RunID, run.Metadata); err != nil {
		return err
	}
	return store.DeleteRun(t.Context(), run.RunID)
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
