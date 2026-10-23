package memoryapplication

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

// owner_erase waits for the previous generation to drain. A receipt whose
// drain wait already exceeded this bound terminates instead of retrying so the
// erase gate can fail visibly and the owner can issue a successor command.
const personalMemoryEraseDrainTimeout = 24 * time.Hour

func PersonalMemoryOwnerScopeHash(ownerSalt string, tenantID string, userID string) string {
	return memoryruntime.OwnerScopeHash(ownerSalt, tenantID, userID)
}

func PersonalMemorySubjectScopeHash(ownerHash string, subjectID string) string {
	return memoryruntime.SubjectScopeHash(ownerHash, subjectID)
}

func PersonalMemoryActivityOutput(commandID string, status string, errorCode string) memoryruntime.PersonalMemoryCommandResult {
	return memoryruntime.PersonalMemoryCommandResult{
		CommandID: strings.TrimSpace(commandID),
		ErrorCode: strings.TrimSpace(errorCode),
		Status:    status,
	}
}

func (s *Service) ExecutePersonalMemoryCommand(
	ctx context.Context,
	command memoryruntime.PersonalMemoryCommandRequest,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(command); err != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_invalid",
			err,
			true,
		)
	}
	if s.CommandStateStore == nil || s.PersonalMemoryStateErr != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_state_unavailable",
			s.PersonalMemoryStateErr,
			false,
		)
	}
	ownerHash := PersonalMemoryOwnerScopeHash(s.OwnerSalt, command.TenantID, command.UserID)
	command.SubjectScopeHash = PersonalMemorySubjectScopeHash(ownerHash, command.SubjectID)
	leaseTTL := time.Duration(s.TimeoutSeconds*float64(time.Second)) + 15*time.Second
	commandExecutor := s.CommandExecutor
	receipt, shouldExecute, err := s.CommandStateStore.BeginCommand(ctx, ownerHash, command, leaseTTL)
	if err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryCommandSuperseded) {
			return PersonalMemoryActivityOutput(command.CommandID, "failed", "personal_memory_command_failed"), nil
		}
		if errors.Is(err, memoryruntime.ErrMemoryReceiptBlocked) {
			return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
				"memory_command_owner_blocked",
				err,
				true,
			)
		}
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_state_unavailable",
			err,
			false,
		)
	}
	if !shouldExecute {
		switch receipt.Status {
		case "succeeded":
			return PersonalMemoryActivityOutput(command.CommandID, "succeeded", ""), nil
		case "failed":
			errorCode := PersonalMemoryCommandErrorCode(receipt.ErrorCode)
			return PersonalMemoryActivityOutput(command.CommandID, "failed", errorCode), nil
		case "processing":
			if commandExecutor == nil || s.PersonalMemoryErr != nil {
				return memoryruntime.PersonalMemoryCommandResult{}, applicationError("personal_memory_not_configured", s.PersonalMemoryErr, false)
			}
			result, executeErr := commandExecutor.ExecuteCommand(ctx, command)
			if executeErr != nil {
				return memoryruntime.PersonalMemoryCommandResult{}, applicationError("hindsight_command_failed", executeErr, false)
			}
			if result.Status == "processing" || result.Status == "unknown" {
				return PersonalMemoryActivityOutput(command.CommandID, result.Status, result.ErrorCode), nil
			}
			if result.Status == "succeeded" {
				return PersonalMemoryActivityOutput(command.CommandID, "succeeded", ""), nil
			}
			return PersonalMemoryActivityOutput(command.CommandID, "failed", PersonalMemoryCommandErrorCode(result.ErrorCode)), nil
		default:
			return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
				"memory_command_receipt_active",
				errors.New("personal memory command receipt is already active"),
				true,
			)
		}
	}
	if command.CommandKind == "owner_erase" {
		if s.OwnerLifecycleStore == nil {
			return memoryruntime.PersonalMemoryCommandResult{}, applicationError("memory_command_state_unavailable", errors.New("owner lifecycle state unavailable"), false)
		}
		drained, drainErr := s.OwnerLifecycleStore.GenerationDrained(ctx, ownerHash, command.OwnerGeneration-1)
		// A stale receipt only means that its workflow stopped touching local
		// state. It does not prove that a provider-side operation stopped. Keep
		// the generation blocked; app-api can re-admit the stale command using
		// its original payload and stable operation identity.
		if drainErr == nil && !drained && !receipt.CreatedAt.IsZero() && time.Since(receipt.CreatedAt) > personalMemoryEraseDrainTimeout {
			return PersonalMemoryActivityOutput(command.CommandID, "failed", "memory_generation_drain_timeout"), nil
		}
		if drainErr == nil && !drained {
			s.reviveLostAppendWorkflows(ctx, ownerHash, command.OwnerGeneration-1)
		}
		if drainErr != nil || !drained {
			_ = s.CommandStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
			return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
				"memory_generation_not_drained",
				drainErr,
				false,
			)
		}
	}
	if command.CommandKind != "owner_transition" && (commandExecutor == nil || s.PersonalMemoryErr != nil) {
		_ = s.CommandStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"personal_memory_not_configured",
			s.PersonalMemoryErr,
			false,
		)
	}
	var result memoryruntime.PersonalMemoryCommandResult
	if command.CommandKind == "owner_transition" {
		result = memoryruntime.PersonalMemoryCommandResult{CommandID: command.CommandID, Status: "succeeded"}
	} else {
		result, err = commandExecutor.ExecuteCommand(ctx, command)
	}
	if err != nil {
		_ = s.CommandStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"hindsight_command_failed",
			err,
			false,
		)
	}
	if result.Status != "succeeded" {
		if result.Status == "processing" || result.Status == "unknown" {
			// The provider operation is still unresolved. Keep the receipt
			// non-terminal so Temporal can poll the same stable operation.
			return PersonalMemoryActivityOutput(command.CommandID, result.Status, result.ErrorCode), nil
		}
		errorCode := PersonalMemoryCommandErrorCode(result.ErrorCode)
		return PersonalMemoryActivityOutput(command.CommandID, "failed", errorCode), nil
	}
	return PersonalMemoryActivityOutput(command.CommandID, "succeeded", ""), nil
}

