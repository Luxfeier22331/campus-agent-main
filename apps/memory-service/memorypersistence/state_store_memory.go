package memorypersistence

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type InMemoryStateStore struct {
	mu       sync.Mutex
	fences   map[string]memoryruntime.FenceState
	receipts map[string]memoryruntime.CommandReceipt
	leases   map[string]memoryCallLease
}

type memoryCallLease struct {
	Kind           string
	ExpiresAt      time.Time
	Generation     int64
	OwnerScopeHash string
}

func NewInMemoryStateStore() *InMemoryStateStore {
	return &InMemoryStateStore{fences: map[string]memoryruntime.FenceState{}, leases: map[string]memoryCallLease{}, receipts: map[string]memoryruntime.CommandReceipt{}}
}

func (s *InMemoryStateStore) BeginCall(_ context.Context, ownerHash string, callID string, generation int64, kind string, ttl time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.leases[callID]; ok && kind == "append" && ttl == 0 && existing.ExpiresAt.IsZero() && existing.Kind == kind && existing.Generation == generation && existing.OwnerScopeHash == ownerHash {
		return nil
	}
	fence, ok := s.fences[ownerHash]
	if !ok {
		if generation != 1 {
			return memoryruntime.ErrMemoryFenceConflict
		}
		fence = memoryruntime.FenceState{Generation: 1, Lifecycle: "active", Sequence: 0}
		s.fences[ownerHash] = fence
	}
	managementRead := strings.HasPrefix(kind, "management_")
	lifecycleAllowed := fence.Lifecycle == "active" || (managementRead && fence.Lifecycle == "paused")
	if fence.Generation != generation || !lifecycleAllowed {
		return memoryruntime.ErrMemoryFenceConflict
	}
	if existing, ok := s.leases[callID]; ok && (existing.ExpiresAt.IsZero() || time.Now().Before(existing.ExpiresAt)) {
		return memoryruntime.ErrMemoryFenceConflict
	}
	expiresAt := time.Now().Add(ttl)
	if kind == "append" && ttl == 0 {
		expiresAt = time.Time{}
	}
	s.leases[callID] = memoryCallLease{Kind: kind, ExpiresAt: expiresAt, Generation: generation, OwnerScopeHash: ownerHash}
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

func (s *InMemoryStateStore) GetCommand(_ context.Context, ownerHash string, commandID string) (memoryruntime.CommandReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.receipts[commandID]
	if !ok || receipt.OwnerScopeHash != ownerHash {
		return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryCommandNotFound
	}
	return receipt, nil
}

func (s *InMemoryStateStore) GenerationDrained(_ context.Context, ownerHash string, generation int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for callID, lease := range s.leases {
		if !lease.ExpiresAt.IsZero() && now.After(lease.ExpiresAt) {
			delete(s.leases, callID)
			continue
		}
		if lease.OwnerScopeHash == ownerHash && lease.Generation == generation {
			return false, nil
		}
	}
	for _, receipt := range s.receipts {
		if receipt.OwnerScopeHash == ownerHash && receipt.Generation == generation && !memoryruntime.CommandReceiptTerminal(receipt.Status) {
			return false, nil
		}
	}
	return true, nil
}

func (s *InMemoryStateStore) ListGenerationAppendCallIDs(_ context.Context, ownerHash string, generation int64) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	callIDs := make([]string, 0)
	for callID, lease := range s.leases {
		if lease.OwnerScopeHash == ownerHash && lease.Generation == generation && lease.Kind == "append" && lease.ExpiresAt.IsZero() {
			callIDs = append(callIDs, callID)
		}
	}
	sort.Strings(callIDs)
	return callIDs, nil
}

