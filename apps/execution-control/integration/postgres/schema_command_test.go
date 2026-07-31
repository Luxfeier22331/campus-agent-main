//go:build postgres_integration

package postgres_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
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
	binaryPath := buildSchemaCommand(t, harness)
	t.Run("allows an empty execution-control schema", func(t *testing.T) {
		testSchemaCommandAllowsEmptyExecutionSchema(t, harness, binaryPath)
	})
	t.Run("migrates the complete legacy runtime schema", func(t *testing.T) {
		databaseName, databaseURL := harness.ownerDatabase(t)
		installAppAPIRuntimeFact(t, databaseURL)
		installLegacyRuntimeSchema(t, harness, databaseURL, true)

		requireSuccessfulSchemaCommand(t, harness, binaryPath, databaseURL, "install")
		requireSuccessfulSchemaCommand(t, harness, binaryPath, databaseURL, "check")
		assertLegacyCleanupTableRemoved(t, databaseURL)
		assertAppliedExecutionControlMigrations(t, databaseURL)

		runtimeURL := harness.databaseURL(t, databaseName, executionRole, executionPassword)
		assertExecutionControlRuntimeAccess(t, runtimeURL)
	})
	t.Run("migrates the complete legacy core without personal memory tables", func(t *testing.T) {
		_, databaseURL := harness.ownerDatabase(t)
		installAppAPIRuntimeFact(t, databaseURL)
		installLegacyRuntimeSchema(t, harness, databaseURL, false)

		requireSuccessfulSchemaCommand(t, harness, binaryPath, databaseURL, "install")
		requireSuccessfulSchemaCommand(t, harness, binaryPath, databaseURL, "check")
		assertLegacyCleanupTableRemoved(t, databaseURL)
		assertAppliedExecutionControlMigrations(t, databaseURL)
	})
	t.Run("rejects incomplete and unknown runtime schemas before creating a ledger", func(t *testing.T) {
		testSchemaCommandRejectsUnknownRuntimeSchema(t, harness, binaryPath)
	})
}

func buildSchemaCommand(t *testing.T, harness *postgresHarness) string {
	t.Helper()
	binaryPath := filepath.Join(t.TempDir(), "run-projection-schema")
	build := exec.CommandContext(t.Context(), "go", "build", "-o", binaryPath, "./cmd/run-projection-schema")
	build.Dir = harness.moduleDir
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build run-projection-schema: %v\n%s", err, output)
	}
	return binaryPath
}

func testSchemaCommandAllowsEmptyExecutionSchema(t *testing.T, harness *postgresHarness, binaryPath string) {
	databaseName, databaseURL := harness.ownerDatabase(t)
	installAppAPIRuntimeFact(t, databaseURL)

	pendingEvidencePath := filepath.Join(t.TempDir(), "pending-evidence.json")
	if output, err := runSchemaCommand(t, harness, binaryPath, databaseURL, "check", pendingEvidencePath); err == nil {
		t.Fatalf("schema check succeeded with pending migrations: %s", output)
	} else if !strings.Contains(string(output), "schema migrations are pending") {
		t.Fatalf("pending schema check output = %s", output)
	}
	if _, err := os.Stat(pendingEvidencePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("pending schema check evidence stat error = %v, want not exist", err)
	}

	for _, mode := range []string{"install", "install", "check"} {
		requireSuccessfulSchemaCommand(t, harness, binaryPath, databaseURL, mode)
	}
	assertAppliedExecutionControlMigrations(t, databaseURL)

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

	ownerConn := connect(t, databaseURL)
	if _, err := ownerConn.Exec(
		t.Context(),
		"revoke select on table runtime.agent_runs from execution_control",
	); err != nil {
		closeConn(t, ownerConn)
		t.Fatalf("remove required runtime grant: %v", err)
	}
	closeConn(t, ownerConn)
	failedEvidencePath := filepath.Join(t.TempDir(), "missing-grant-evidence.json")
	if output, err := runSchemaCommand(t, harness, binaryPath, databaseURL, "check", failedEvidencePath); err == nil {
		t.Fatalf("schema check succeeded without required runtime grant: %s", output)
	}
	if _, err := os.Stat(failedEvidencePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed schema check evidence stat error = %v, want not exist", err)
	}
}

func installAppAPIRuntimeFact(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	if _, err := conn.Exec(t.Context(), `
		create schema runtime;
		create table runtime.request_observability_fact (request_id text primary key);
		revoke all privileges on table runtime.request_observability_fact from execution_control;
	`); err != nil {
		t.Fatalf("install app-api runtime fact fixture: %v", err)
	}
}

func installLegacyRuntimeSchema(t *testing.T, harness *postgresHarness, databaseURL string, includePersonalMemory bool) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	migrations := []string{"00001_runtime_projection.sql"}
	if includePersonalMemory {
		migrations = append(migrations, "00002_personal_memory.sql")
	}
	for _, migration := range migrations {
		path := filepath.Join(harness.moduleDir, "internal", "schemamigrations", "migrations", migration)
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read legacy runtime migration fixture %s: %v", migration, err)
		}
		if _, err := conn.Exec(t.Context(), string(raw)); err != nil {
			t.Fatalf("install legacy runtime migration fixture %s: %v", migration, err)
		}
	}
	if _, err := conn.Exec(t.Context(), `
		create table runtime.agent_run_cleanups (
			run_id text primary key references runtime.agent_runs(run_id) on delete cascade,
			state text not null,
			attempt_count integer not null default 0,
			next_attempt_at timestamptz not null,
			lease_token text not null default '',
			lease_until timestamptz,
			last_error_code text not null default '',
			created_at timestamptz not null,
			confirmed_at timestamptz,
			updated_at timestamptz not null
		);
		create index agent_run_cleanups_lease_idx
			on runtime.agent_run_cleanups (state, next_attempt_at, lease_until);
	`); err != nil {
		t.Fatalf("install legacy runtime cleanup fixture: %v", err)
	}
}

