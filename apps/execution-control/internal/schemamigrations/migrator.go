package schemamigrations

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

const migrationTable = "public.execution_control_migrations"

const appAPIRuntimeFactTable = "request_observability_fact"

var runtimeTables = []string{
	"runtime.agent_runs",
	"runtime.agent_run_events",
	"runtime.agent_run_steps",
	"runtime.agent_step_attempts",
	"runtime.agent_step_results",
	"runtime.conversation_run_locks",
	"runtime.agent_workflow_starts",
	"runtime.agent_run_cancellations",
	"runtime.agent_invocation_receipts",
	"runtime.personal_memory_owner_fences",
	"runtime.personal_memory_call_leases",
	"runtime.personal_memory_command_receipts",
}

var legacyRuntimeTableNames = []string{
	"agent_runs",
	"agent_run_events",
	"agent_run_steps",
	"agent_step_attempts",
	"agent_step_results",
	"conversation_run_locks",
	"agent_workflow_starts",
	"agent_run_cancellations",
	"agent_run_cleanups",
	"agent_invocation_receipts",
}

var legacyRuntimeTableColumns = map[string][]string{
	"agent_runs": {
		"run_id", "conversation_id", "turn_id", "request_id", "trace_id", "owner_user_id", "surface", "task_queue", "status",
		"terminal_reason", "fail_close_reason", "retryable", "created_at", "queued_at", "admitted_at", "started_at", "streaming_started_at",
		"completed_at", "updated_at", "runtime_versions_json", "final_response_ref", "request_fingerprint_sha256", "metadata_json",
	},
	"agent_run_events": {
		"event_id", "run_id", "conversation_id", "sequence", "event_type", "visibility", "payload_schema_version", "payload_json", "occurred_at", "created_at",
	},
	"agent_run_steps": {
		"step_id", "run_id", "conversation_id", "step_kind", "tool", "parent_step_id", "status", "activity_attempt", "task_queue", "worker_id",
		"started_at", "completed_at", "updated_at", "payload_schema_version", "sanitized_payload_json", "created_at",
	},
	"agent_step_attempts": {
		"attempt_id", "step_id", "run_id", "attempt", "status", "task_queue", "worker_id", "workflow_id", "temporal_run_id", "activity_id",
		"activity_type", "activity_attempt", "scheduled_at", "started_at", "completed_at", "schedule_to_start_ms", "duration_ms", "provider_request_ref",
		"provider_response_id", "model_provider", "model_name", "model_request_count", "input_tokens", "output_tokens", "cached_input_tokens",
		"usage_observed", "cancel_outcome", "timeout_outcome", "late_completion_outcome", "fail_close_reason", "terminal_reason", "updated_at",
		"payload_schema_version", "sanitized_payload_json", "created_at",
	},
	"agent_step_results": {
		"result_id", "step_id", "run_id", "attempt_id", "status", "result_kind", "projection_ref", "created_at", "payload_schema_version", "sanitized_payload_json",
	},
	"conversation_run_locks": {
		"conversation_id", "run_id", "created_at",
	},
	"agent_workflow_starts": {
		"run_id", "workflow_id", "payload_sha256", "task_queue", "workflow_input_json", "state", "temporal_run_id", "attempt_count",
		"dispatch_attempted", "next_attempt_at", "lease_token", "lease_until", "last_error_code", "created_at", "updated_at",
	},
	"agent_run_cancellations": {
		"run_id", "workflow_id", "reason", "state", "attempt_count", "next_attempt_at", "lease_token", "lease_until", "last_error_code", "created_at", "updated_at",
	},
	"agent_run_cleanups": {
		"run_id", "state", "attempt_count", "next_attempt_at", "lease_token", "lease_until", "last_error_code", "created_at", "confirmed_at", "updated_at",
	},
	"agent_invocation_receipts": {
		"invocation_id", "run_id", "input_sha256", "state", "output_json", "output_sha256", "created_at", "completed_at", "updated_at",
	},
}

var legacyPersonalMemoryTableNames = []string{
	"personal_memory_owner_fences",
	"personal_memory_call_leases",
	"personal_memory_command_receipts",
}

var legacyPersonalMemoryTableColumns = map[string][]string{
	"personal_memory_owner_fences": {
		"owner_scope_hash", "generation", "lifecycle_state", "last_owner_sequence", "updated_at",
	},
	"personal_memory_call_leases": {
		"call_id", "owner_scope_hash", "generation", "owner_sequence", "subject_scope_hash", "operation_kind", "expires_at", "created_at",
	},
	"personal_memory_command_receipts": {
		"command_id", "owner_scope_hash", "generation", "sequence", "kind", "status", "error_code", "lease_expires_at", "result_fingerprint",
		"subject_scope_hash", "supersession_scope", "created_at", "updated_at", "terminal_at",
	},
}