// reviveLostAppendWorkflows reconnects the durable append leases of an older
// generation to their workflows. A lease only clears when its append workflow
// runs to a terminal projection, so an erase waiting on the drain restarts any
// workflow that is no longer running. Revival is best effort: the drain wait
// keeps retrying and the erase drain timeout bounds the total wait.
func (s *Service) reviveLostAppendWorkflows(ctx context.Context, ownerHash string, generation int64) {
	if s.AppendWorkflowReviver == nil {
		return
	}
	if s.OwnerLifecycleStore == nil {
		return
	}
	callIDs, err := s.OwnerLifecycleStore.ListGenerationAppendCallIDs(ctx, ownerHash, generation)
	if err != nil {
		return
	}
	requestIDs := make([]string, 0, len(callIDs))
	for _, callID := range callIDs {
		if requestID, ok := strings.CutSuffix(callID, ":append"); ok {
			requestIDs = append(requestIDs, requestID)
		}
	}
	if len(requestIDs) == 0 {
		return
	}
	running, err := s.AppendWorkflowReviver.RunningMemoryAppendWorkflows(ctx, requestIDs)
	if err != nil {
		return
	}
	for _, requestID := range requestIDs {
		if running[requestID] {
			continue
		}
		_ = s.AppendWorkflowReviver.RestartMemoryAppendWorkflow(ctx, requestID)
	}
}

func (s *Service) FinalizePersonalMemoryCommandReceipt(
	ctx context.Context,
	input FinalizeCommandInput,
) (memoryruntime.PersonalMemoryCommandResult, error) {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(input.Command); err != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_invalid",
			err,
			true,
		)
	}
	if strings.TrimSpace(input.Result.CommandID) != strings.TrimSpace(input.Command.CommandID) {
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_result_invalid",
			errors.New("personal memory result identity mismatch"),
			true,
		)
	}
	if s.CommandStateStore == nil || s.PersonalMemoryStateErr != nil {
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_state_unavailable",
			s.PersonalMemoryStateErr,
			false,
		)
	}
	result := input.Result
	result.Status = strings.TrimSpace(result.Status)
	if result.Status != "succeeded" && result.Status != "failed" {
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_result_invalid",
			errors.New("personal memory result status is invalid"),
			true,
		)
	}
	result.ErrorCode = PersonalMemoryCommandErrorCodeForStatus(result.Status, result.ErrorCode)
	ownerHash := PersonalMemoryOwnerScopeHash(s.OwnerSalt, input.Command.TenantID, input.Command.UserID)
	lifecycle := ""
	switch input.Command.CommandKind {
	case "owner_transition":
		lifecycle = input.Command.LifecycleState
	case "owner_erase":
		lifecycle = "erased"
	}
	// The finalizer only transitions a receipt the provider already created.
	// It must not create or gate receipts itself: a command that never got a
	// receipt (for example after the bounded owner-gate wait timed out) has
	// nothing to persist here, and its result flows to the product callback so
	// admission can retry the command from scratch.
	if _, err := s.CommandStateStore.FinalizeCommand(ctx, result.CommandID, ownerHash, result.Status, result.ErrorCode, lifecycle); err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryCommandNotFound) {
			return result, nil
		}
		if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
			return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
				"memory_command_receipt_conflict",
				err,
				true,
			)
		}
		return memoryruntime.PersonalMemoryCommandResult{}, applicationError(
			"memory_command_state_unavailable",
			err,
			false,
		)
	}
	return result, nil
}

func PersonalMemoryCommandErrorCode(errorCode string) string {
	switch strings.TrimSpace(errorCode) {
	case "hindsight_command_failed", "personal_memory_command_failed", "memory_generation_drain_timeout", "memory_command_wait_timeout":
		return strings.TrimSpace(errorCode)
	default:
		return "personal_memory_command_failed"
	}
}

func PersonalMemoryCommandErrorCodeForStatus(status string, errorCode string) string {
	if status == "succeeded" {
		return ""
	}
	return PersonalMemoryCommandErrorCode(errorCode)
}
