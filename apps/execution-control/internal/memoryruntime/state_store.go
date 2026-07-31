package memoryruntime

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrMemoryFenceConflict           = errors.New("personal memory fence conflict")
	ErrMemoryReceiptBlocked          = errors.New("personal memory command is blocked by an earlier unresolved receipt")
	ErrMemoryStateStoreNotConfigured = errors.New("personal memory state store not configured")
)

type CommandReceipt struct {
	CommandID         string
	ErrorCode         string
	Generation        int64
	Kind              string
	OwnerScopeHash    string
	ProcessingUntil   *time.Time
	ResultFingerprint string
	Sequence          int64
	Status            string
	SubjectScopeHash  string
	SupersessionScope string
}

type StateStore interface {
	BeginCall(context.Context, string, string, int64, int64, string, string, time.Duration) error
	BeginCommand(context.Context, string, PersonalMemoryCommandRequest, time.Duration) (CommandReceipt, bool, error)
	EndCall(context.Context, string, string) error
	FinalizeCommand(context.Context, string, string, string, string, string, string) (CommandReceipt, error)
	GenerationDrained(context.Context, string, int64) (bool, error)
	HealthCheck(context.Context) error
	MarkCommandRetryable(context.Context, string, string) error
	SubjectDrained(context.Context, string, int64, string, int64) (bool, error)
}

type InMemoryStateStore struct {
	mu       sync.Mutex
	fences   map[string]memoryFence
	receipts map[string]CommandReceipt
	leases   map[string]memoryCallLease
}

type memoryCallLease struct {
	ExpiresAt        time.Time
	Generation       int64
	OwnerSequence    int64
	OwnerScopeHash   string
	SubjectScopeHash string
}

type memoryFence struct {
	Generation int64
	Lifecycle  string
	Sequence   int64
}

func NewInMemoryStateStore() *InMemoryStateStore {
	return &InMemoryStateStore{fences: map[string]memoryFence{}, leases: map[string]memoryCallLease{}, receipts: map[string]CommandReceipt{}}
}

func (s *InMemoryStateStore) BeginCall(_ context.Context, ownerHash string, callID string, generation int64, sequence int64, subjectHash string, _ string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	fence, ok := s.fences[ownerHash]
	if !ok {
		if generation != 1 || sequence != 0 {
			return ErrMemoryFenceConflict
		}
		fence = memoryFence{Generation: 1, Lifecycle: "active", Sequence: 0}
		s.fences[ownerHash] = fence
	}
	if fence.Generation != generation || fence.Sequence != sequence || fence.Lifecycle != "active" {
		return ErrMemoryFenceConflict
	}
	if existing, ok := s.leases[callID]; ok && time.Now().Before(existing.ExpiresAt) {
		return ErrMemoryFenceConflict
	}
	s.leases[callID] = memoryCallLease{ExpiresAt: time.Now().Add(ttl), Generation: generation, OwnerSequence: sequence, OwnerScopeHash: ownerHash, SubjectScopeHash: subjectHash}
	return nil
}

func (s *InMemoryStateStore) EndCall(_ context.Context, ownerHash string, callID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if lease, ok := s.leases[callID]; ok && lease.OwnerScopeHash == ownerHash {
		delete(s.leases, callID)
	}
	return nil
}

func (s *InMemoryStateStore) GenerationDrained(_ context.Context, ownerHash string, generation int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for callID, lease := range s.leases {
		if now.After(lease.ExpiresAt) {
			delete(s.leases, callID)
			continue
		}
		if lease.OwnerScopeHash == ownerHash && lease.Generation == generation {
			return false, nil
		}
	}
	for _, receipt := range s.receipts {
		if receipt.OwnerScopeHash == ownerHash && receipt.Generation == generation && !commandReceiptTerminal(receipt.Status) {
			return false, nil
		}
	}
	return true, nil
}

