package memoryruntime

import (
	"context"
	"sync"
	"time"
)

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

func (s *InMemoryStateStore) MarkOwnerDeleted(_ context.Context, ownerHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for callID, lease := range s.leases {
		if now.After(lease.ExpiresAt) {
			delete(s.leases, callID)
		}
	}
	for _, lease := range s.leases {
		if lease.OwnerScopeHash == ownerHash {
			return ErrMemoryOwnerNotDrained
		}
	}
	for _, receipt := range s.receipts {
		if receipt.OwnerScopeHash == ownerHash && !commandReceiptTerminal(receipt.Status) {
			return ErrMemoryOwnerNotDrained
		}
	}
	fence := s.fences[ownerHash]
	if fence.Generation < 1 {
		fence.Generation = 1
	}
	fence.Lifecycle = "deleted"
	s.fences[ownerHash] = fence
	for callID, lease := range s.leases {
		if lease.OwnerScopeHash == ownerHash {
			delete(s.leases, callID)
		}
	}
	for commandID, receipt := range s.receipts {
		if receipt.OwnerScopeHash == ownerHash {
			delete(s.receipts, commandID)
		}
	}
	return nil
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
