-- +goose Up
drop view runtime.agent_invocation_receipts;
drop view runtime.agent_run_cancellations;
drop view runtime.agent_workflow_starts;
drop view runtime.conversation_run_locks;
drop view runtime.agent_step_results;
drop view runtime.agent_step_attempts;
drop view runtime.agent_run_steps;
drop view runtime.agent_run_events;
drop view runtime.agent_runs;

alter table execution_control.agent_run_events add column request_id text;
alter table execution_control.agent_run_steps add column request_id text;
alter table execution_control.agent_step_attempts add column request_id text;
alter table execution_control.agent_step_results add column request_id text;
alter table execution_control.conversation_run_locks add column request_id text;
alter table execution_control.agent_workflow_starts add column request_id text;
alter table execution_control.agent_run_cancellations add column request_id text;
alter table execution_control.agent_invocation_receipts add column request_id text;

alter table execution_control.agent_runs
add constraint agent_runs_request_id_key unique (request_id);

update execution_control.agent_run_events as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.agent_run_steps as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.agent_step_attempts as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.agent_step_results as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.conversation_run_locks as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.agent_workflow_starts as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.agent_run_cancellations as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

update execution_control.agent_invocation_receipts as child
set request_id = parent.request_id
from execution_control.agent_runs as parent
where child.run_id = parent.run_id;

alter table execution_control.agent_run_events alter column request_id set not null;
alter table execution_control.agent_run_steps alter column request_id set not null;
alter table execution_control.agent_step_attempts alter column request_id set not null;
alter table execution_control.agent_step_results alter column request_id set not null;
alter table execution_control.conversation_run_locks alter column request_id set not null;
alter table execution_control.agent_workflow_starts alter column request_id set not null;
alter table execution_control.agent_run_cancellations alter column request_id set not null;
alter table execution_control.agent_invocation_receipts alter column request_id set not null;

alter table execution_control.agent_run_events
drop constraint agent_run_events_run_id_fkey;
alter table execution_control.agent_run_steps
drop constraint agent_run_steps_run_id_fkey,
drop constraint agent_run_steps_pkey;
alter table execution_control.agent_step_attempts
drop constraint agent_step_attempts_run_id_fkey,
drop constraint agent_step_attempts_run_id_step_id_attempt_key;
alter table execution_control.agent_step_results
drop constraint agent_step_results_run_id_fkey;
alter table execution_control.conversation_run_locks
drop constraint conversation_run_locks_run_id_fkey;
alter table execution_control.agent_workflow_starts
drop constraint agent_workflow_starts_run_id_fkey,
drop constraint agent_workflow_starts_pkey;
alter table execution_control.agent_run_cancellations
drop constraint agent_run_cancellations_run_id_fkey,
drop constraint agent_run_cancellations_pkey;
alter table execution_control.agent_invocation_receipts
drop constraint agent_invocation_receipts_run_id_fkey;
alter table execution_control.agent_runs
drop constraint agent_runs_pkey;

drop index execution_control.agent_runs_request_idx;
drop index execution_control.agent_runs_trace_idx;
drop index execution_control.agent_run_events_run_sequence_idx;
drop index execution_control.agent_run_events_run_occurred_idx;
drop index execution_control.agent_run_steps_run_updated_idx;
drop index execution_control.agent_step_attempts_run_step_idx;
drop index execution_control.agent_step_results_run_step_idx;
drop index execution_control.agent_invocation_receipts_run_idx;

alter table execution_control.agent_run_events drop column run_id;
alter table execution_control.agent_run_steps drop column run_id;
alter table execution_control.agent_step_attempts drop column run_id;
alter table execution_control.agent_step_results drop column run_id;
alter table execution_control.conversation_run_locks drop column run_id;
alter table execution_control.agent_workflow_starts drop column run_id;
alter table execution_control.agent_run_cancellations drop column run_id;
alter table execution_control.agent_invocation_receipts drop column run_id;
alter table execution_control.agent_runs
drop column run_id,
drop column turn_id,
drop column trace_id;

alter table execution_control.agent_runs
add primary key (request_id);

alter table execution_control.agent_run_events
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.agent_run_steps
add primary key (request_id, step_id),
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.agent_step_attempts
add unique (request_id, step_id, attempt),
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.agent_step_results
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.conversation_run_locks
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.agent_workflow_starts
add primary key (request_id),
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.agent_run_cancellations
add primary key (request_id),
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

alter table execution_control.agent_invocation_receipts
add foreign key (request_id)
references execution_control.agent_runs (request_id) on delete cascade;

create unique index agent_run_events_request_sequence_idx
on execution_control.agent_run_events (request_id, sequence);
create index agent_run_events_request_occurred_idx
on execution_control.agent_run_events (request_id, occurred_at);
create index agent_run_steps_request_updated_idx
on execution_control.agent_run_steps (request_id, updated_at);
create index agent_step_results_request_step_idx
on execution_control.agent_step_results (request_id, step_id, created_at);
create index agent_invocation_receipts_request_idx
on execution_control.agent_invocation_receipts (request_id, created_at);
