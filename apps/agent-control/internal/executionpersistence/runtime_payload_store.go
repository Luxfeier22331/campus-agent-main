package executionpersistence

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

func (s *PostgresRunProjectionStore) PutRuntimePayload(ctx context.Context, requestID, ref string, payload json.RawMessage) error {
	tag, err := s.pool.Exec(ctx, `insert into execution_control.agent_runtime_payloads(request_id,payload_ref,payload) values($1,$2,$3) on conflict do nothing`, requestID, ref, payload)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var equal bool
		if err = s.pool.QueryRow(ctx, `select payload=$3::jsonb from execution_control.agent_runtime_payloads where request_id=$1 and payload_ref=$2`, requestID, ref, payload).Scan(&equal); err != nil {
			return err
		}
		if !equal {
			return errors.New("runtime payload identity conflict")
		}
	}
	return nil
}
func (s *PostgresRunProjectionStore) GetRuntimePayload(ctx context.Context, requestID, ref string) (json.RawMessage, error) {
	var out json.RawMessage
	err := s.pool.QueryRow(ctx, `select payload from execution_control.agent_runtime_payloads where request_id=$1 and payload_ref=$2`, requestID, ref).Scan(&out)
	return out, err
}

func (s *PostgresRunProjectionStore) ListTerminalRuntimePayloads(ctx context.Context, after string, limit int) ([]execution.RuntimePayloadExecution, error) {
	rows, err := s.pool.Query(ctx, `select r.request_id,coalesce(w.workflow_id,''),coalesce(w.temporal_run_id,'')
 from execution_control.agent_runs r
 left join execution_control.agent_workflow_starts w using(request_id)
 where r.request_id>$1 and r.status in ('completed','failed','canceled','expired')
 and exists(select 1 from execution_control.agent_runtime_payloads p where p.request_id=r.request_id)
 and (r.status<>'completed' or exists(select 1 from execution_control.agent_run_events e where e.request_id=r.request_id and e.event_id=r.request_id||':run-completed'))
 order by r.request_id limit $2`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []execution.RuntimePayloadExecution{}
	for rows.Next() {
		var item execution.RuntimePayloadExecution
		if err = rows.Scan(&item.RequestID, &item.WorkflowID, &item.TemporalRunID); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func (s *PostgresRunProjectionStore) DeleteRuntimePayloads(ctx context.Context, requestID string) error {
	_, err := s.pool.Exec(ctx, `delete from execution_control.agent_runtime_payloads p using execution_control.agent_runs r
 where p.request_id=$1 and r.request_id=p.request_id and r.status in ('completed','failed','canceled','expired')
 and (r.status<>'completed' or exists(select 1 from execution_control.agent_run_events e where e.request_id=r.request_id and e.event_id=r.request_id||':run-completed'))`, requestID)
	return err
}