func (s *InMemoryStateStore) SubjectDrained(_ context.Context, ownerHash string, generation int64, subjectHash string, beforeSequence int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for callID, lease := range s.leases {
		if now.After(lease.ExpiresAt) {
			delete(s.leases, callID)
			continue
		}
		if lease.OwnerScopeHash == ownerHash && lease.Generation == generation && lease.SubjectScopeHash == subjectHash && lease.OwnerSequence < beforeSequence {
			return false, nil
		}
	}
	for _, receipt := range s.receipts {
		if receipt.OwnerScopeHash == ownerHash && receipt.Generation == generation && receipt.SubjectScopeHash == subjectHash && receipt.Sequence < beforeSequence && !commandReceiptTerminal(receipt.Status) {
			return false, nil
		}
	}
	return true, nil
}

func (s *InMemoryStateStore) BeginCommand(_ context.Context, ownerHash string, command PersonalMemoryCommandRequest, leaseTTL time.Duration) (CommandReceipt, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if receipt, ok := s.receipts[command.CommandID]; ok {
		if err := validateReceiptIdentity(receipt, ownerHash, command); err != nil {
			return CommandReceipt{}, false, err
		}
		if receipt.Status == "retryable" || (receipt.Status == "processing" && (receipt.ProcessingUntil == nil || time.Now().After(*receipt.ProcessingUntil))) {
			if s.ownerCommandBlocked(ownerHash, command.OwnerSequence, command.CommandID) {
				return CommandReceipt{}, false, ErrMemoryReceiptBlocked
			}
			receipt.Status = "processing"
			receipt.ProcessingUntil = commandLeaseDeadline(leaseTTL)
			receipt.ResultFingerprint = ""
			s.receipts[command.CommandID] = receipt
			return receipt, true, nil
		}
		return receipt, false, nil
	}
	if s.ownerCommandBlocked(ownerHash, command.OwnerSequence, command.CommandID) {
		return CommandReceipt{}, false, ErrMemoryReceiptBlocked
	}
	fence, ok := s.fences[ownerHash]
	if !ok {
		fence = memoryFence{Generation: 1, Lifecycle: "active", Sequence: 0}
	}
	if err := applyFenceCommand(&fence, command); err != nil {
		return CommandReceipt{}, false, err
	}
	receipt := CommandReceipt{CommandID: command.CommandID, Generation: command.OwnerGeneration, Kind: command.CommandKind, OwnerScopeHash: ownerHash, ProcessingUntil: commandLeaseDeadline(leaseTTL), Sequence: command.OwnerSequence, Status: "processing", SubjectScopeHash: command.SubjectScopeHash, SupersessionScope: command.SupersessionScope}
	s.fences[ownerHash] = fence
	s.receipts[command.CommandID] = receipt
	return receipt, true, nil
}

func (s *InMemoryStateStore) FinalizeCommand(_ context.Context, commandID string, ownerHash string, status string, errorCode string, resultFingerprint string, lifecycle string) (CommandReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.receipts[commandID]
	if !ok || receipt.OwnerScopeHash != ownerHash {
		return CommandReceipt{}, ErrMemoryFenceConflict
	}
	status, errorCode, resultFingerprint, err := validateCommandTerminalResult(status, errorCode, resultFingerprint)
	if err != nil {
		return CommandReceipt{}, err
	}
	if commandReceiptTerminal(receipt.Status) {
		if receipt.Status == status && receipt.ErrorCode == errorCode && receipt.ResultFingerprint == resultFingerprint {
			return receipt, nil
		}
		return CommandReceipt{}, ErrMemoryFenceConflict
	}
	receipt.Status = status
	receipt.ErrorCode = errorCode
	receipt.ProcessingUntil = nil
	receipt.ResultFingerprint = resultFingerprint
	s.receipts[commandID] = receipt
	if status == "succeeded" && lifecycle != "" {
		fence := s.fences[ownerHash]
		fence.Lifecycle = lifecycle
		s.fences[ownerHash] = fence
	}
	return receipt, nil
}

func (s *InMemoryStateStore) MarkCommandRetryable(_ context.Context, commandID string, ownerHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.receipts[commandID]
	if !ok || receipt.OwnerScopeHash != ownerHash {
		return ErrMemoryFenceConflict
	}
	if commandReceiptTerminal(receipt.Status) {
		return nil
	}
	receipt.Status = "retryable"
	receipt.ProcessingUntil = nil
	receipt.ResultFingerprint = ""
	s.receipts[commandID] = receipt
	return nil
}

