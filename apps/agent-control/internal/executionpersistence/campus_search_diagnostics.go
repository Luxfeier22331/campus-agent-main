package executionpersistence

import (
	"context"
	"encoding/json"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/campusdiagnostics"
)

func (s *PostgresRunProjectionStore) ObserveCampusSearch(ctx context.Context, o campusdiagnostics.Observation) error {
	phaseTimes := make(map[string]any, len(o.PhaseTimes)+1)
	for phase, at := range o.PhaseTimes {
		phaseTimes[phase] = at.UTC()
	}
	phaseTimes[o.Phase] = o.At.UTC()
	times, err := json.Marshal(phaseTimes)
	if err != nil {
		return err
	}
	snapshot := []byte(`{}`)
	if o.Snapshot != nil {
		snapshot, err = json.Marshal(o.Snapshot)
		if err != nil {
			return err
		}
	}
	_, err = s.pool.Exec(ctx, `
INSERT INTO agent_control.agent_campus_search_diagnostics AS d
 (schema_version, request_id, invocation_id, workflow_step_id, activity_attempt, search_query,
 status, current_phase, phase_rank, phase_times_json, snapshot_json, failure_code, http_status)
VALUES (2,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,nullif($11,''),$12)
ON CONFLICT (request_id, invocation_id) DO UPDATE SET
 phase_times_json = excluded.phase_times_json || d.phase_times_json,
 snapshot_json = CASE WHEN excluded.snapshot_json <> '{}'::jsonb AND
   (d.snapshot_json = '{}'::jsonb OR excluded.phase_rank >= d.phase_rank)
   THEN excluded.snapshot_json ELSE d.snapshot_json END,
 current_phase = CASE WHEN d.phase_rank < excluded.phase_rank THEN excluded.current_phase ELSE d.current_phase END,
 status = CASE WHEN d.status = 'running' THEN excluded.status ELSE d.status END,
 phase_rank = greatest(d.phase_rank, excluded.phase_rank),
 failure_code = coalesce(d.failure_code, excluded.failure_code),
 http_status = coalesce(d.http_status, excluded.http_status), updated_at = now()
WHERE d.workflow_step_id = excluded.workflow_step_id AND d.activity_attempt = excluded.activity_attempt`,
		o.RequestID, o.InvocationID, o.WorkflowStepID, o.ActivityAttempt, o.SearchQuery, o.Status(), o.Phase, o.Rank(), times, snapshot, o.FailureCode, o.HTTPStatus)
	return err
}

func (s *PostgresRunProjectionStore) MarkCampusSearchCitations(ctx context.Context, requestID string, refs []string) error {
	if refs == nil {
		refs = []string{}
	}
	_, err := s.pool.Exec(ctx, `UPDATE agent_control.agent_campus_search_diagnostics
 SET cited_result_refs = $2, updated_at = now() WHERE request_id = $1`, requestID, refs)
	return err
}
