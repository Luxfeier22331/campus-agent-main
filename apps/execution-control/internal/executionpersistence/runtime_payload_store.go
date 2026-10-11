package executionpersistence

import (
	"context"
	"encoding/json"
	"errors"
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
