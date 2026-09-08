//go:build postgres_integration

package postgres_test

import (
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/campusdiagnostics"
	"testing"
	"time"
)

func testCampusSearchDiagnostics(t *testing.T, harness *postgresHarness) {
	database, ownerURL := harness.ownerDatabase(t)
	requireSchema(t, ownerURL)
	store := newRunProjectionStore(t, harness.databaseURL(t, database, executionRole, executionPassword), false)
	_, err := store.CreateRun(t.Context(), durableRun("diagnostic-run", "diagnostic-conversation", time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	observation := campusdiagnostics.Observation{
		RequestID: "diagnostic-run", InvocationID: "call", WorkflowStepID: "step", ActivityAttempt: 1,
		SearchQuery: "图书馆", Phase: "selected", At: time.Now(),
		Snapshot: &campusdiagnostics.Snapshot{EffectiveQuery: "图书馆", Candidates: []campusdiagnostics.Candidate{{ResultRef: "result://one", Returned: true}}},
	}
	if err := store.ObserveCampusSearch(t.Context(), observation); err != nil {
		t.Fatal(err)
	}
	observation.Phase = "completed"
	observation.Snapshot = nil
	if err := store.ObserveCampusSearch(t.Context(), observation); err != nil {
		t.Fatal(err)
	}
	// Late queue delivery fills a missing timestamp without regressing completion.
	observation.Phase = "queued"
	if err := store.ObserveCampusSearch(t.Context(), observation); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkCampusSearchCitations(t.Context(), "diagnostic-run", []string{"result://one"}); err != nil {
		t.Fatal(err)
	}
	ops := connect(t, harness.databaseURL(t, database, opsWebRole, opsWebPassword))
	defer closeConn(t, ops)
	var status, phase, query string
	var queued bool
	var cited []string
	err = ops.QueryRow(t.Context(), `select status,current_phase,snapshot_json->>'effectiveQuery',phase_times_json ? 'queued',cited_result_refs from execution_control.agent_campus_search_diagnostics where request_id='diagnostic-run'`).Scan(&status, &phase, &query, &queued, &cited)
	if err != nil {
		t.Fatal(err)
	}
	if status != "completed" || phase != "completed" || query != "图书馆" || !queued || len(cited) != 1 {
		t.Fatalf("invalid merged observation: %s %s %s %v %v", status, phase, query, queued, cited)
	}
	if _, err := ops.Exec(t.Context(), `delete from execution_control.agent_campus_search_diagnostics`); err == nil {
		t.Fatal("ops can delete diagnostics")
	}
	for _, table := range []string{"agent_run_events", "agent_step_results"} {
		if _, err := ops.Exec(t.Context(), `select * from execution_control.`+table+` limit 0`); err == nil {
			t.Fatalf("ops can read %s", table)
		}
	}
	owner := connect(t, ownerURL)
	defer closeConn(t, owner)
	var appCanRead bool
	if err := owner.QueryRow(t.Context(), `select has_any_column_privilege('app_api','execution_control.agent_campus_search_diagnostics','SELECT')`).Scan(&appCanRead); err != nil {
		t.Fatal(err)
	}
	if appCanRead {
		t.Fatal("app_api can read diagnostics")
	}
	if _, err := owner.Exec(t.Context(), `delete from execution_control.agent_runs where request_id='diagnostic-run'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := owner.QueryRow(t.Context(), `select count(*) from execution_control.agent_campus_search_diagnostics`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("diagnostics did not cascade")
	}
}