const runtimeGrantSQL = `
revoke all privileges on schema runtime from execution_control;
grant usage on schema runtime to execution_control;

revoke all privileges on table
	runtime.agent_runs,
	runtime.agent_run_events,
	runtime.agent_run_steps,
	runtime.agent_step_attempts,
	runtime.agent_step_results,
	runtime.conversation_run_locks,
	runtime.agent_workflow_starts,
	runtime.agent_run_cancellations,
	runtime.agent_invocation_receipts,
	runtime.personal_memory_owner_fences,
	runtime.personal_memory_call_leases,
	runtime.personal_memory_command_receipts
from execution_control;

grant select, insert, update, delete on table
	runtime.agent_runs,
	runtime.agent_run_events,
	runtime.agent_run_steps,
	runtime.agent_step_attempts,
	runtime.agent_step_results,
	runtime.conversation_run_locks,
	runtime.agent_workflow_starts,
	runtime.agent_run_cancellations,
	runtime.agent_invocation_receipts,
	runtime.personal_memory_owner_fences,
	runtime.personal_memory_call_leases,
	runtime.personal_memory_command_receipts
to execution_control;

do $$
begin
	if to_regclass('runtime.request_observability_fact') is not null then
		execute 'revoke all privileges on table runtime.request_observability_fact from execution_control';
	end if;
end
$$;
`

const providerConfigGrantSQL = `
grant usage on schema execution_config to execution_control;
grant select, insert, update, delete on execution_config.model_settings to execution_control;

do $$
begin
	if exists (select 1 from pg_roles where rolname = 'execution_provider_config_reader') then
		revoke all privileges on execution_config.model_settings from execution_provider_config_reader;
		revoke usage on schema execution_config from execution_provider_config_reader;
	end if;
	if exists (select 1 from pg_roles where rolname = 'execution_provider_config_admin') then
		revoke all privileges on execution_config.model_settings from execution_provider_config_admin;
		revoke usage on schema execution_config from execution_provider_config_admin;
	end if;
end
$$;
`

const providerConfigSchemaMigrationSQL = `
create schema if not exists execution_config;

create table if not exists execution_config.model_settings (
	kind text primary key check (kind in ('llm','embedding')),
	provider text not null,
	base_url text not null,
	model text not null,
	transport text not null,
	dimensions integer,
	secret_key_id text not null,
	secret_nonce bytea not null,
	secret_ciphertext bytea not null,
	secret_fingerprint text not null,
	secret_last4 text not null,
	validation_status text not null check (validation_status in ('passed','failed')),
	validation_error_code text not null default '',
	validation_message text not null default '',
	validation_observed_dimensions integer,
	validated_at timestamptz not null,
	validated_by text not null,
	updated_at timestamptz not null,
	updated_by text not null
);

alter table execution_config.model_settings drop column if exists timeout_ms;
`

var providerConfigColumns = []string{
	"base_url",
	"dimensions",
	"kind",
	"model",
	"provider",
	"secret_ciphertext",
	"secret_fingerprint",
	"secret_key_id",
	"secret_last4",
	"secret_nonce",
	"transport",
	"updated_at",
	"updated_by",
	"validated_at",
	"validated_by",
	"validation_error_code",
	"validation_message",
	"validation_observed_dimensions",
	"validation_status",
}

//go:embed migrations/*.sql
var migrationFiles embed.FS

type Migrator struct {
	db       *sql.DB
	provider *goose.Provider
}

func New(databaseURL string, keyring *providerconfig.Keyring) (*Migrator, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, errors.New("schema migration database URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open schema migration database: %w", err)
	}
	migrations, err := fs.Sub(migrationFiles, "migrations")
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("open embedded schema migrations: %w", err)
	}
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create schema migration lock: %w", err)
	}
	provider, err := goose.NewProvider(
		goose.DialectPostgres,
		db,
		migrations,
		goose.WithTableName(migrationTable),
		goose.WithDisableGlobalRegistry(true),
		goose.WithSessionLocker(locker),
		goose.WithGoMigrations(goose.NewGoMigration(3, &goose.GoFunc{
			RunTx: func(ctx context.Context, tx *sql.Tx) error {
				if err := requireKnownProviderConfigSchema(ctx, tx); err != nil {
					return err
				}
				if _, err := tx.ExecContext(ctx, providerConfigSchemaMigrationSQL); err != nil {
					return fmt.Errorf("install provider config schema: %w", err)
				}
				return providerconfig.MigrateAndRemoveLegacyModelSettings(ctx, tx, keyring)
			},
		}, nil)),
	)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create schema migrator: %w", err)
	}
	return &Migrator{db: db, provider: provider}, nil
}

