package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidRunProjectionStore = errors.New("invalid run projection store")

type PostgresRunProjectionStoreOptions struct {
	DatabaseURL string
	AutoMigrate bool
}

type PostgresRunProjectionStore struct {
	pool                *pgxpool.Pool
	eventMu             sync.Mutex
	eventListenerActive bool
	eventListenerCancel context.CancelFunc
	eventListenerDone   chan struct{}
	eventListenerErr    error
	eventWaiters        map[string]map[chan struct{}]struct{}
	closed              bool
}

func NewPostgresRunProjectionStore(
	ctx context.Context,
	options PostgresRunProjectionStoreOptions,
) (*PostgresRunProjectionStore, error) {
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
	store := &PostgresRunProjectionStore{
		pool:         pool,
		eventWaiters: map[string]map[chan struct{}]struct{}{},
	}
	if options.AutoMigrate {
		if err := store.EnsureSchema(ctx); err != nil {
			pool.Close()
			return nil, err
		}
	}
	return store, nil
}

func (s *PostgresRunProjectionStore) EnsureSchema(ctx context.Context) error {
	_, err := s.pool.Exec(ctx, runProjectionSchemaSQL)
	if err != nil {
		return fmt.Errorf("ensure run projection schema: %w", err)
	}
	return nil
}

func (s *PostgresRunProjectionStore) HealthCheck(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("run projection store is not configured")
	}
	rows, err := s.pool.Query(ctx, runProjectionSchemaHealthSQL)
	if err != nil {
		return fmt.Errorf("inspect run projection schema: %w", err)
	}
	defer rows.Close()

	issues := make([]string, 0)
	for rows.Next() {
		var issue string
		if err := rows.Scan(&issue); err != nil {
			return fmt.Errorf("scan run projection schema issue: %w", err)
		}
		issues = append(issues, issue)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspect run projection schema rows: %w", err)
	}
	if len(issues) > 0 {
		return fmt.Errorf("run projection schema is not ready: %s", strings.Join(issues, "; "))
	}
	for _, table := range runProjectionRuntimeTables {
		if _, err := s.pool.Exec(ctx, "select 1 from "+table+" limit 0"); err != nil {
			return fmt.Errorf("read run projection table %s: %w", table, err)
		}
	}
	if err := s.ensureRunEventListener(ctx); err != nil {
		return fmt.Errorf("run projection event listener is not ready: %w", err)
	}
	return nil
}

func (s *PostgresRunProjectionStore) Close() {
	if s == nil || s.pool == nil {
		return
	}
	s.eventMu.Lock()
	if s.closed {
		s.eventMu.Unlock()
		return
	}
	s.closed = true
	cancel := s.eventListenerCancel
	done := s.eventListenerDone
	s.eventMu.Unlock()
	if cancel != nil {
		cancel()
	}
	if done != nil {
		<-done
	}
	s.pool.Close()
}

