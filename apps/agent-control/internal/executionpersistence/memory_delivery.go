package executionpersistence

import (
	"context"
	"encoding/json"
	"errors"
	memoryruntime "github.com/MUC-WIKI/campus-agent/packages/memory-api-go"
)

func (s *PostgresRunProjectionStore) PrepareMemoryDelivery(ctx context.Context, owner string, request memoryruntime.AppendConversationTurnRequest) error {
	payload, err := json.Marshal(request)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `insert into agent_control.agent_memory_deliveries(request_id,owner_user_id,payload,status) values($1,$2,$3,'prepared') on conflict do nothing`, request.RequestID, owner, payload)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var equal bool
		err = s.pool.QueryRow(ctx, `select owner_user_id=$2 and (payload=$3::jsonb or status='delivered') from agent_control.agent_memory_deliveries where request_id=$1`, request.RequestID, owner, payload).Scan(&equal)
		if err != nil {
			return err
		}
		if !equal {
			return errors.New("memory append delivery conflicts")
		}
	}
	return nil
}
func (s *PostgresRunProjectionStore) PendingMemoryDeliveries(ctx context.Context) ([]memoryruntime.AppendConversationTurnRequest, error) {
	rows, err := s.pool.Query(ctx, `select payload from agent_control.agent_memory_deliveries where status='ready' order by created_at,request_id limit 32`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []memoryruntime.AppendConversationTurnRequest{}
	for rows.Next() {
		var payload []byte
		if err = rows.Scan(&payload); err != nil {
			return nil, err
		}
		var request memoryruntime.AppendConversationTurnRequest
		if err = json.Unmarshal(payload, &request); err != nil {
			return nil, err
		}
		out = append(out, request)
	}
	return out, rows.Err()
}
func (s *PostgresRunProjectionStore) AcknowledgeMemoryDelivery(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `update agent_control.agent_memory_deliveries set status='delivered',payload=null,accepted_at=now() where request_id=$1 and status='ready'`, id)
	return err
}
