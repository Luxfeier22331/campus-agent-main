package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidDurableRuntimeStore = errors.New("invalid durable runtime store")
var ErrInvalidRunProjectionStore = errors.New("invalid run projection store")

type PostgresDurableRuntimeStoreOptions struct {
	DatabaseURL string
	AutoMigrate bool
}

type PostgresDurableRuntimeStore struct {
	pool *pgxpool.Pool
}

func NewPostgresDurableRuntimeStore(
	ctx context.Context,
	options PostgresDurableRuntimeStoreOptions,
) (*PostgresDurableRuntimeStore, error) {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil, fmt.Errorf("%w: database url is required", ErrInvalidDurableRuntimeStore)
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse durable runtime database url: %w", err)
	}
	config.MaxConns = 8
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create durable runtime postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping durable runtime postgres: %w", err)
	}
	store := &PostgresDurableRuntimeStore{pool: pool}
	if options.AutoMigrate {
		if err := store.EnsureSchema(ctx); err != nil {
			pool.Close()
			return nil, err
		}
	}
	return store, nil
}

type PostgresRunProjectionStoreOptions struct {
	DatabaseURL string
	AutoMigrate bool
}

func NewPostgresRunProjectionStore(
	ctx context.Context,
	options PostgresRunProjectionStoreOptions,
) (*PostgresDurableRuntimeStore, error) {
	databaseURL := strings.TrimSpace(options.DatabaseURL)
	if databaseURL == "" {
		return nil, fmt.Errorf("%w: database url is required", ErrInvalidRunProjectionStore)
	}
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse run projection database url: %w", err)
	}
	config.MaxConns = 8
	config.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create run projection postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping run projection postgres: %w", err)
	}
	store := &PostgresDurableRuntimeStore{pool: pool}
	if options.AutoMigrate {
		if err := store.EnsureSchema(ctx); err != nil {
			pool.Close()
			return nil, err
		}
	}
	return store, nil
}

func (s *PostgresDurableRuntimeStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, durableRuntimeSchemaSQL)
	if err != nil {
		return fmt.Errorf("ensure durable runtime schema: %w", err)
	}
	return nil
}

func (s *PostgresDurableRuntimeStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("run projection store is not configured")
	}
	for _, tableName := range []string{
		"runtime.agent_runs",
		"runtime.agent_run_events",
		"runtime.agent_run_steps",
		"runtime.agent_step_attempts",
		"runtime.agent_step_results",
		"runtime.conversation_run_locks",
	} {
		var exists bool
		if err := s.pool.QueryRow(ctx, "select to_regclass($1) is not null", tableName).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("%s table is not installed", tableName)
		}
	}
	return nil
}

func (s *PostgresDurableRuntimeStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func jsonMapToBytes(value map[string]any) ([]byte, error) {
	if value == nil {
		value = map[string]any{}
	}
	return json.Marshal(value)
}

func jsonDurableLanes(lanes []DurableLane) ([]byte, error) {
	if lanes == nil {
		lanes = []DurableLane{}
	}
	return json.Marshal(lanes)
}

func scanJSONMap(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	if value == nil {
		return map[string]any{}, nil
	}
	return value, nil
}

const durableRuntimeSchemaSQL = `
create schema if not exists runtime;

create table if not exists runtime.agent_runs (
	run_id text primary key,
	conversation_id text not null,
	turn_id text not null,
	request_id text not null,
	trace_id text not null default '',
	owner_user_id text not null,
	surface text not null,
	requested_capability text not null default '',
	selected_capability text not null default '',
	lane text not null,
	status text not null,
	terminal_reason text not null default '',
	fail_close_reason text not null default '',
	retryable boolean not null default false,
	created_at timestamptz not null,
	queued_at timestamptz,
	admitted_at timestamptz,
	started_at timestamptz,
	streaming_started_at timestamptz,
	completed_at timestamptz,
	updated_at timestamptz not null,
	runtime_versions_json jsonb not null default '{}'::jsonb,
	workflow_plan_ref text not null default '',
	final_response_ref text not null default '',
	metadata_json jsonb not null default '{}'::jsonb
);

create table if not exists runtime.agent_run_events (
	event_id text primary key,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	conversation_id text not null,
	sequence bigint not null,
	event_type text not null,
	visibility text not null,
	payload_schema_version text not null,
	payload_json jsonb not null,
	occurred_at timestamptz not null,
	created_at timestamptz not null default now()
);

create table if not exists runtime.agent_run_steps (
	step_id text not null,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	conversation_id text not null,
	step_kind text not null,
	capability text not null default '',
	parent_step_id text not null default '',
	status text not null,
	task_queue text not null default '',
	worker_id text not null default '',
	started_at timestamptz,
	completed_at timestamptz,
	updated_at timestamptz not null,
	payload_schema_version text not null,
	sanitized_payload_json jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	primary key (run_id, step_id)
);

create table if not exists runtime.agent_step_attempts (
	attempt_id text primary key,
	step_id text not null,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	attempt integer not null,
	status text not null,
	task_queue text not null default '',
	worker_id text not null default '',
	started_at timestamptz,
	completed_at timestamptz,
	updated_at timestamptz not null,
	payload_schema_version text not null,
	sanitized_payload_json jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	unique (run_id, step_id, attempt)
);

create table if not exists runtime.agent_step_results (
	result_id text primary key,
	step_id text not null,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	attempt_id text not null default '',
	status text not null,
	result_kind text not null,
	projection_ref text not null,
	created_at timestamptz not null,
	payload_schema_version text not null,
	sanitized_payload_json jsonb not null default '{}'::jsonb
);

create table if not exists runtime.conversation_run_locks (
	conversation_id text primary key,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	created_at timestamptz not null default now()
);

create unique index if not exists agent_runs_active_conversation_idx
	on runtime.agent_runs (conversation_id)
	where status in ('created', 'queued', 'admitted', 'running', 'streaming');

create index if not exists agent_runs_request_idx
	on runtime.agent_runs (request_id);

create index if not exists agent_runs_trace_idx
	on runtime.agent_runs (trace_id);

create index if not exists agent_runs_status_lane_created_idx
	on runtime.agent_runs (status, lane, created_at);

create unique index if not exists agent_run_events_run_sequence_idx
	on runtime.agent_run_events (run_id, sequence);

create index if not exists agent_run_events_run_occurred_idx
	on runtime.agent_run_events (run_id, occurred_at);

create index if not exists agent_run_events_conversation_occurred_idx
	on runtime.agent_run_events (conversation_id, occurred_at desc);

create index if not exists agent_run_events_type_occurred_idx
	on runtime.agent_run_events (event_type, occurred_at desc);

create index if not exists agent_run_steps_run_updated_idx
	on runtime.agent_run_steps (run_id, updated_at);

create index if not exists agent_step_attempts_run_step_idx
	on runtime.agent_step_attempts (run_id, step_id, attempt);

create index if not exists agent_step_results_run_step_idx
	on runtime.agent_step_results (run_id, step_id, created_at);

`