func requireKnownProviderConfigSchema(ctx context.Context, tx *sql.Tx) error {
	var exists bool
	if err := tx.QueryRowContext(
		ctx,
		"select to_regclass('execution_config.model_settings') is not null",
	).Scan(&exists); err != nil {
		return fmt.Errorf("inspect provider config schema: %w", err)
	}
	if !exists {
		return nil
	}
	columns, err := providerConfigColumnNames(ctx, tx)
	if err != nil {
		return err
	}
	if strings.Join(columns, ",") != strings.Join(providerConfigColumns, ",") {
		return fmt.Errorf(
			"execution_config.model_settings has unknown columns: %s",
			strings.Join(columns, ","),
		)
	}
	return nil
}

func providerConfigColumnNames(ctx context.Context, tx *sql.Tx) (_ []string, err error) {
	rows, err := tx.QueryContext(ctx, `
		select column_name
		from information_schema.columns
		where table_schema = 'execution_config' and table_name = 'model_settings'
		order by column_name collate "C"
	`)
	if err != nil {
		return nil, fmt.Errorf("inspect provider config columns: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close provider config column rows: %w", closeErr)
		}
	}()
	columns := make([]string, 0, len(providerConfigColumns)+1)
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, fmt.Errorf("scan provider config column: %w", err)
		}
		if column != "timeout_ms" {
			columns = append(columns, column)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspect provider config column rows: %w", err)
	}
	return columns, nil
}

func (m *Migrator) requireKnownRuntimeSchema(ctx context.Context) error {
	var ledgerExists bool
	if err := m.db.QueryRowContext(
		ctx,
		"select to_regclass($1) is not null",
		migrationTable,
	).Scan(&ledgerExists); err != nil {
		return fmt.Errorf("inspect execution-control migration ledger: %w", err)
	}
	if ledgerExists {
		return nil
	}

	actual, err := runtimeTableColumnNames(ctx, m.db)
	if err != nil {
		return err
	}
	delete(actual, appAPIRuntimeFactTable)
	if len(actual) == 0 {
		return nil
	}

	unknownTables := make([]string, 0)
	for table := range actual {
		if _, known := legacyRuntimeTableColumns[table]; known {
			continue
		}
		if _, known := legacyPersonalMemoryTableColumns[table]; known {
			continue
		}
		unknownTables = append(unknownTables, table)
	}
	if len(unknownTables) > 0 {
		sort.Strings(unknownTables)
		return fmt.Errorf(
			"runtime schema has unknown tables before execution-control migration: %s",
			strings.Join(unknownTables, ","),
		)
	}

	for _, table := range legacyRuntimeTableNames {
		if _, exists := actual[table]; !exists {
			return fmt.Errorf("runtime schema is incomplete before execution-control migration: missing runtime.%s", table)
		}
	}

	personalMemoryPresent := false
	for _, table := range legacyPersonalMemoryTableNames {
		if _, exists := actual[table]; exists {
			personalMemoryPresent = true
			break
		}
	}
	if personalMemoryPresent {
		for _, table := range legacyPersonalMemoryTableNames {
			if _, exists := actual[table]; !exists {
				return fmt.Errorf("runtime schema is incomplete before execution-control migration: missing runtime.%s", table)
			}
		}
	}

	for table, columns := range actual {
		expected, ok := legacyRuntimeTableColumns[table]
		if !ok {
			expected = legacyPersonalMemoryTableColumns[table]
		}
		if sameColumnNames(columns, expected) {
			continue
		}
		return fmt.Errorf(
			"runtime.%s has unknown or missing columns before execution-control migration: got %s, want %s",
			table,
			strings.Join(columns, ","),
			strings.Join(sortedColumnNames(expected), ","),
		)
	}
	return nil
}

