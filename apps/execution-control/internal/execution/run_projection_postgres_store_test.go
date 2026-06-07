package execution

import (
	"context"
	"errors"
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
		"unique index if not exists agent_runs_active_conversation_idx",
		"unique index if not exists agent_run_events_run_sequence_idx",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(durableRuntimeSchemaSQL, snippet) {
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
		if strings.Contains(durableRuntimeSchemaSQL, snippet) {
			t.Fatalf("run projection schema must not include retired PG lease artifact %q", snippet)
		}
	}
}