func jsonMapToBytes(value map[string]any) ([]byte, error) {
	if value == nil {
		value = map[string]any{}
	}
	return json.Marshal(value)
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

const runProjectionSchemaSQL = `
create schema if not exists runtime;

drop table if exists runtime.agent_protected_payloads;

create table if not exists runtime.agent_runs (
	run_id text primary key,
	conversation_id text not null,
	turn_id text not null,
	request_id text not null,
	trace_id text not null default '',
	owner_user_id text not null,
	surface text not null,
	task_queue text not null,
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
	final_response_ref text not null default '',
	request_fingerprint_sha256 text not null default '',
	metadata_json jsonb not null default '{}'::jsonb
		);

alter table runtime.agent_runs add column if not exists request_fingerprint_sha256 text not null default '';
alter table runtime.agent_runs drop column if exists requested_tool;
alter table runtime.agent_runs drop column if exists selected_tool;

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
	tool text not null default '',
	parent_step_id text not null default '',
	status text not null,
	activity_attempt integer not null default 0,
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

	alter table runtime.agent_run_steps add column if not exists tool text not null default '';
	alter table runtime.agent_run_steps add column if not exists activity_attempt integer not null default 0;

create table if not exists runtime.agent_step_attempts (
	attempt_id text primary key,
	step_id text not null,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	attempt integer not null,
	status text not null,
	task_queue text not null default '',
	worker_id text not null default '',
	workflow_id text not null default '',
	temporal_run_id text not null default '',
	activity_id text not null default '',
	activity_type text not null default '',
	activity_attempt integer not null default 0,
	scheduled_at timestamptz,
	started_at timestamptz,
	completed_at timestamptz,
	schedule_to_start_ms bigint not null default 0,
	duration_ms bigint not null default 0,
	provider_request_ref text not null default '',
	provider_response_id text not null default '',
	model_provider text not null default '',
	model_name text not null default '',
	model_request_count bigint not null default 0,
	input_tokens bigint not null default 0,
	output_tokens bigint not null default 0,
	cached_input_tokens bigint not null default 0,
	usage_observed boolean not null default false,
	cancel_outcome text not null default '',
	timeout_outcome text not null default '',
	late_completion_outcome text not null default 'not_late',
	fail_close_reason text not null default '',
	terminal_reason text not null default '',
	updated_at timestamptz not null,
	payload_schema_version text not null,
	sanitized_payload_json jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now(),
	unique (run_id, step_id, attempt)
);

alter table runtime.agent_step_attempts add column if not exists workflow_id text not null default '';
alter table runtime.agent_step_attempts add column if not exists temporal_run_id text not null default '';
alter table runtime.agent_step_attempts add column if not exists activity_id text not null default '';
alter table runtime.agent_step_attempts add column if not exists activity_type text not null default '';
alter table runtime.agent_step_attempts add column if not exists activity_attempt integer not null default 0;
alter table runtime.agent_step_attempts add column if not exists scheduled_at timestamptz;
alter table runtime.agent_step_attempts add column if not exists schedule_to_start_ms bigint not null default 0;
alter table runtime.agent_step_attempts add column if not exists duration_ms bigint not null default 0;
alter table runtime.agent_step_attempts add column if not exists provider_request_ref text not null default '';
alter table runtime.agent_step_attempts add column if not exists provider_response_id text not null default '';
alter table runtime.agent_step_attempts add column if not exists model_provider text not null default '';
alter table runtime.agent_step_attempts add column if not exists model_name text not null default '';
alter table runtime.agent_step_attempts add column if not exists model_request_count bigint not null default 0;
alter table runtime.agent_step_attempts add column if not exists input_tokens bigint not null default 0;
alter table runtime.agent_step_attempts add column if not exists output_tokens bigint not null default 0;
alter table runtime.agent_step_attempts add column if not exists cached_input_tokens bigint not null default 0;
alter table runtime.agent_step_attempts add column if not exists usage_observed boolean not null default false;
update runtime.agent_step_attempts
set usage_observed = true
where not usage_observed
	and (input_tokens > 0 or output_tokens > 0 or cached_input_tokens > 0);
alter table runtime.agent_step_attempts drop column if exists estimated_cost_microusd;
alter table runtime.agent_step_attempts add column if not exists cancel_outcome text not null default '';
alter table runtime.agent_step_attempts add column if not exists timeout_outcome text not null default '';
alter table runtime.agent_step_attempts add column if not exists late_completion_outcome text not null default 'not_late';
alter table runtime.agent_step_attempts add column if not exists fail_close_reason text not null default '';
alter table runtime.agent_step_attempts add column if not exists terminal_reason text not null default '';

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

create table if not exists runtime.agent_workflow_starts (
	run_id text primary key references runtime.agent_runs(run_id) on delete cascade,
	workflow_id text not null unique,
	payload_sha256 text not null,
	task_queue text not null,
	workflow_input_json jsonb not null,
	state text not null,
	temporal_run_id text not null default '',
	attempt_count integer not null default 0,
	dispatch_attempted boolean not null default false,
	next_attempt_at timestamptz not null,
	lease_token text not null default '',
	lease_until timestamptz,
	last_error_code text not null default '',
	created_at timestamptz not null,
	updated_at timestamptz not null
);

alter table runtime.agent_workflow_starts
	add column if not exists dispatch_attempted boolean not null default true;
alter table runtime.agent_workflow_starts
	alter column dispatch_attempted set default false;

create table if not exists runtime.agent_run_cancellations (
	run_id text primary key references runtime.agent_runs(run_id) on delete cascade,
	workflow_id text not null,
	reason text not null,
	state text not null,
	attempt_count integer not null default 0,
	next_attempt_at timestamptz not null,
	lease_token text not null default '',
	lease_until timestamptz,
	last_error_code text not null default '',
	created_at timestamptz not null,
	updated_at timestamptz not null
);

create table if not exists runtime.agent_run_cleanups (
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

insert into runtime.agent_run_cleanups (
	run_id, state, next_attempt_at, created_at, updated_at
)
select runs.run_id, 'pending', runs.created_at, runs.created_at, runs.created_at
from runtime.agent_runs as runs
on conflict (run_id) do nothing;

create table if not exists runtime.agent_invocation_receipts (
	invocation_id text primary key,
	run_id text not null references runtime.agent_runs(run_id) on delete cascade,
	input_sha256 text not null,
	state text not null,
	output_json jsonb,
	output_sha256 text not null default '',
	created_at timestamptz not null,
	completed_at timestamptz,
	updated_at timestamptz not null
);

drop index if exists runtime.agent_runs_active_conversation_idx;
create unique index agent_runs_active_conversation_idx
	on runtime.agent_runs (conversation_id)
	where status in ('created', 'queued', 'admitted', 'running', 'streaming');

create index if not exists agent_runs_request_idx
	on runtime.agent_runs (request_id);

create index if not exists agent_runs_trace_idx
	on runtime.agent_runs (trace_id);

create index if not exists agent_runs_status_task_queue_created_idx
	on runtime.agent_runs (status, task_queue, created_at);

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

create index if not exists agent_workflow_starts_lease_idx
	on runtime.agent_workflow_starts (state, next_attempt_at, lease_until);

create index if not exists agent_run_cancellations_lease_idx
	on runtime.agent_run_cancellations (state, next_attempt_at, lease_until);

create index if not exists agent_run_cleanups_lease_idx
	on runtime.agent_run_cleanups (state, next_attempt_at, lease_until);

create index if not exists agent_invocation_receipts_run_idx
	on runtime.agent_invocation_receipts (run_id, created_at);

`
