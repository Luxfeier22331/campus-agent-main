package execution

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
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

func TestPostgresRunProjectionStoreDefersConnectivityToHealthCheck(t *testing.T) {
	store, err := NewPostgresRunProjectionStore(
		context.Background(),
		PostgresRunProjectionStoreOptions{
			DatabaseURL: "postgres://campus_agent:secret@127.0.0.1:1/campus_agent?sslmode=disable",
		},
	)
	if err != nil {
		t.Fatalf("NewPostgresRunProjectionStore returned error: %v", err)
	}
	defer store.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	if err := store.HealthCheck(ctx); err == nil {
		t.Fatal("HealthCheck returned nil error for unavailable Postgres")
	}
}

func TestPostgresRunProjectionHealthCheckInspectsRequiredSchemaShape(t *testing.T) {
	requiredSnippets := []string{
		"join pg_attribute as attribute",
		"left join pg_attrdef as attribute_default",
		"pg_get_expr(attribute_default.adbin, attribute_default.adrelid)",
		"from pg_constraint as constraint_metadata",
		"constraint_metadata.convalidated",
		"constraint_metadata.confdeltype",
		"from pg_index as index_metadata",
		"index_metadata.indisunique",
		"index_metadata.indisvalid",
		"index_metadata.indisready",
		"index_metadata.indnatts = index_metadata.indnkeyatts",
		"pg_get_indexdef(index_metadata.indexrelid, key_position, true)",
		"pg_get_expr(index_metadata.indpred, index_metadata.indrelid)",
		"('agent_runs', 'request_fingerprint_sha256', 'text', true, $$''::text$$)",
		"('agent_run_steps', 'activity_attempt', 'integer', true, '0')",
		"('agent_step_attempts', 'activity_attempt', 'integer', true, '0')",
		"('agent_workflow_starts', 'dispatch_attempted', 'boolean', true, 'false')",
		"('agent_run_steps', 'p', array['run_id', 'step_id']::text[]",
		"('agent_run_steps', 'f', array['run_id']::text[], 'runtime', 'agent_runs'",
		"('agent_step_attempts', 'p', array['attempt_id']::text[]",
		"('agent_step_attempts', 'u', array['run_id', 'step_id', 'attempt']::text[]",
		"('agent_step_attempts', 'f', array['run_id']::text[], 'runtime', 'agent_runs'",
		"('agent_step_results', 'p', array['result_id']::text[]",
		"('agent_step_results', 'f', array['run_id']::text[], 'runtime', 'agent_runs'",
		"('agent_workflow_starts', 'u', array['workflow_id']::text[]",
		"'agent_runs_active_conversation_idx'",
		"'agent_workflow_starts_lease_idx'",
		"'agent_run_cancellations_lease_idx'",
		"'agent_invocation_receipts_run_idx'",
		"status=anyarray['created'::text,'queued'::text,'admitted'::text,'running'::text,'streaming'::text]",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(runProjectionSchemaHealthSQL, snippet) {
			t.Fatalf("run projection health SQL missing %q", snippet)
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
	if maxPlaceholder != 34 {
		t.Fatalf("step attempt insert placeholders max = %d, want 34 store arguments", maxPlaceholder)
	}
	if len(matches) != 34 {
		t.Fatalf("step attempt insert references %d placeholders, want one for each of 34 store arguments", len(matches))
	}
	seen := make(map[string]struct{}, len(matches))
	for _, match := range matches {
		if _, exists := seen[match[1]]; exists {
			t.Fatalf("step attempt insert repeats placeholder %s", match[0])
		}
		seen[match[1]] = struct{}{}
	}
	if strings.Contains(insertSQL, "$35") {
		t.Fatal("step attempt insert SQL must not reference placeholders beyond store arguments")
	}
}

func TestFinalizationAttemptSelectIncludesUsageFields(t *testing.T) {
	for _, column := range []string{"model_request_count", "usage_observed"} {
		if !strings.Contains(finalizationAttemptSelectSQL, column) {
			t.Fatalf("finalization attempt select SQL missing %q", column)
		}
	}
}

func TestPostgresRunStepUpsertSQLFencesAttemptAndTerminalState(t *testing.T) {
	requiredSnippets := []string{
		"on conflict (run_id, step_id) do update set",
		"runtime.agent_run_steps.activity_attempt <= excluded.activity_attempt",
		"runtime.agent_run_steps.activity_attempt = excluded.activity_attempt",
		"lower(btrim(runtime.agent_run_steps.status)) in ('completed', 'failed', 'blocked', 'canceled', 'expired', 'skipped')",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(runProjectionPostgresRunStepUpsertSQL, snippet) {
			t.Fatalf("run step upsert SQL missing monotonic fence %q", snippet)
		}
	}
}

func TestPostgresStepAttemptUpsertSQLFencesIdentityAttemptAndTerminalState(t *testing.T) {
	requiredSnippets := []string{
		"runtime.agent_step_attempts.run_id = excluded.run_id",
		"runtime.agent_step_attempts.step_id = excluded.step_id",
		"runtime.agent_step_attempts.attempt = excluded.attempt",
		"runtime.agent_step_attempts.activity_attempt <= excluded.activity_attempt",
		"lower(btrim(runtime.agent_step_attempts.status)) not in ('completed', 'failed', 'blocked', 'canceled', 'expired', 'skipped')",
	}
	for _, snippet := range requiredSnippets {
		if !strings.Contains(runProjectionPostgresStepAttemptUpsertSQL, snippet) {
			t.Fatalf("step attempt upsert SQL missing monotonic fence %q", snippet)
		}
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

func TestStepAttemptUpsertDoesNotDowngradeObservedUsage(t *testing.T) {
	required := []string{
		"when excluded.usage_observed then excluded.model_request_count",
		"when excluded.usage_observed then excluded.input_tokens",
		"when excluded.usage_observed then excluded.output_tokens",
		"when excluded.usage_observed then excluded.cached_input_tokens",
		"usage_observed = runtime.agent_step_attempts.usage_observed or excluded.usage_observed",
	}
	for _, fragment := range required {
		if !strings.Contains(runProjectionPostgresStepAttemptUpsertSQL, fragment) {
			t.Fatalf("step attempt upsert SQL must preserve observed usage with %q", fragment)
		}
	}
}