func testSchemaCommandRejectsUnknownRuntimeSchema(t *testing.T, harness *postgresHarness, binaryPath string) {
	t.Helper()
	tests := []struct {
		name    string
		prepare func(*testing.T, string)
	}{
		{
			name: "partial legacy table",
			prepare: func(t *testing.T, databaseURL string) {
				installAppAPIRuntimeFact(t, databaseURL)
				conn := connect(t, databaseURL)
				defer closeConn(t, conn)
				if _, err := conn.Exec(t.Context(), "create table runtime.agent_run_cleanups (run_id text primary key)"); err != nil {
					t.Fatalf("install partial legacy runtime fixture: %v", err)
				}
			},
		},
		{
			name: "unknown table",
			prepare: func(t *testing.T, databaseURL string) {
				installAppAPIRuntimeFact(t, databaseURL)
				conn := connect(t, databaseURL)
				defer closeConn(t, conn)
				if _, err := conn.Exec(t.Context(), "create table runtime.unowned_runtime_state (id text primary key)"); err != nil {
					t.Fatalf("install unknown runtime table fixture: %v", err)
				}
			},
		},
		{
			name: "unknown column",
			prepare: func(t *testing.T, databaseURL string) {
				installAppAPIRuntimeFact(t, databaseURL)
				installLegacyRuntimeSchema(t, harness, databaseURL, true)
				conn := connect(t, databaseURL)
				defer closeConn(t, conn)
				if _, err := conn.Exec(t.Context(), "alter table runtime.agent_runs add column unexpected_column text"); err != nil {
					t.Fatalf("install unknown runtime column fixture: %v", err)
				}
			},
		},
		{
			name: "missing legacy column",
			prepare: func(t *testing.T, databaseURL string) {
				installAppAPIRuntimeFact(t, databaseURL)
				installLegacyRuntimeSchema(t, harness, databaseURL, true)
				conn := connect(t, databaseURL)
				defer closeConn(t, conn)
				if _, err := conn.Exec(t.Context(), "alter table runtime.agent_run_cleanups drop column confirmed_at"); err != nil {
					t.Fatalf("remove legacy runtime column fixture: %v", err)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, databaseURL := harness.ownerDatabase(t)
			test.prepare(t, databaseURL)
			evidencePath := filepath.Join(t.TempDir(), "failed-install-evidence.json")
			if output, err := runSchemaCommand(t, harness, binaryPath, databaseURL, "install", evidencePath); err == nil {
				t.Fatalf("schema install unexpectedly succeeded: %s", output)
			}
			if _, err := os.Stat(evidencePath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("failed schema install evidence stat error = %v, want not exist", err)
			}
			assertExecutionControlMigrationLedgerAbsent(t, databaseURL)
		})
	}
}

func runSchemaCommand(t *testing.T, harness *postgresHarness, binaryPath, databaseURL, mode, evidencePath string) ([]byte, error) {
	t.Helper()
	command := exec.CommandContext(
		t.Context(),
		binaryPath,
		"--mode", mode,
		"--database-url", databaseURL,
		"--evidence-path", evidencePath,
	)
	command.Dir = harness.moduleDir
	return command.CombinedOutput()
}

func requireSuccessfulSchemaCommand(t *testing.T, harness *postgresHarness, binaryPath, databaseURL, mode string) {
	t.Helper()
	evidencePath := filepath.Join(t.TempDir(), mode+"-evidence.json")
	if output, err := runSchemaCommand(t, harness, binaryPath, databaseURL, mode, evidencePath); err != nil {
		t.Fatalf("run schema command %s: %v\n%s", mode, err, output)
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

func assertAppliedExecutionControlMigrations(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var applied int
	if err := conn.QueryRow(t.Context(), `
		select count(*)::int
		from public.execution_control_migrations
		where version_id in (1, 2, 3) and is_applied
	`).Scan(&applied); err != nil {
		t.Fatalf("inspect execution-control migration ledger: %v", err)
	}
	if applied != 3 {
		t.Fatalf("applied execution-control migrations = %d, want 3", applied)
	}
}

func assertExecutionControlMigrationLedgerAbsent(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var exists bool
	if err := conn.QueryRow(t.Context(), "select to_regclass('public.execution_control_migrations') is not null").Scan(&exists); err != nil {
		t.Fatalf("inspect execution-control migration ledger: %v", err)
	}
	if exists {
		t.Fatal("execution-control migration ledger was created for an unknown runtime schema")
	}
}

func assertLegacyCleanupTableRemoved(t *testing.T, databaseURL string) {
	t.Helper()
	conn := connect(t, databaseURL)
	defer closeConn(t, conn)
	var table string
	if err := conn.QueryRow(
		t.Context(),
		"select coalesce(to_regclass('runtime.agent_run_cleanups')::text, '')",
	).Scan(&table); err != nil {
		t.Fatalf("inspect retired cleanup table: %v", err)
	}
	if table != "" {
		t.Fatalf("retired cleanup table remains after schema install: %s", table)
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