func (s *InMemoryStateStore) MarkOwnerDeleted(_ context.Context, ownerHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for callID, lease := range s.leases {
		if !lease.ExpiresAt.IsZero() && now.After(lease.ExpiresAt) {
			delete(s.leases, callID)
		}
	}
	for _, lease := range s.leases {
		if lease.OwnerScopeHash == ownerHash {
			return memoryruntime.ErrMemoryOwnerNotDrained
		}
	}
	for _, receipt := range s.receipts {
		if receipt.OwnerScopeHash == ownerHash && !memoryruntime.CommandReceiptTerminal(receipt.Status) {
			return memoryruntime.ErrMemoryOwnerNotDrained
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

func (s *InMemoryStateStore) BeginCommand(_ context.Context, ownerHash string, command memoryruntime.PersonalMemoryCommandRequest, leaseTTL time.Duration) (memoryruntime.CommandReceipt, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if receipt, ok := s.receipts[command.CommandID]; ok {
		if err := memoryruntime.ValidateReceiptIdentity(receipt, ownerHash, command); err != nil {
			return memoryruntime.CommandReceipt{}, false, err
		}
		if receipt.Status == "retryable" || (receipt.Status == "processing" && (receipt.ProcessingUntil == nil || time.Now().After(*receipt.ProcessingUntil))) {
			if command.CommandKind != "owner_erase" && s.ownerCommandBlocked(ownerHash, command.OwnerSequence, command.CommandID) {
				return memoryruntime.CommandReceipt{}, false, memoryruntime.ErrMemoryReceiptBlocked
			}
			receipt.Status = "processing"
			receipt.ProcessingUntil = memoryruntime.CommandLeaseDeadline(leaseTTL)
			receipt.UpdatedAt = time.Now()
			s.receipts[command.CommandID] = receipt
			return receipt, true, nil
		}
		return receipt, false, nil
	}
	fence, ok := s.fences[ownerHash]
	if !ok {
		fence = memoryruntime.FenceState{Generation: 1, Lifecycle: "active", Sequence: 0}
	}
	if command.OwnerGeneration < fence.Generation {
		return memoryruntime.CommandReceipt{}, false, memoryruntime.ErrMemoryCommandSuperseded
	}
	if command.CommandKind != "owner_erase" && s.ownerCommandBlocked(ownerHash, command.OwnerSequence, command.CommandID) {
		return memoryruntime.CommandReceipt{}, false, memoryruntime.ErrMemoryReceiptBlocked
	}
	if err := memoryruntime.ApplyFenceCommand(&fence, command); err != nil {
		return memoryruntime.CommandReceipt{}, false, err
	}
	receipt := memoryruntime.CommandReceipt{CommandID: command.CommandID, CreatedAt: time.Now(), Generation: command.OwnerGeneration, Kind: command.CommandKind, OwnerScopeHash: ownerHash, ProcessingUntil: memoryruntime.CommandLeaseDeadline(leaseTTL), Sequence: command.OwnerSequence, Status: "processing", SubjectScopeHash: command.SubjectScopeHash, SupersessionScope: command.SupersessionScope, UpdatedAt: time.Now()}
	s.fences[ownerHash] = fence
	s.receipts[command.CommandID] = receipt
	return receipt, true, nil
}

// ShiftReceiptClockForTest moves a receipt's creation and touch time without
// changing its lifecycle, so callers can exercise elapsed-time bounds
// deterministically.
func (s *InMemoryStateStore) ShiftReceiptClockForTest(commandID string, delta time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if receipt, ok := s.receipts[commandID]; ok {
		receipt.CreatedAt = receipt.CreatedAt.Add(delta)
		receipt.UpdatedAt = receipt.UpdatedAt.Add(delta)
		s.receipts[commandID] = receipt
	}
}

func (s *InMemoryStateStore) FinalizeCommand(_ context.Context, commandID string, ownerHash string, status string, errorCode string, lifecycle string) (memoryruntime.CommandReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.receipts[commandID]
	if !ok || receipt.OwnerScopeHash != ownerHash {
		return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryCommandNotFound
	}
	status, errorCode, err := memoryruntime.ValidateCommandTerminalResult(status, errorCode)
	if err != nil {
		return memoryruntime.CommandReceipt{}, err
	}
	if memoryruntime.CommandReceiptTerminal(receipt.Status) {
		if receipt.Status == status && receipt.ErrorCode == errorCode {
			return receipt, nil
		}
		return memoryruntime.CommandReceipt{}, memoryruntime.ErrMemoryFenceConflict
	}
	receipt.Status = status
	receipt.ErrorCode = errorCode
	receipt.ProcessingUntil = nil
	receipt.UpdatedAt = time.Now()
	s.receipts[commandID] = receipt
	if status == "succeeded" && lifecycle != "" {
		fence := s.fences[ownerHash]
		if fence.Generation == receipt.Generation && fence.Sequence == receipt.Sequence {
			fence.Lifecycle = lifecycle
			s.fences[ownerHash] = fence
		}
	}
	return receipt, nil
}

func (s *InMemoryStateStore) MarkCommandRetryable(_ context.Context, commandID string, ownerHash string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	receipt, ok := s.receipts[commandID]
	if !ok || receipt.OwnerScopeHash != ownerHash {
		return memoryruntime.ErrMemoryFenceConflict
	}
	if memoryruntime.CommandReceiptTerminal(receipt.Status) {
		return nil
	}
	receipt.Status = "retryable"
	receipt.ProcessingUntil = nil
	receipt.UpdatedAt = time.Now()
	s.receipts[commandID] = receipt
	return nil
}

func (s *InMemoryStateStore) ownerCommandBlocked(ownerHash string, sequence int64, commandID string) bool {
	for _, receipt := range s.receipts {
		if receipt.CommandID != commandID && receipt.OwnerScopeHash == ownerHash && receipt.Sequence < sequence && !memoryruntime.CommandReceiptTerminal(receipt.Status) {
			return true
		}
	}
	return false
}
