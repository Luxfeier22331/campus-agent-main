package execution

import (
	"context"
	"fmt"
)

const executionControlDatabaseRole = "execution_control"

var runProjectionRuntimeTables = []string{
	"runtime.agent_runs",
	"runtime.agent_run_events",
	"runtime.agent_run_steps",
	"runtime.agent_step_attempts",
	"runtime.agent_step_results",
	"runtime.conversation_run_locks",
	"runtime.agent_workflow_starts",
	"runtime.agent_run_cancellations",
	"runtime.agent_run_cleanups",
	"runtime.agent_invocation_receipts",
}

var personalMemoryRuntimeTables = []string{
	"runtime.personal_memory_owner_fences",
	"runtime.personal_memory_call_leases",
	"runtime.personal_memory_command_receipts",
}

var executionControlRuntimeTables = append(
	append([]string{}, runProjectionRuntimeTables...),
	personalMemoryRuntimeTables...,
)

const executionControlRuntimeGrantSQL = `
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
	runtime.agent_run_cleanups,
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
	runtime.agent_run_cleanups,
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

func (s *PostgresRunProjectionStore) InstallRuntimeRoleGrants(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("run projection store is not configured")
	}
	if _, err := s.pool.Exec(ctx, executionControlRuntimeGrantSQL); err != nil {
		return fmt.Errorf("install execution-control runtime grants: %w", err)
	}
	return nil
}

func (s *PostgresRunProjectionStore) CheckRuntimeRoleGrants(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("run projection store is not configured")
	}

	var usage, create bool
	if err := s.pool.QueryRow(
		ctx,
		"select has_schema_privilege($1,'runtime','USAGE'), has_schema_privilege($1,'runtime','CREATE')",
		executionControlDatabaseRole,
	).Scan(&usage, &create); err != nil {
		return fmt.Errorf("inspect execution-control runtime schema grants: %w", err)
	}
	if !usage || create {
		return fmt.Errorf(
			"database role %s runtime schema privileges usage=%t create=%t, want usage=true create=false",
			executionControlDatabaseRole,
			usage,
			create,
		)
	}

	for _, table := range executionControlRuntimeTables {
		for _, privilege := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
			if err := s.requireTablePrivilege(ctx, table, privilege, true); err != nil {
				return err
			}
		}
		for _, privilege := range []string{"TRUNCATE", "REFERENCES", "TRIGGER"} {
			if err := s.requireTablePrivilege(ctx, table, privilege, false); err != nil {
				return err
			}
		}
	}

	var productFactExists bool
	if err := s.pool.QueryRow(
		ctx,
		"select to_regclass('runtime.request_observability_fact') is not null",
	).Scan(&productFactExists); err != nil {
		return fmt.Errorf("inspect request observability fact presence: %w", err)
	}
	if productFactExists {
		for _, privilege := range []string{
			"SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
		} {
			if err := s.requireTablePrivilege(
				ctx,
				"runtime.request_observability_fact",
				privilege,
				false,
			); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *PostgresRunProjectionStore) requireTablePrivilege(
	ctx context.Context,
	table string,
	privilege string,
	want bool,
) error {
	var granted bool
	if err := s.pool.QueryRow(
		ctx,
		"select has_table_privilege($1,$2,$3)",
		executionControlDatabaseRole,
		table,
		privilege,
	).Scan(&granted); err != nil {
		return fmt.Errorf(
			"inspect database role %s %s on %s: %w",
			executionControlDatabaseRole,
			privilege,
			table,
			err,
		)
	}
	if granted != want {
		return fmt.Errorf(
			"database role %s %s on %s = %t, want %t",
			executionControlDatabaseRole,
			privilege,
			table,
			granted,
			want,
		)
	}
	return nil
}
