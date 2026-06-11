package execution

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestPostgresRunProjectionStoreRequiresDatabaseURL(t *testing.T) {
	_, err := NewPostgresRunProjectionStore(
		context.Background(),
		PostgresRunProjectionStoreOptions{},
	)
	if !errors.Is(err, ErrInvalidRunProjectionStore) {
		t.Fatalf("empty run projection postgres options error = %v, want ErrInvalidRunProjectionStore", err)
	}
}

func TestPostgresRunProjectionStoreSchemaIncludesProjectionTablesOnly(t *testing.T) {
	requiredSnippets := []string{
		"create schema if not exists runtime",
		"create table if not exists runtime.agent_runs",
		"create table if not exists runtime.agent_run_events",
		"create table if not exists runtime.agent_run_steps",
		"create table if not exists runtime.agent_step_attempts",
		"create table if not exists runtime.agent_step_results",
		"create table if not exists runtime.conversation_run_locks",
		"workflow_id text not null default ''",
		"temporal_run_id text not null default ''",
		"activity_id text not null default ''",
		"activity_type text not null default ''",
		"activity_attempt integer not null default 0",
		"scheduled_at timestamptz",
		"schedule_to_start_ms bigint not null default 0",
		"duration_ms bigint not null default 0",
		"provider_request_ref text not null default ''",
		"provider_response_id text not null default ''",
		"model_provider text not null default ''",
		"model_name text not null default ''",
		"input_tokens bigint not null default 0",
		"output_tokens bigint not null default 0",
		"cached_input_tokens bigint not null default 0",
		"estimated_cost_microusd bigint not null default 0",
		"pricing_version text not null default ''",
		"cancel_outcome text not null default ''",
		"timeout_outcome text not null default ''",
		"late_completion_outcome text not null default 'not_late'",
		"fail_close_reason text not null default ''",
		"replan_reason text not null default ''",
		"terminal_reason text not null default ''",
		"unique index if not exists agent_runs_active_conversation_idx",
		"unique index if not exists agent_run_events_run_sequence_idx",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(runProjectionSchemaSQL, snippet) {
			t.Fatalf("run projection schema missing %q", snippet)
		}
	}
	forbiddenSnippets := []string{
		"runtime.execution_leases",
		"runtime.lane_budgets",
		"runtime.worker_heartbeats",
		"execution_leases_active_run_step_idx",
	}
	for _, snippet := range forbiddenSnippets {
		if strings.Contains(runProjectionSchemaSQL, snippet) {
			t.Fatalf("run projection schema must not include retired PG lease artifact %q", snippet)
		}
	}
}

func TestPostgresStepAttemptInsertPlaceholdersMatchArguments(t *testing.T) {
	insertSQL := stepAttemptInsertSQLForTest(t)
	placeholderPattern := regexp.MustCompile(`\$(\d+)`)
	matches := placeholderPattern.FindAllStringSubmatch(insertSQL, -1)
	if len(matches) == 0 {
		t.Fatal("step attempt insert SQL should use positional placeholders")
	}
	maxPlaceholder := 0
	for _, match := range matches {
		value, err := strconv.Atoi(match[1])
		if err != nil {
			t.Fatalf("parse placeholder %q: %v", match[0], err)
		}
		if value > maxPlaceholder {
			maxPlaceholder = value
		}
	}
	if maxPlaceholder != 35 {
		t.Fatalf("step attempt insert placeholders max = %d, want 35 store arguments", maxPlaceholder)
	}
	if strings.Contains(insertSQL, "$36") {
		t.Fatal("step attempt insert SQL must not reference placeholders beyond store arguments")
	}
}

func stepAttemptInsertSQLForTest(t *testing.T) string {
	t.Helper()
	start := strings.Index(runProjectionPostgresStepAttemptUpsertSQL, "insert into runtime.agent_step_attempts")
	if start < 0 {
		t.Fatal("step attempt upsert SQL missing insert statement")
	}
	end := strings.Index(runProjectionPostgresStepAttemptUpsertSQL[start:], "on conflict")
	if end < 0 {
		t.Fatal("step attempt upsert SQL missing on conflict clause")
	}
	return runProjectionPostgresStepAttemptUpsertSQL[start : start+end]
}