func runtimeTableColumnNames(ctx context.Context, db *sql.DB) (_ map[string][]string, err error) {
	rows, err := db.QueryContext(ctx, `
		select relation.relname::text, attribute.attname::text
		from pg_class as relation
		join pg_namespace as namespace on namespace.oid = relation.relnamespace
		join pg_attribute as attribute on attribute.attrelid = relation.oid
		where namespace.nspname = 'runtime'
			and relation.relkind in ('r', 'p')
			and attribute.attnum > 0
			and not attribute.attisdropped
		order by relation.relname collate "C", attribute.attname collate "C"
	`)
	if err != nil {
		return nil, fmt.Errorf("inspect runtime schema tables: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close runtime schema table rows: %w", closeErr)
		}
	}()

	tables := make(map[string][]string)
	for rows.Next() {
		var table, column string
		if err := rows.Scan(&table, &column); err != nil {
			return nil, fmt.Errorf("scan runtime schema table column: %w", err)
		}
		tables[table] = append(tables[table], column)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspect runtime schema table rows: %w", err)
	}
	return tables, nil
}

func sameColumnNames(actual, expected []string) bool {
	if len(actual) != len(expected) {
		return false
	}
	expected = sortedColumnNames(expected)
	for index := range actual {
		if actual[index] != expected[index] {
			return false
		}
	}
	return true
}

func sortedColumnNames(columns []string) []string {
	sorted := append([]string(nil), columns...)
	sort.Strings(sorted)
	return sorted
}

func (m *Migrator) Up(ctx context.Context) error {
	if err := m.requireRuntimeRole(ctx); err != nil {
		return err
	}
	if err := m.requireKnownRuntimeSchema(ctx); err != nil {
		return err
	}
	if _, err := m.provider.Up(ctx); err != nil {
		return fmt.Errorf("apply execution-control schema migrations: %w", err)
	}
	return nil
}

func (m *Migrator) Check(ctx context.Context) error {
	if err := m.requireRuntimeRole(ctx); err != nil {
		return err
	}
	pending, err := m.provider.HasPending(ctx)
	if err != nil {
		return fmt.Errorf("inspect execution-control schema migrations: %w", err)
	}
	if pending {
		return errors.New("execution-control schema migrations are pending")
	}
	return nil
}

func (m *Migrator) InstallGrants(ctx context.Context) error {
	if err := m.requireRuntimeRole(ctx); err != nil {
		return err
	}
	if _, err := m.db.ExecContext(ctx, runtimeGrantSQL+providerConfigGrantSQL); err != nil {
		return fmt.Errorf("install execution-control runtime grants: %w", err)
	}
	return nil
}

func (m *Migrator) CheckGrants(ctx context.Context) error {
	var usage, create bool
	if err := m.db.QueryRowContext(
		ctx,
		"select has_schema_privilege($1,'runtime','USAGE'), has_schema_privilege($1,'runtime','CREATE')",
		"execution_control",
	).Scan(&usage, &create); err != nil {
		return fmt.Errorf("inspect execution-control runtime schema grants: %w", err)
	}
	if !usage || create {
		return fmt.Errorf("database role execution_control runtime schema privileges usage=%t create=%t, want usage=true create=false", usage, create)
	}
	for _, table := range runtimeTables {
		for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
			if err := m.requireTablePrivilege(ctx, table, privilege, true); err != nil {
				return err
			}
		}
		for _, privilege := range []string{"TRUNCATE", "REFERENCES", "TRIGGER"} {
			if err := m.requireTablePrivilege(ctx, table, privilege, false); err != nil {
				return err
			}
		}
	}
	var productFactExists bool
	if err := m.db.QueryRowContext(ctx, "select to_regclass('runtime.request_observability_fact') is not null").Scan(&productFactExists); err != nil {
		return fmt.Errorf("inspect request observability fact presence: %w", err)
	}
	if productFactExists {
		for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
			if err := m.requireTablePrivilege(ctx, "runtime.request_observability_fact", privilege, false); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *Migrator) requireTablePrivilege(ctx context.Context, table, privilege string, want bool) error {
	var granted bool
	if err := m.db.QueryRowContext(
		ctx,
		"select has_table_privilege($1,$2,$3)",
		"execution_control",
		table,
		privilege,
	).Scan(&granted); err != nil {
		return fmt.Errorf("inspect database role execution_control %s on %s: %w", privilege, table, err)
	}
	if granted != want {
		return fmt.Errorf("database role execution_control %s on %s = %t, want %t", privilege, table, granted, want)
	}
	return nil
}

func (m *Migrator) requireRuntimeRole(ctx context.Context) error {
	var exists bool
	if err := m.db.QueryRowContext(
		ctx,
		"select exists(select 1 from pg_roles where rolname=$1)",
		"execution_control",
	).Scan(&exists); err != nil {
		return fmt.Errorf("inspect execution-control database role: %w", err)
	}
	if !exists {
		return errors.New("database role execution_control is not installed")
	}
	return nil
}

func (m *Migrator) Close() error {
	if m == nil || m.provider == nil {
		return nil
	}
	return m.provider.Close()
}
