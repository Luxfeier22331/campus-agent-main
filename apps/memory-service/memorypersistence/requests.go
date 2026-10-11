package memorypersistence

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"github.com/jackc/pgx/v5"
)

func (s *PostgresStateStore) AcceptRequest(ctx context.Context, r memoryruntime.DurableRequest) (memoryruntime.DurableRequest, error) {
	var value any
	if err := json.Unmarshal(r.Payload, &value); err != nil {
		return r, err
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return r, err
	}
	hash := sha256.Sum256(canonical)
	fingerprint := hex.EncodeToString(hash[:])
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return r, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `insert into memory.personal_memory_owner_fences(owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values($1,1,'active',0,now()) on conflict do nothing`, r.OwnerHash); err != nil {
		return r, err
	}
	var lifecycle string
	if err := tx.QueryRow(ctx, `select lifecycle_state from memory.personal_memory_owner_fences where owner_scope_hash=$1 for update`, r.OwnerHash).Scan(&lifecycle); err != nil {
		return r, err
	}
	if lifecycle == "deleted" {
		return r, memoryruntime.ErrMemoryFenceConflict
	}
	_, err = tx.Exec(ctx, `insert into memory.requests(command_id,kind,owner_scope_hash,input_sha256,payload,status) values($1,$2,$3,$4,$5,'accepted') on conflict do nothing`, r.ID, r.Kind, r.OwnerHash, fingerprint, canonical)
	if err != nil {
		return r, err
	}
	expectedKind, expectedOwner := r.Kind, r.OwnerHash
	var storedHash string
	err = tx.QueryRow(ctx, `select input_sha256,kind,owner_scope_hash,status,created_at,dispatched from memory.requests where command_id=$1`, r.ID).Scan(&storedHash, &r.Kind, &r.OwnerHash, &r.State, &r.CreatedAt, &r.Dispatched)
	if err != nil {
		return r, err
	}
	if storedHash != fingerprint || r.Kind != expectedKind || r.OwnerHash != expectedOwner {
		return r, memoryruntime.ErrRequestConflict
	}
	return r, tx.Commit(ctx)
}
func (s *PostgresStateStore) GetRequest(ctx context.Context, id string) (memoryruntime.DurableRequest, error) {
	r := memoryruntime.DurableRequest{ID: id}
	err := s.pool.QueryRow(ctx, `select kind,owner_scope_hash,payload,status,result,created_at,dispatched from memory.requests where command_id=$1`, id).Scan(&r.Kind, &r.OwnerHash, &r.Payload, &r.State, &r.Result, &r.CreatedAt, &r.Dispatched)
	if errors.Is(err, pgx.ErrNoRows) {
		err = memoryruntime.ErrRequestNotFound
	}
	return r, err
}
func (s *PostgresStateStore) PendingRequests(ctx context.Context, limit int) ([]memoryruntime.DurableRequest, error) {
	rows, err := s.pool.Query(ctx, `select command_id,kind from memory.requests where not dispatched order by created_at,command_id limit $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []memoryruntime.DurableRequest
	for rows.Next() {
		var r memoryruntime.DurableRequest
		if err := rows.Scan(&r.ID, &r.Kind); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *PostgresStateStore) MarkDispatched(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `update memory.requests set dispatched=true where command_id=$1`, id)
	return err
}
func (s *PostgresStateStore) SaveRequestProgress(ctx context.Context, id, state string, result any) error {
	switch state {
	case "running", "processing", "unknown", "succeeded", "completed", "failed", "skipped":
	default:
		return fmt.Errorf("invalid memory state %q", state)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	tag, err := s.pool.Exec(ctx, `update memory.requests set status=$2,result=$3,updated_at=now() where command_id=$1 and status not in ('succeeded','completed','failed','skipped')`, id, state, encoded)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		r, e := s.GetRequest(ctx, id)
		if e != nil {
			return e
		}
		if r.State != state {
			return memoryruntime.ErrRequestConflict
		}
	}
	return nil
}

// ClearRequestInput runs only after provider terminal state and lease cleanup.
// The fingerprint and terminal record remain for duplicate delivery detection.
func (s *PostgresStateStore) ClearRequestInput(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `update memory.requests set payload=null where command_id=$1 and status in ('succeeded','completed','failed','skipped')`, id)
	return err
}

// CommandReady serializes ordinary commands. Erase advances the fence first;
// unstarted commands from retired generations can then terminate without a provider call.
func (s *PostgresStateStore) CommandReady(ctx context.Context, id string) (bool, error) {
	var ready bool
	err := s.pool.QueryRow(ctx, `select
 coalesce(current.payload->>'command_kind' = 'owner_erase', false)
 or (coalesce((current.payload->>'owner_generation')::bigint < fence.generation, false)
     and not exists(select 1 from memory.personal_memory_command_receipts receipt where receipt.command_id=current.command_id))
 or not exists(select 1 from memory.requests earlier
     where earlier.owner_scope_hash=current.owner_scope_hash and earlier.kind='command'
     and earlier.status not in ('succeeded','failed')
     and (earlier.payload->>'owner_sequence')::bigint < (current.payload->>'owner_sequence')::bigint)
 from memory.requests current join memory.personal_memory_owner_fences fence using(owner_scope_hash)
 where current.command_id=$1`, id).Scan(&ready)
	return ready, err
}
