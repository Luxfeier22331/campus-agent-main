package memoryruntime

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresStateStore struct{ pool *pgxpool.Pool }

type PostgresStateStoreOptions struct {
	DatabaseURL string
}

func NewPostgresStateStore(ctx context.Context, options PostgresStateStoreOptions) (*PostgresStateStore, error) {
	if strings.TrimSpace(options.DatabaseURL) == "" {
		return nil, ErrMemoryStateStoreNotConfigured
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

func (s *PostgresStateStore) BeginCall(ctx context.Context, ownerHash string, callID string, generation int64, sequence int64, subjectHash string, kind string, ttl time.Duration) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var fence memoryFence
	err = tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from execution_control.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		if generation != 1 || sequence != 0 {
			return ErrMemoryFenceConflict
		}
		fence = memoryFence{Generation: 1, Lifecycle: "active", Sequence: 0}
		if _, err := tx.Exec(ctx, `insert into execution_control.personal_memory_owner_fences (owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values ($1,1,'active',0,now())`, ownerHash); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if fence.Generation != generation || fence.Sequence != sequence || fence.Lifecycle != "active" {
		return ErrMemoryFenceConflict
	}
	if _, err := tx.Exec(ctx, `delete from execution_control.personal_memory_call_leases where call_id=$1 and expires_at <= now()`, callID); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `insert into execution_control.personal_memory_call_leases (call_id,owner_scope_hash,generation,owner_sequence,subject_scope_hash,operation_kind,expires_at,created_at) values ($1,$2,$3,$4,$5,$6,$7,now()) on conflict do nothing`, callID, ownerHash, generation, sequence, subjectHash, kind, time.Now().Add(ttl))
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrMemoryFenceConflict
	}
	return tx.Commit(ctx)
}

func (s *PostgresStateStore) EndCall(ctx context.Context, ownerHash string, callID string) error {
	_, err := s.pool.Exec(ctx, `delete from execution_control.personal_memory_call_leases where call_id=$1 and owner_scope_hash=$2`, callID, ownerHash)
	return err
}

