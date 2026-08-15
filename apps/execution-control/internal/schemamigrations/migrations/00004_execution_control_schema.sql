-- +goose Up
create schema execution_control;

alter table runtime.agent_runs set schema execution_control;
alter table runtime.agent_run_events set schema execution_control;
alter table runtime.agent_run_steps set schema execution_control;
alter table runtime.agent_step_attempts set schema execution_control;
alter table runtime.agent_step_results set schema execution_control;
alter table runtime.conversation_run_locks set schema execution_control;
alter table runtime.agent_workflow_starts set schema execution_control;
alter table runtime.agent_run_cancellations set schema execution_control;
alter table runtime.agent_invocation_receipts set schema execution_control;
alter table runtime.personal_memory_owner_fences set schema execution_control;
alter table runtime.personal_memory_call_leases set schema execution_control;
alter table runtime.personal_memory_command_receipts set schema execution_control;
alter table execution_config.model_settings set schema execution_control;

-- OFFSET 0 keeps the temporary compatibility views read-only even for their owner.
create view runtime.agent_runs as
select * from execution_control.agent_runs offset 0; -- noqa: AM04
create view runtime.agent_run_events as
select * from execution_control.agent_run_events offset 0; -- noqa: AM04
create view runtime.agent_run_steps as
select * from execution_control.agent_run_steps offset 0; -- noqa: AM04
create view runtime.agent_step_attempts as
select * from execution_control.agent_step_attempts offset 0; -- noqa: AM04
create view runtime.agent_step_results as
select * from execution_control.agent_step_results offset 0; -- noqa: AM04
create view runtime.conversation_run_locks as
select * from execution_control.conversation_run_locks offset 0; -- noqa: AM04
create view runtime.agent_workflow_starts as
select * from execution_control.agent_workflow_starts offset 0; -- noqa: AM04
create view runtime.agent_run_cancellations as
select * from execution_control.agent_run_cancellations offset 0; -- noqa: AM04
create view runtime.agent_invocation_receipts as
select * from execution_control.agent_invocation_receipts offset 0; -- noqa: AM04
create view runtime.personal_memory_owner_fences as
select * from execution_control.personal_memory_owner_fences offset 0; -- noqa: AM04
create view runtime.personal_memory_call_leases as
select * from execution_control.personal_memory_call_leases offset 0; -- noqa: AM04
create view runtime.personal_memory_command_receipts as
select * from execution_control.personal_memory_command_receipts offset 0; -- noqa: AM04
create view execution_config.model_settings as
select * from execution_control.model_settings offset 0; -- noqa: AM04

-- +goose Down
drop view execution_config.model_settings;
drop view runtime.personal_memory_command_receipts;
drop view runtime.personal_memory_call_leases;
drop view runtime.personal_memory_owner_fences;
drop view runtime.agent_invocation_receipts;
drop view runtime.agent_run_cancellations;
drop view runtime.agent_workflow_starts;
drop view runtime.conversation_run_locks;
drop view runtime.agent_step_results;
drop view runtime.agent_step_attempts;
drop view runtime.agent_run_steps;
drop view runtime.agent_run_events;
drop view runtime.agent_runs;

alter table execution_control.model_settings set schema execution_config;
alter table execution_control.personal_memory_command_receipts set schema runtime;
alter table execution_control.personal_memory_call_leases set schema runtime;
alter table execution_control.personal_memory_owner_fences set schema runtime;
alter table execution_control.agent_invocation_receipts set schema runtime;
alter table execution_control.agent_run_cancellations set schema runtime;
alter table execution_control.agent_workflow_starts set schema runtime;
alter table execution_control.conversation_run_locks set schema runtime;
alter table execution_control.agent_step_results set schema runtime;
alter table execution_control.agent_step_attempts set schema runtime;
alter table execution_control.agent_run_steps set schema runtime;
alter table execution_control.agent_run_events set schema runtime;
alter table execution_control.agent_runs set schema runtime;

drop schema execution_control;
