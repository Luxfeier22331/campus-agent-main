//go:build postgres_integration

package postgres_test

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/campusdiagnostics"
)

func testCampusSearchDiagnostics(t *testing.T, harness *postgresHarness) {
	database, ownerURL := harness.ownerDatabase(t)
	requireSchema(t, ownerURL)
	store := newRunProjectionStore(t, harness.databaseURL(t, database, executionRole, executionPassword), false)
	_, err := store.CreateRun(t.Context(), durableRun("diagnostic-run", "diagnostic-conversation", time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	started := time.Date(2026, 10, 3, 1, 0, 0, 0, time.UTC)
	phaseTimes := map[string]time.Time{}
	for offset, phase := range []string{"index_loaded", "embedded", "retrieved", "reranked", "selected"} {
		phaseTimes[phase] = started.Add(time.Duration(offset) * time.Second)
	}
	observation := campusdiagnostics.Observation{
		RequestID: "diagnostic-run", InvocationID: "call", WorkflowStepID: "step", ActivityAttempt: 1,
		SearchQuery: "图书馆", Phase: "completed", At: started.Add(5 * time.Second), PhaseTimes: phaseTimes,
		Snapshot: &campusdiagnostics.Snapshot{EffectiveQuery: "图书馆", Candidates: []campusdiagnostics.Candidate{{ResultRef: "result://one", Returned: true}}},
	}
	if err := store.ObserveCampusSearch(t.Context(), observation); err != nil {
		t.Fatal(err)
	}
	observation.Phase = "completed"
	observation.Snapshot = nil
	observation.PhaseTimes = nil
	if err := store.ObserveCampusSearch(t.Context(), observation); err != nil {
		t.Fatal(err)
	}
	// Late queue delivery fills a missing timestamp without regressing completion.
	observation.Phase = "queued"
	observation.At = started.Add(-time.Second)
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
	var schemaVersion int
	var cited []string
	err = ops.QueryRow(t.Context(), `select status,current_phase,snapshot_json->>'effectiveQuery',phase_times_json ? 'queued',cited_result_refs,schema_version from agent_control.agent_campus_search_diagnostics where request_id='diagnostic-run'`).Scan(&status, &phase, &query, &queued, &cited, &schemaVersion)
	if err != nil {
		t.Fatal(err)
	}
	if schemaVersion != 2 || status != "completed" || phase != "completed" || query != "图书馆" || !queued || len(cited) != 1 {
		t.Fatalf("invalid merged observation: %s %s %s %v %v", status, phase, query, queued, cited)
	}
	var rawPhaseTimes []byte
	if err := ops.QueryRow(t.Context(), `select phase_times_json from agent_control.agent_campus_search_diagnostics where request_id='diagnostic-run'`).Scan(&rawPhaseTimes); err != nil {
		t.Fatal(err)
	}
	var storedPhaseTimes map[string]time.Time
	if err := json.Unmarshal(rawPhaseTimes, &storedPhaseTimes); err != nil {
		t.Fatal(err)
	}
	phaseTimes["queued"] = started.Add(-time.Second)
	phaseTimes["completed"] = started.Add(5 * time.Second)
	if !reflect.DeepEqual(storedPhaseTimes, phaseTimes) {
		t.Fatalf("phase completion times changed during persistence: %#v", storedPhaseTimes)
	}
	if _, err := ops.Exec(t.Context(), `delete from agent_control.agent_campus_search_diagnostics`); err == nil {
		t.Fatal("ops can delete diagnostics")
	}
	for _, table := range []string{"agent_run_events", "agent_step_results"} {
		if _, err := ops.Exec(t.Context(), `select * from agent_control.`+table+` limit 0`); err == nil {
			t.Fatalf("ops can read %s", table)
		}
	}
	owner := connect(t, ownerURL)
	defer closeConn(t, owner)
	if _, err := owner.Exec(t.Context(), `update agent_control.agent_campus_search_diagnostics set schema_version=1 where request_id='diagnostic-run'`); err == nil {
		t.Fatal("retired diagnostic schema accepted")
	}
	var appCanRead bool
	if err := owner.QueryRow(t.Context(), `select has_any_column_privilege('app_api','agent_control.agent_campus_search_diagnostics','SELECT')`).Scan(&appCanRead); err != nil {
		t.Fatal(err)
	}
	if appCanRead {
		t.Fatal("app_api can read diagnostics")
	}
	if _, err := owner.Exec(t.Context(), `delete from agent_control.agent_runs where request_id='diagnostic-run'`); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := owner.QueryRow(t.Context(), `select count(*) from agent_control.agent_campus_search_diagnostics`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("diagnostics did not cascade")
	}
}