func (s *InMemoryStateStore) ownerCommandBlocked(ownerHash string, sequence int64, commandID string) bool {
	for _, receipt := range s.receipts {
		if receipt.CommandID != commandID && receipt.OwnerScopeHash == ownerHash && receipt.Sequence < sequence && !commandReceiptTerminal(receipt.Status) {
			return true
		}
	}
	return false
}

func (s *InMemoryStateStore) HealthCheck(context.Context) error { return nil }

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
	err = tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from runtime.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence)
	if errors.Is(err, pgx.ErrNoRows) {
		if generation != 1 || sequence != 0 {
			return ErrMemoryFenceConflict
		}
		fence = memoryFence{Generation: 1, Lifecycle: "active", Sequence: 0}
		if _, err := tx.Exec(ctx, `insert into runtime.personal_memory_owner_fences (owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values ($1,1,'active',0,now())`, ownerHash); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if fence.Generation != generation || fence.Sequence != sequence || fence.Lifecycle != "active" {
		return ErrMemoryFenceConflict
	}
	if _, err := tx.Exec(ctx, `delete from runtime.personal_memory_call_leases where call_id=$1 and expires_at <= now()`, callID); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `insert into runtime.personal_memory_call_leases (call_id,owner_scope_hash,generation,owner_sequence,subject_scope_hash,operation_kind,expires_at,created_at) values ($1,$2,$3,$4,$5,$6,$7,now()) on conflict do nothing`, callID, ownerHash, generation, sequence, subjectHash, kind, time.Now().Add(ttl))
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return ErrMemoryFenceConflict
	}
	return tx.Commit(ctx)
}

func (s *PostgresStateStore) EndCall(ctx context.Context, ownerHash string, callID string) error {
	_, err := s.pool.Exec(ctx, `delete from runtime.personal_memory_call_leases where call_id=$1 and owner_scope_hash=$2`, callID, ownerHash)
	return err
}

func (s *PostgresStateStore) GenerationDrained(ctx context.Context, ownerHash string, generation int64) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `select
		exists(select 1 from runtime.personal_memory_call_leases where owner_scope_hash=$1 and generation=$2 and expires_at > now())
		or exists(select 1 from runtime.personal_memory_command_receipts where owner_scope_hash=$1 and generation=$2 and status not in ('succeeded','failed'))`, ownerHash, generation).Scan(&active)
	return !active, err
}

func (s *PostgresStateStore) SubjectDrained(ctx context.Context, ownerHash string, generation int64, subjectHash string, beforeSequence int64) (bool, error) {
	var active bool
	err := s.pool.QueryRow(ctx, `select
		exists(select 1 from runtime.personal_memory_call_leases where owner_scope_hash=$1 and generation=$2 and subject_scope_hash=$3 and owner_sequence < $4 and expires_at > now())
		or exists(select 1 from runtime.personal_memory_command_receipts where owner_scope_hash=$1 and generation=$2 and subject_scope_hash=$3 and sequence < $4 and status not in ('succeeded','failed'))`, ownerHash, generation, subjectHash, beforeSequence).Scan(&active)
	return !active, err
}

