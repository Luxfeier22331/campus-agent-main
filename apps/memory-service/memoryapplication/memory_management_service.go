package memoryapplication

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

var ErrMemoryStateUnavailable = errors.New("personal memory state is not configured")

type MemoryCommandStarter interface {
	StartPersonalMemoryCommandWorkflow(context.Context, PersonalMemoryCommandInput) error
}

type MemoryManagementOptions struct {
	Store        MemoryManagementStore
	StoreError   error
	Starter      MemoryCommandStarter
	StarterError error
	OwnerSalt    string
}

type MemoryManagementService struct{ options MemoryManagementOptions }

func NewMemoryManagementService(options MemoryManagementOptions) *MemoryManagementService {
	return &MemoryManagementService{options: options}
}

func (s *MemoryManagementService) StarterConfigured() bool {
	return s.options.Starter != nil && s.options.StarterError == nil
}

func (s *MemoryManagementService) StateConfigured() bool {
	return s.options.Store != nil && s.options.StoreError == nil
}

func (s *MemoryManagementService) StartCommand(ctx context.Context, command memoryruntime.PersonalMemoryCommandRequest) error {
	return s.options.Starter.StartPersonalMemoryCommandWorkflow(ctx, PersonalMemoryCommandInput{
		Command:    command,
		WorkflowID: "campus-agent.memory.command." + strings.TrimSpace(command.CommandID),
	})
}

type MemoryCommandStatus struct {
	Receipt memoryruntime.CommandReceipt
	Stale   bool
}

func (s *MemoryManagementService) CommandStatus(ctx context.Context, tenantID, userID, commandID string) (MemoryCommandStatus, error) {
	ownerHash := memoryruntime.OwnerScopeHash(s.options.OwnerSalt, tenantID, userID)
	receipt, err := s.options.Store.GetCommand(ctx, ownerHash, commandID)
	if err != nil {
		return MemoryCommandStatus{}, err
	}
	return MemoryCommandStatus{Receipt: receipt, Stale: memoryruntime.CommandReceiptStale(receipt, time.Now())}, nil
}

func (s *MemoryManagementService) MarkOwnerDeleted(ctx context.Context, tenantID, userID string) error {
	if !s.StateConfigured() || strings.TrimSpace(s.options.OwnerSalt) == "" {
		return ErrMemoryStateUnavailable
	}
	return s.options.Store.MarkOwnerDeleted(ctx, memoryruntime.OwnerScopeHash(s.options.OwnerSalt, tenantID, userID))
}