func (s *PostgresStateStore) GenerationDrained(ctx context.Context, ownerHash string, generation int64) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `select
		exists(select 1 from execution_control.personal_memory_call_leases where owner_scope_hash=$1 and generation=$2 and expires_at > now())
		or exists(select 1 from execution_control.personal_memory_command_receipts where owner_scope_hash=$1 and generation=$2 and status not in ('succeeded','failed'))`, ownerHash, generation).Scan(&active)
	return !active, err
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
		exists(select 1 from execution_control.personal_memory_call_leases where owner_scope_hash = $1 and expires_at > now())
		or exists(select 1 from execution_control.personal_memory_command_receipts where owner_scope_hash = $1 and status not in ('succeeded', 'failed'))`, ownerHash).Scan(&active); err != nil {
		return err
	}
	if active {
		return ErrMemoryOwnerNotDrained
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

func (s *PostgresStateStore) SubjectDrained(ctx context.Context, ownerHash string, generation int64, subjectHash string, beforeSequence int64) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `select
		exists(select 1 from execution_control.personal_memory_call_leases where owner_scope_hash=$1 and generation=$2 and subject_scope_hash=$3 and owner_sequence < $4 and expires_at > now())
		or exists(select 1 from execution_control.personal_memory_command_receipts where owner_scope_hash=$1 and generation=$2 and subject_scope_hash=$3 and sequence < $4 and status not in ('succeeded','failed'))`, ownerHash, generation, subjectHash, beforeSequence).Scan(&active)
	return !active, err
}

func (s *PostgresStateStore) BeginCommand(ctx context.Context, ownerHash string, command PersonalMemoryCommandRequest, leaseTTL time.Duration) (CommandReceipt, bool, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CommandReceipt{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `insert into execution_control.personal_memory_owner_fences (owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values ($1,1,'active',0,now()) on conflict do nothing`, ownerHash)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	var fence memoryFence
	err = tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from execution_control.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	var receipt CommandReceipt
	err = tx.QueryRow(ctx, `select command_id, owner_scope_hash, generation, sequence, kind, status, error_code, lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope from execution_control.personal_memory_command_receipts where command_id=$1 for update`, command.CommandID).Scan(&receipt.CommandID, &receipt.OwnerScopeHash, &receipt.Generation, &receipt.Sequence, &receipt.Kind, &receipt.Status, &receipt.ErrorCode, &receipt.ProcessingUntil, &receipt.ResultFingerprint, &receipt.SubjectScopeHash, &receipt.SupersessionScope)
	if err == nil {
		if err := validateReceiptIdentity(receipt, ownerHash, command); err != nil {
			return CommandReceipt{}, false, err
		}
		shouldExecute := receipt.Status == "retryable" || (receipt.Status == "processing" && (receipt.ProcessingUntil == nil || time.Now().After(*receipt.ProcessingUntil)))
		if shouldExecute {
			if err := postgresOwnerCommandGate(ctx, tx, ownerHash, command.OwnerSequence, command.CommandID); err != nil {
				return CommandReceipt{}, false, err
			}
			receipt.Status = "processing"
			receipt.ProcessingUntil = commandLeaseDeadline(leaseTTL)
			receipt.ResultFingerprint = ""
			if _, err := tx.Exec(ctx, `update execution_control.personal_memory_command_receipts set status='processing', error_code='', result_fingerprint='', lease_expires_at=$2, updated_at=now(), terminal_at=null where command_id=$1 and status not in ('succeeded','failed')`, receipt.CommandID, receipt.ProcessingUntil); err != nil {
				return CommandReceipt{}, false, err
			}
		}
		if err := tx.Commit(ctx); err != nil {
			return CommandReceipt{}, false, err
		}
		return receipt, shouldExecute, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return CommandReceipt{}, false, err
	}
	if err := postgresOwnerCommandGate(ctx, tx, ownerHash, command.OwnerSequence, command.CommandID); err != nil {
		return CommandReceipt{}, false, err
	}
	if err := applyFenceCommand(&fence, command); err != nil {
		return CommandReceipt{}, false, err
	}
	_, err = tx.Exec(ctx, `update execution_control.personal_memory_owner_fences set generation=$2,lifecycle_state=$3,last_owner_sequence=$4,updated_at=now() where owner_scope_hash=$1`, ownerHash, fence.Generation, fence.Lifecycle, fence.Sequence)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	receipt = CommandReceipt{CommandID: command.CommandID, OwnerScopeHash: ownerHash, Generation: command.OwnerGeneration, Sequence: command.OwnerSequence, Kind: command.CommandKind, ProcessingUntil: commandLeaseDeadline(leaseTTL), Status: "processing", SubjectScopeHash: command.SubjectScopeHash, SupersessionScope: command.SupersessionScope}
	_, err = tx.Exec(ctx, `insert into execution_control.personal_memory_command_receipts (command_id,owner_scope_hash,generation,sequence,kind,status,lease_expires_at,subject_scope_hash,supersession_scope,created_at,updated_at) values ($1,$2,$3,$4,$5,'processing',$6,$7,$8,now(),now())`, receipt.CommandID, receipt.OwnerScopeHash, receipt.Generation, receipt.Sequence, receipt.Kind, receipt.ProcessingUntil, receipt.SubjectScopeHash, receipt.SupersessionScope)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CommandReceipt{}, false, err
	}
	return receipt, true, nil
}

func (s *PostgresStateStore) FinalizeCommand(ctx context.Context, commandID string, ownerHash string, status string, errorCode string, resultFingerprint string, lifecycle string) (CommandReceipt, error) {
	status, errorCode, resultFingerprint, err := validateCommandTerminalResult(status, errorCode, resultFingerprint)
	if err != nil {
		return CommandReceipt{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return CommandReceipt{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var fence memoryFence
	if err := tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from execution_control.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence); err != nil {
		return CommandReceipt{}, err
	}
	var receipt CommandReceipt
	if err := tx.QueryRow(ctx, `select command_id, owner_scope_hash, generation, sequence, kind, status, error_code, lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope from execution_control.personal_memory_command_receipts where command_id=$1 and owner_scope_hash=$2 for update`, commandID, ownerHash).Scan(&receipt.CommandID, &receipt.OwnerScopeHash, &receipt.Generation, &receipt.Sequence, &receipt.Kind, &receipt.Status, &receipt.ErrorCode, &receipt.ProcessingUntil, &receipt.ResultFingerprint, &receipt.SubjectScopeHash, &receipt.SupersessionScope); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CommandReceipt{}, ErrMemoryFenceConflict
		}
		return CommandReceipt{}, err
	}
	if commandReceiptTerminal(receipt.Status) {
		if receipt.Status != status || receipt.ErrorCode != errorCode || receipt.ResultFingerprint != resultFingerprint {
			return CommandReceipt{}, ErrMemoryFenceConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return CommandReceipt{}, err
		}
		return receipt, nil
	}
	command, err := tx.Exec(ctx, `update execution_control.personal_memory_command_receipts set status=$3,error_code=$4,result_fingerprint=$5,lease_expires_at=null,updated_at=now(),terminal_at=now() where command_id=$1 and owner_scope_hash=$2 and status not in ('succeeded','failed')`, commandID, ownerHash, status, errorCode, resultFingerprint)
	if err != nil || command.RowsAffected() != 1 {
		if err != nil {
			return CommandReceipt{}, err
		}
		return CommandReceipt{}, ErrMemoryFenceConflict
	}
	receipt.Status = status
	receipt.ErrorCode = errorCode
	receipt.ProcessingUntil = nil
	receipt.ResultFingerprint = resultFingerprint
	if status == "succeeded" && lifecycle != "" {
		if _, err := tx.Exec(ctx, `update execution_control.personal_memory_owner_fences set lifecycle_state=$2,updated_at=now() where owner_scope_hash=$1`, ownerHash, lifecycle); err != nil {
			return CommandReceipt{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return CommandReceipt{}, err
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
			return ErrMemoryFenceConflict
		}
		if !terminal {
			return ErrMemoryFenceConflict
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
		return ErrMemoryReceiptBlocked
	}
	return nil
}