func (s *PostgresStateStore) BeginCommand(ctx context.Context, ownerHash string, command PersonalMemoryCommandRequest, leaseTTL time.Duration) (CommandReceipt, bool, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CommandReceipt{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	_, err = tx.Exec(ctx, `insert into runtime.personal_memory_owner_fences (owner_scope_hash,generation,lifecycle_state,last_owner_sequence,updated_at) values ($1,1,'active',0,now()) on conflict do nothing`, ownerHash)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	var fence memoryFence
	err = tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from runtime.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	var receipt CommandReceipt
	err = tx.QueryRow(ctx, `select command_id, owner_scope_hash, generation, sequence, kind, status, error_code, lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope from runtime.personal_memory_command_receipts where command_id=$1 for update`, command.CommandID).Scan(&receipt.CommandID, &receipt.OwnerScopeHash, &receipt.Generation, &receipt.Sequence, &receipt.Kind, &receipt.Status, &receipt.ErrorCode, &receipt.ProcessingUntil, &receipt.ResultFingerprint, &receipt.SubjectScopeHash, &receipt.SupersessionScope)
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
			if _, err := tx.Exec(ctx, `update runtime.personal_memory_command_receipts set status='processing', error_code='', result_fingerprint='', lease_expires_at=$2, updated_at=now(), terminal_at=null where command_id=$1 and status not in ('succeeded','failed')`, receipt.CommandID, receipt.ProcessingUntil); err != nil {
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
	_, err = tx.Exec(ctx, `update runtime.personal_memory_owner_fences set generation=$2,lifecycle_state=$3,last_owner_sequence=$4,updated_at=now() where owner_scope_hash=$1`, ownerHash, fence.Generation, fence.Lifecycle, fence.Sequence)
	if err != nil {
		return CommandReceipt{}, false, err
	}
	receipt = CommandReceipt{CommandID: command.CommandID, OwnerScopeHash: ownerHash, Generation: command.OwnerGeneration, Sequence: command.OwnerSequence, Kind: command.CommandKind, ProcessingUntil: commandLeaseDeadline(leaseTTL), Status: "processing", SubjectScopeHash: command.SubjectScopeHash, SupersessionScope: command.SupersessionScope}
	_, err = tx.Exec(ctx, `insert into runtime.personal_memory_command_receipts (command_id,owner_scope_hash,generation,sequence,kind,status,lease_expires_at,subject_scope_hash,supersession_scope,created_at,updated_at) values ($1,$2,$3,$4,$5,'processing',$6,$7,$8,now(),now())`, receipt.CommandID, receipt.OwnerScopeHash, receipt.Generation, receipt.Sequence, receipt.Kind, receipt.ProcessingUntil, receipt.SubjectScopeHash, receipt.SupersessionScope)
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
	if err := tx.QueryRow(ctx, `select generation,lifecycle_state,last_owner_sequence from runtime.personal_memory_owner_fences where owner_scope_hash=$1 for update`, ownerHash).Scan(&fence.Generation, &fence.Lifecycle, &fence.Sequence); err != nil {
		return CommandReceipt{}, err
	}
	var receipt CommandReceipt
	if err := tx.QueryRow(ctx, `select command_id, owner_scope_hash, generation, sequence, kind, status, error_code, lease_expires_at, result_fingerprint, subject_scope_hash, supersession_scope from runtime.personal_memory_command_receipts where command_id=$1 and owner_scope_hash=$2 for update`, commandID, ownerHash).Scan(&receipt.CommandID, &receipt.OwnerScopeHash, &receipt.Generation, &receipt.Sequence, &receipt.Kind, &receipt.Status, &receipt.ErrorCode, &receipt.ProcessingUntil, &receipt.ResultFingerprint, &receipt.SubjectScopeHash, &receipt.SupersessionScope); err != nil {
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
	command, err := tx.Exec(ctx, `update runtime.personal_memory_command_receipts set status=$3,error_code=$4,result_fingerprint=$5,lease_expires_at=null,updated_at=now(),terminal_at=now() where command_id=$1 and owner_scope_hash=$2 and status not in ('succeeded','failed')`, commandID, ownerHash, status, errorCode, resultFingerprint)
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
		if _, err := tx.Exec(ctx, `update runtime.personal_memory_owner_fences set lifecycle_state=$2,updated_at=now() where owner_scope_hash=$1`, ownerHash, lifecycle); err != nil {
			return CommandReceipt{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return CommandReceipt{}, err
	}
	return receipt, nil
}

func (s *PostgresStateStore) MarkCommandRetryable(ctx context.Context, commandID string, ownerHash string) error {
	command, err := s.pool.Exec(ctx, `update runtime.personal_memory_command_receipts set status='retryable',error_code='',result_fingerprint='',lease_expires_at=null,updated_at=now(),terminal_at=null where command_id=$1 and owner_scope_hash=$2 and status not in ('succeeded','failed')`, commandID, ownerHash)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		var terminal bool
		if err := s.pool.QueryRow(ctx, `select status in ('succeeded','failed') from runtime.personal_memory_command_receipts where command_id=$1 and owner_scope_hash=$2`, commandID, ownerHash).Scan(&terminal); err != nil {
			return ErrMemoryFenceConflict
		}
		if !terminal {
			return ErrMemoryFenceConflict
		}
	}
	return nil
}

func (s *PostgresStateStore) HealthCheck(ctx context.Context) error {
	for _, table := range []string{"runtime.personal_memory_owner_fences", "runtime.personal_memory_call_leases", "runtime.personal_memory_command_receipts"} {
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

func applyFenceCommand(fence *memoryFence, command PersonalMemoryCommandRequest) error {
	switch command.CommandKind {
	case "owner_erase":
		if command.OwnerSequence <= fence.Sequence {
			return fmt.Errorf("%w: erase sequence=%d must exceed=%d", ErrMemoryFenceConflict, command.OwnerSequence, fence.Sequence)
		}
		if command.OwnerGeneration != fence.Generation+1 && (fence.Lifecycle != "erasing" || command.OwnerGeneration != fence.Generation) {
			return fmt.Errorf("%w: erase generation mismatch", ErrMemoryFenceConflict)
		}
		fence.Generation = command.OwnerGeneration
		fence.Lifecycle = "erasing"
	case "owner_transition":
		if command.OwnerSequence <= fence.Sequence {
			return fmt.Errorf("%w: sequence=%d must exceed=%d", ErrMemoryFenceConflict, command.OwnerSequence, fence.Sequence)
		}
		if command.OwnerGeneration != fence.Generation || fence.Lifecycle == "erasing" {
			return fmt.Errorf("%w: owner transition rejected", ErrMemoryFenceConflict)
		}
		fence.Lifecycle = command.LifecycleState
	default:
		if command.OwnerSequence <= fence.Sequence {
			return fmt.Errorf("%w: sequence=%d must exceed=%d", ErrMemoryFenceConflict, command.OwnerSequence, fence.Sequence)
		}
		if command.OwnerGeneration != fence.Generation || (fence.Lifecycle != "active" && fence.Lifecycle != "paused") {
			return fmt.Errorf("%w: memory mutation rejected", ErrMemoryFenceConflict)
		}
	}
	fence.Sequence = command.OwnerSequence
	return nil
}

func postgresOwnerCommandGate(ctx context.Context, tx pgx.Tx, ownerHash string, sequence int64, commandID string) error {
	var blocked bool
	if err := tx.QueryRow(ctx, `select exists(
		select 1 from runtime.personal_memory_command_receipts
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

func commandReceiptTerminal(status string) bool {
	switch strings.TrimSpace(status) {
	case "succeeded", "failed":
		return true
	default:
		return false
	}
}

func validateCommandTerminalResult(status string, errorCode string, resultFingerprint string) (string, string, string, error) {
	status = strings.TrimSpace(status)
	errorCode = strings.TrimSpace(errorCode)
	resultFingerprint = strings.TrimSpace(resultFingerprint)
	if len(resultFingerprint) != 64 || resultFingerprint != strings.ToLower(resultFingerprint) {
		return "", "", "", fmt.Errorf("%w: command result fingerprint is invalid", ErrMemoryFenceConflict)
	}
	if _, err := hex.DecodeString(resultFingerprint); err != nil {
		return "", "", "", fmt.Errorf("%w: command result fingerprint is invalid", ErrMemoryFenceConflict)
	}
	switch status {
	case "succeeded":
		return status, "", resultFingerprint, nil
	case "failed":
		if errorCode == "" {
			errorCode = "personal_memory_command_failed"
		}
		return status, errorCode, resultFingerprint, nil
	default:
		return "", "", "", fmt.Errorf("%w: command terminal status is invalid", ErrMemoryFenceConflict)
	}
}

func validateReceiptIdentity(receipt CommandReceipt, ownerHash string, command PersonalMemoryCommandRequest) error {
	if receipt.OwnerScopeHash != ownerHash || receipt.Generation != command.OwnerGeneration || receipt.Sequence != command.OwnerSequence || receipt.Kind != command.CommandKind || receipt.SubjectScopeHash != command.SubjectScopeHash || receipt.SupersessionScope != command.SupersessionScope {
		return fmt.Errorf("%w: command receipt identity mismatch", ErrMemoryFenceConflict)
	}
	return nil
}

func commandLeaseDeadline(ttl time.Duration) *time.Time {
	if ttl <= 0 {
		ttl = 105 * time.Second
	}
	deadline := time.Now().Add(ttl)
	return &deadline
}
