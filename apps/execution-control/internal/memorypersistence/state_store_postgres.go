package memorypersistence

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStateStore struct{ pool *pgxpool.Pool }

type PostgresStateStoreOptions struct {
	DatabaseURL string
}

func NewPostgresStateStore(ctx context.Context, options PostgresStateStoreOptions) (*PostgresStateStore, error) {
	if strings.TrimSpace(options.DatabaseURL) == "" {
		return nil, memoryruntime.ErrMemoryStateStoreNotConfigured
	}
	config, err := pgxpool.ParseConfig(strings.TrimSpace(options.DatabaseURL))
	if err != nil {
		return nil, fmt.Errorf("parse personal memory state database url: %w", err)
	}
	config.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create personal memory state pool: %w", err)
	}
	return &PostgresStateStore{pool: pool}, nil
}

func (s *PostgresStateStore) BeginCall(ctx context.Context, ownerHash string, callID string, generation int64, kind string, ttl time.Duration) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Bootstrap the fence row before reading it: a concurrent creator (another
	// instance admitting the first call or deleting the owner) must not turn
	// this insert into a duplicate key error. The transaction rolls the
	// bootstrap back when the fence check rejects the call.
	if _, err := tx.Exec(ctx, `insert into execution_control.personal_memory_owner_fences (owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values ($1,1,'active',0,now()) on conflict do nothing`, ownerHash); err != nil {
		return err
	}
	var fence memoryruntime.FenceState
	if err := tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from execution_control.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence); err != nil {
		return err
	}
	// A durable append may resume after an owner transition. Only the exact
	// already-admitted call can resume; new calls must still pass the fence.
	if kind == "append" && ttl == 0 {
		var exists bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from execution_control.personal_memory_call_leases where call_id=$1 and owner_scope_hash=$2 and generation=$3 and operation_kind='append' and expires_at is null)`, callID, ownerHash, generation).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return tx.Commit(ctx)
		}
	}
	managementRead := strings.HasPrefix(kind, "management_")
	lifecycleAllowed := fence.Lifecycle == "active" || (managementRead && fence.Lifecycle == "paused")
	if fence.Generation != generation || !lifecycleAllowed {
		return memoryruntime.ErrMemoryFenceConflict
	}
	if _, err := tx.Exec(ctx, `delete from execution_control.personal_memory_call_leases where call_id=$1 and expires_at <= now()`, callID); err != nil {
		return err
	}
	var expiresAt any = time.Now().Add(ttl)
	if kind == "append" && ttl == 0 {
		expiresAt = nil
	}
	command, err := tx.Exec(ctx, `insert into execution_control.personal_memory_call_leases (call_id,owner_scope_hash,generation,operation_kind,expires_at,created_at) values ($1,$2,$3,$4,$5,now()) on conflict do nothing`, callID, ownerHash, generation, kind, expiresAt)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return memoryruntime.ErrMemoryFenceConflict
	}
	return tx.Commit(ctx)
}

func (s *PostgresStateStore) EndCall(ctx context.Context, ownerHash string, callID string) error {
	_, err := s.pool.Exec(ctx, `delete from execution_control.personal_memory_call_leases where call_id=$1 and owner_scope_hash=$2`, callID, ownerHash)
	return err
}

func (s *PostgresStateStore) GetCommand(ctx context.Context, ownerHash string, commandID string) (memoryruntime.CommandReceipt, error) {
	var receipt memoryruntime.CommandReceipt
	err := s.pool.QueryRow(ctx, `
	select command_id, owner_scope_hash, generation, sequence, kind, status, error_code,
		lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope, updated_at
	from execution_control.personal_memory_command_receipts
	where command_id=$1 and owner_scope_hash=$2`, commandID, ownerHash).Scan(
		&receipt.CommandID,
		&receipt.OwnerScopeHash,
		&receipt.Generation,
		&receipt.Sequence,
		&receipt.Kind,
		&receipt.Status,
		&receipt.ErrorCode,
		&receipt.ProcessingUntil,
		&receipt.ResultFingerprint,
		&receipt.SubjectScopeHash,
		&receipt.SupersessionScope,
		&receipt.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryCommandNotFound
	}
	if err != nil {
		return memoryruntime.CommandReceipt{}, err
	}
	return receipt, nil
}

func (s *PostgresStateStore) GenerationDrained(ctx context.Context, ownerHash string, generation int64) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `select
		exists(select 1 from execution_control.personal_memory_call_leases where owner_scope_hash=$1 and generation=$2 and (expires_at is null or expires_at > now()))
		or exists(select 1 from execution_control.personal_memory_command_receipts where owner_scope_hash=$1 and generation=$2 and status not in ('succeeded','failed'))`, ownerHash, generation).Scan(&active)
	return !active, err
}

// ListGenerationAppendCallIDs returns the durable append leases (no expiry)
// still admitted by an older generation. Those leases only clear when their
// append workflow finishes, so an erase waiting on the generation uses them to
// find lost workflows.
func (s *PostgresStateStore) ListGenerationAppendCallIDs(ctx context.Context, ownerHash string, generation int64) ([]string, error) {
	rows, err := s.pool.Query(ctx, `select call_id from execution_control.personal_memory_call_leases where owner_scope_hash=$1 and generation=$2 and operation_kind='append' and expires_at is null order by call_id`, ownerHash, generation)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	callIDs := make([]string, 0)
	for rows.Next() {
		var callID string
		if err := rows.Scan(&callID); err != nil {
			return nil, err
		}
		callIDs = append(callIDs, callID)
	}
	return callIDs, rows.Err()
}

func (s *PostgresStateStore) AbandonStaleGenerationReceipts(ctx context.Context, ownerHash string, generation int64, staleBefore time.Time) (int, error) {
	command, err := s.pool.Exec(ctx, `update execution_control.personal_memory_command_receipts
		set status='failed', error_code='memory_receipt_abandoned',
			result_fingerprint=encode(sha256(convert_to(command_id, 'UTF8') || '\x00'::bytea || convert_to('failed', 'UTF8') || '\x00'::bytea || convert_to('memory_receipt_abandoned', 'UTF8')), 'hex'),
			lease_expires_at=null, updated_at=now(), terminal_at=now()
		where owner_scope_hash=$1 and generation=$2 and status not in ('succeeded','failed') and updated_at < $3`,
		ownerHash, generation, staleBefore)
	if err != nil {
		return 0, err
	}
	return int(command.RowsAffected()), nil
}

func (s *PostgresStateStore) MarkOwnerDeleted(ctx context.Context, ownerHash string) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		insert into execution_control.personal_memory_owner_fences
			(owner_scope_hash, generation, lifecycle_state, last_owner_sequence, updated_at)
		values ($1, 1, 'active', 0, now())
		on conflict (owner_scope_hash) do nothing`, ownerHash); err != nil {
		return err
	}
	var lifecycle string
	if err := tx.QueryRow(ctx, `
		select lifecycle_state
		from execution_control.personal_memory_owner_fences
		where owner_scope_hash = $1
		for update`, ownerHash).Scan(&lifecycle); err != nil {
		return err
	}
	var active bool
	if err := tx.QueryRow(ctx, `select
		exists(select 1 from execution_control.personal_memory_call_leases where owner_scope_hash = $1 and (expires_at is null or expires_at > now()))
		or exists(select 1 from execution_control.personal_memory_command_receipts where owner_scope_hash = $1 and status not in ('succeeded', 'failed'))`, ownerHash).Scan(&active); err != nil {
		return err
	}
	if active {
		return memoryruntime.ErrMemoryOwnerNotDrained
	}
	if _, err := tx.Exec(ctx, `
		insert into execution_control.personal_memory_owner_fences
			(owner_scope_hash, generation, lifecycle_state, last_owner_sequence, updated_at)
		values ($1, 1, 'deleted', 0, now())
		on conflict (owner_scope_hash) do update
		set lifecycle_state = 'deleted', updated_at = now()`, ownerHash); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from execution_control.personal_memory_call_leases where owner_scope_hash = $1`, ownerHash); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `delete from execution_control.personal_memory_command_receipts where owner_scope_hash = $1`, ownerHash); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *PostgresStateStore) BeginCommand(ctx context.Context, ownerHash string, command memoryruntime.PersonalMemoryCommandRequest, leaseTTL time.Duration) (memoryruntime.CommandReceipt, bool, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `insert into execution_control.personal_memory_owner_fences (owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values ($1,1,'active',0,now()) on conflict do nothing`, ownerHash)
	if err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	var fence memoryruntime.FenceState
	err = tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from execution_control.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence)
	if err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	var receipt memoryruntime.CommandReceipt
	err = tx.QueryRow(ctx, `select command_id, owner_scope_hash, generation, sequence, kind, status, error_code, lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope, created_at from execution_control.personal_memory_command_receipts where command_id=$1 for update`, command.CommandID).Scan(&receipt.CommandID, &receipt.OwnerScopeHash, &receipt.Generation, &receipt.Sequence, &receipt.Kind, &receipt.Status, &receipt.ErrorCode, &receipt.ProcessingUntil, &receipt.ResultFingerprint, &receipt.SubjectScopeHash, &receipt.SupersessionScope, &receipt.CreatedAt)
	if err == nil {
		if err := memoryruntime.ValidateReceiptIdentity(receipt, ownerHash, command); err != nil {
			return memoryruntime.CommandReceipt{}, false, err
		}
		shouldExecute := receipt.Status == "retryable" || (receipt.Status == "processing" && (receipt.ProcessingUntil == nil || time.Now().After(*receipt.ProcessingUntil)))
		if shouldExecute {
			if command.CommandKind != "owner_erase" {
				if err := postgresOwnerCommandGate(ctx, tx, ownerHash, command.OwnerSequence, command.CommandID); err != nil {
					return memoryruntime.CommandReceipt{}, false, err
				}
			}
			receipt.Status = "processing"
			receipt.ProcessingUntil = memoryruntime.CommandLeaseDeadline(leaseTTL)
			receipt.ResultFingerprint = ""
			receipt.UpdatedAt = time.Now().UTC()
			if _, err := tx.Exec(ctx, `update execution_control.personal_memory_command_receipts set status='processing', error_code='', result_fingerprint='', lease_expires_at=$2, updated_at=now(), terminal_at=null where command_id=$1 and status not in ('succeeded','failed')`, receipt.CommandID, receipt.ProcessingUntil); err != nil {
				return memoryruntime.CommandReceipt{}, false, err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return memoryruntime.CommandReceipt{}, false, err
		}
		return receipt, shouldExecute, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return memoryruntime.CommandReceipt{}, false, err
	}
	if command.CommandKind != "owner_erase" {
		if err := postgresOwnerCommandGate(ctx, tx, ownerHash, command.OwnerSequence, command.CommandID); err != nil {
			return memoryruntime.CommandReceipt{}, false, err
		}
	}
	if err := memoryruntime.ApplyFenceCommand(&fence, command); err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	_, err = tx.Exec(ctx, `update execution_control.personal_memory_owner_fences set generation=$2,lifecycle_state=$3,last_owner_sequence=$4,updated_at=now() where owner_scope_hash=$1`, ownerHash, fence.Generation, fence.Lifecycle, fence.Sequence)
	if err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	receipt = memoryruntime.CommandReceipt{CommandID: command.CommandID, CreatedAt: time.Now().UTC(), OwnerScopeHash: ownerHash, Generation: command.OwnerGeneration, Sequence: command.OwnerSequence, Kind: command.CommandKind, ProcessingUntil: memoryruntime.CommandLeaseDeadline(leaseTTL), Status: "processing", SubjectScopeHash: command.SubjectScopeHash, SupersessionScope: command.SupersessionScope, UpdatedAt: time.Now().UTC()}
	_, err = tx.Exec(ctx, `insert into execution_control.personal_memory_command_receipts (command_id,owner_scope_hash,generation,sequence,kind,status,lease_expires_at,subject_scope_hash,supersession_scope,created_at,updated_at) values ($1,$2,$3,$4,$5,'processing',$6,$7,$8,now(),now())`, receipt.CommandID, receipt.OwnerScopeHash, receipt.Generation, receipt.Sequence, receipt.Kind, receipt.ProcessingUntil, receipt.SubjectScopeHash, receipt.SupersessionScope)
	if err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	return receipt, true, nil
}

func (s *PostgresStateStore) FinalizeCommand(ctx context.Context, commandID string, ownerHash string, status string, errorCode string, resultFingerprint string, lifecycle string) (memoryruntime.CommandReceipt, error) {
	status, errorCode, resultFingerprint, err := memoryruntime.ValidateCommandTerminalResult(status, errorCode, resultFingerprint)
	if err != nil {
		return memoryruntime.CommandReceipt{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return memoryruntime.CommandReceipt{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var fence memoryruntime.FenceState
	if err := tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from execution_control.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryCommandNotFound
		}
		return memoryruntime.CommandReceipt{}, err
	}
	var receipt memoryruntime.CommandReceipt
	if err := tx.QueryRow(ctx, `select command_id, owner_scope_hash, generation, sequence, kind, status, error_code, lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope from execution_control.personal_memory_command_receipts where command_id=$1 and owner_scope_hash=$2 for update`, commandID, ownerHash).Scan(&receipt.CommandID, &receipt.OwnerScopeHash, &receipt.Generation, &receipt.Sequence, &receipt.Kind, &receipt.Status, &receipt.ErrorCode, &receipt.ProcessingUntil, &receipt.ResultFingerprint, &receipt.SubjectScopeHash, &receipt.SupersessionScope); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryCommandNotFound
		}
		return memoryruntime.CommandReceipt{}, err
	}
	if memoryruntime.CommandReceiptTerminal(receipt.Status) {
		if receipt.Status != status || receipt.ErrorCode != errorCode || receipt.ResultFingerprint != resultFingerprint {
			return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryFenceConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return memoryruntime.CommandReceipt{}, err
		}
		return receipt, nil
	}
	command, err := tx.Exec(ctx, `update execution_control.personal_memory_command_receipts set status=$3,error_code=$4,result_fingerprint=$5,lease_expires_at=null,updated_at=now(),terminal_at=now() where command_id=$1 and owner_scope_hash=$2 and status not in ('succeeded','failed')`, commandID, ownerHash, status, errorCode, resultFingerprint)
	if err != nil || command.RowsAffected() != 1 {
		if err != nil {
			return memoryruntime.CommandReceipt{}, err
		}
		return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryFenceConflict
	}
	receipt.Status = status
	receipt.ErrorCode = errorCode
	receipt.ProcessingUntil = nil
	receipt.ResultFingerprint = resultFingerprint
	if status == "succeeded" && lifecycle != "" {
		if _, err := tx.Exec(ctx, `update execution_control.personal_memory_owner_fences set lifecycle_state=$2,updated_at=now() where owner_scope_hash=$1`, ownerHash, lifecycle); err != nil {
			return memoryruntime.CommandReceipt{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return memoryruntime.CommandReceipt{}, err
	}
	return receipt, nil
}

func (s *PostgresStateStore) MarkCommandRetryable(ctx context.Context, commandID string, ownerHash string) error {
	command, err := s.pool.Exec(ctx, `update execution_control.personal_memory_command_receipts set status='retryable',error_code='',result_fingerprint='',lease_expires_at=null,updated_at=now(),terminal_at=null where command_id=$1 and owner_scope_hash=$2 and status not in ('succeeded','failed')`, commandID, ownerHash)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		var terminal bool
		if err := s.pool.QueryRow(ctx, `select status in ('succeeded','failed') from execution_control.personal_memory_command_receipts where command_id=$1 and owner_scope_hash=$2`, commandID, ownerHash).Scan(&terminal); err != nil {
			return memoryruntime.ErrMemoryFenceConflict
		}
		if !terminal {
			return memoryruntime.ErrMemoryFenceConflict
		}
	}
	return nil
}

func (s *PostgresStateStore) HealthCheck(ctx context.Context) error {
	for _, table := range []string{"execution_control.personal_memory_owner_fences", "execution_control.personal_memory_call_leases", "execution_control.personal_memory_command_receipts"} {
		if _, err := s.pool.Exec(ctx, "select 1 from "+table+" limit 0"); err != nil {
			return fmt.Errorf("read personal memory state table %s: %w", table, err)
		}
	}
	return nil
}

func (s *PostgresStateStore) Close() {
	if s != nil && s.pool != nil {
		s.pool.Close()
	}
}

func postgresOwnerCommandGate(ctx context.Context, tx pgx.Tx, ownerHash string, sequence int64, commandID string) error {
	var blocked bool
	if err := tx.QueryRow(ctx, `select exists(
		select 1 from execution_control.personal_memory_command_receipts
		where owner_scope_hash=$1 and sequence < $2 and command_id <> $3
		and status not in ('succeeded','failed')
	)`, ownerHash, sequence, commandID).Scan(&blocked); err != nil {
		return err
	}
	if blocked {
		return memoryruntime.ErrMemoryReceiptBlocked
	}
	return nil
}
