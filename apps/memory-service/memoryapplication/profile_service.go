package memoryapplication

import (
	"context"
	"fmt"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"github.com/google/uuid"
)

// ProfileProvider owns Hindsight SDK calls. ProfileService owns the memory
// access boundary and the lifecycle lease around a profile read.
type ProfileProvider interface {
	LookupProfileModel(context.Context, memoryruntime.ProfileQuery) (memoryruntime.ProfileModelSnapshot, bool, bool, error)
	CreateProfileModel(context.Context, memoryruntime.ProfileQuery) error
}

type ProfileService struct {
	Provider   ProfileProvider
	State      CallLeaseStore
	StateError error
	OwnerSalt  string
	Timeout    time.Duration
}

func (s *ProfileService) GetProfile(ctx context.Context, query memoryruntime.ProfileQuery) (memoryruntime.ProfileRecord, error) {
	if s == nil || s.Provider == nil {
		return memoryruntime.ProfileRecord{}, fmt.Errorf("personal memory profile provider is not configured")
	}
	if s.State == nil || s.StateError != nil {
		return memoryruntime.ProfileRecord{}, ErrMemoryStateUnavailable
	}
	if err := memoryruntime.ValidateProfileQuery(query); err != nil {
		return memoryruntime.ProfileRecord{}, err
	}
	budget, callCtx, cancel := NewOperationBudget(ctx, s.Timeout)
	defer cancel()
	ownerHash := memoryruntime.OwnerScopeHash(s.OwnerSalt, query.TenantID, query.OwnerUserID)
	callID := uuid.NewString() + ":management_profile"
	if err := s.State.BeginCall(callCtx, ownerHash, callID, query.OwnerGeneration, "management_profile", budget.LeaseTTL(time.Now())); err != nil {
		return memoryruntime.ProfileRecord{}, fmt.Errorf("personal memory profile fence rejected: %w", err)
	}
	defer func() { _ = s.State.EndCall(context.Background(), ownerHash, callID) }()
	snapshot, bankExists, modelExists, err := s.Provider.LookupProfileModel(callCtx, query)
	if err != nil {
		return memoryruntime.ProfileRecord{}, err
	}
	if !bankExists {
		return memoryruntime.ProfileRecord{}, nil
	}
	if !modelExists {
		if err := s.Provider.CreateProfileModel(callCtx, query); err != nil {
			return memoryruntime.ProfileRecord{}, err
		}
		return memoryruntime.ProfileRecord{Generating: true}, nil
	}
	return memoryruntime.ProfileRecord(snapshot), nil
}
