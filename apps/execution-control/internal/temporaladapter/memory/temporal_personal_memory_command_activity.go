package memory

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
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

func PersonalMemoryActivityOutput(commandID string, status string, errorCode string) temporalruntime.PersonalMemoryCommandActivityOutput {
	return temporalruntime.PersonalMemoryCommandActivityOutput{
		CommandID: strings.TrimSpace(commandID),
		ErrorCode: strings.TrimSpace(errorCode),
		Status:    status,
	}
}

func (s *Adapter) ExecutePersonalMemoryCommand(
	ctx context.Context,
	command memoryruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	stopHeartbeat := activityprojection.StartTemporalActivityHeartbeat(ctx, "memory.command", 10*time.Second)
	defer stopHeartbeat()
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(command); err != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_invalid",
			err,
			true,
		)
	}
	if s.PersonalMemoryStateStore == nil || s.PersonalMemoryStateErr != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			s.PersonalMemoryStateErr,
			false,
		)
	}
	ownerHash := PersonalMemoryOwnerScopeHash(s.Config.PersonalMemoryOwnerSalt, command.TenantID, command.UserID)
	command.SubjectScopeHash = PersonalMemorySubjectScopeHash(ownerHash, command.SubjectID)
	leaseTTL := time.Duration(s.Config.PersonalMemoryTimeoutSeconds*float64(time.Second)) + 15*time.Second
	receipt, shouldExecute, err := s.PersonalMemoryStateStore.BeginCommand(ctx, ownerHash, command, leaseTTL)
	if err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryReceiptBlocked) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_command_owner_blocked",
				err,
				true,
			)
		}
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
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
		default:
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_command_receipt_active",
				errors.New("personal memory command receipt is already active"),
				true,
			)
		}
	}
	if command.CommandKind == "owner_erase" {
		drained, drainErr := s.PersonalMemoryStateStore.GenerationDrained(ctx, ownerHash, command.OwnerGeneration-1)
		if drainErr == nil && !drained {
			// A receipt whose workflow is gone would hold the old generation
			// open forever. Abandon receipts untouched beyond the stale
			// margin, then re-check the drain before waiting or reviving.
			staleCutoff := time.Now().Add(-memoryruntime.CommandReceiptStaleAfter)
			if _, err := s.PersonalMemoryStateStore.AbandonStaleGenerationReceipts(ctx, ownerHash, command.OwnerGeneration-1, staleCutoff); err == nil {
				drained, drainErr = s.PersonalMemoryStateStore.GenerationDrained(ctx, ownerHash, command.OwnerGeneration-1)
			}
		}
		if drainErr == nil && !drained && !receipt.CreatedAt.IsZero() && time.Since(receipt.CreatedAt) > personalMemoryEraseDrainTimeout {
			return PersonalMemoryActivityOutput(command.CommandID, "failed", "memory_generation_drain_timeout"), nil
		}
		if drainErr == nil && !drained {
			s.reviveLostAppendWorkflows(ctx, ownerHash, command.OwnerGeneration-1)
		}
		if drainErr != nil || !drained {
			_ = s.PersonalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_generation_not_drained",
				drainErr,
				false,
			)
		}
	}
	if command.CommandKind != "owner_transition" && (s.PersonalMemoryExecutor == nil || s.PersonalMemoryErr != nil) {
		_ = s.PersonalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"personal_memory_not_configured",
			s.PersonalMemoryErr,
			false,
		)
	}
	var result memoryruntime.PersonalMemoryCommandResult
	if command.CommandKind == "owner_transition" {
		result = memoryruntime.PersonalMemoryCommandResult{CommandID: command.CommandID, Status: "succeeded"}
	} else {
		activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.command.provider")
		result, err = s.PersonalMemoryExecutor.ExecuteCommand(ctx, command)
	}
	if err != nil {
		_ = s.PersonalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"hindsight_command_failed",
			err,
			false,
		)
	}
	if result.Status != "succeeded" {
		errorCode := PersonalMemoryCommandErrorCode(result.ErrorCode)
		return PersonalMemoryActivityOutput(command.CommandID, "failed", errorCode), nil
	}
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.command.completed")
	return PersonalMemoryActivityOutput(command.CommandID, "succeeded", ""), nil
}

// reviveLostAppendWorkflows reconnects the durable append leases of an older
// generation to their workflows. A lease only clears when its append workflow
// runs to a terminal projection, so an erase waiting on the drain restarts any
// workflow that is no longer running. Revival is best effort: the drain wait
// keeps retrying and the erase drain timeout bounds the total wait.
func (s *Adapter) reviveLostAppendWorkflows(ctx context.Context, ownerHash string, generation int64) {
	if s.AppendWorkflowReviver == nil {
		return
	}
	callIDs, err := s.PersonalMemoryStateStore.ListGenerationAppendCallIDs(ctx, ownerHash, generation)
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

func (s *Adapter) FinalizePersonalMemoryCommandReceipt(
	ctx context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(workflowcontract.MemoryCommandToDomain(input.Command)); err != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_invalid",
			err,
			true,
		)
	}
	if strings.TrimSpace(input.Result.CommandID) != strings.TrimSpace(input.Command.CommandID) {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_result_invalid",
			errors.New("personal memory result identity mismatch"),
			true,
		)
	}
	if s.PersonalMemoryStateStore == nil || s.PersonalMemoryStateErr != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			s.PersonalMemoryStateErr,
			false,
		)
	}
	result := input.Result
	result.Status = strings.TrimSpace(result.Status)
	if result.Status != "succeeded" && result.Status != "failed" {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_result_invalid",
			errors.New("personal memory result status is invalid"),
			true,
		)
	}
	result.ErrorCode = PersonalMemoryCommandErrorCodeForStatus(result.Status, result.ErrorCode)
	ownerHash := PersonalMemoryOwnerScopeHash(s.Config.PersonalMemoryOwnerSalt, input.Command.TenantID, input.Command.UserID)
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
	if _, err := s.PersonalMemoryStateStore.FinalizeCommand(ctx, result.CommandID, ownerHash, result.Status, result.ErrorCode, lifecycle); err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryCommandNotFound) {
			return result, nil
		}
		if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_command_receipt_conflict",
				err,
				true,
			)
		}
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			err,
			false,
		)
	}
	return result, nil
}

func PersonalMemoryCommandErrorCode(errorCode string) string {
	switch strings.TrimSpace(errorCode) {
	case "hindsight_command_failed", "personal_memory_command_failed", "memory_generation_drain_timeout", "memory_command_wait_timeout", "memory_receipt_abandoned":
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

func (s *Adapter) WritePersonalMemoryCommandResult(
	ctx context.Context,
	result temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	if s == nil || s.ProductCallbackClient == nil {
		return activityprojection.SanitizedTemporalApplicationError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
			true,
		)
	}
	return activityprojection.MapProductCallbackError(s.ProductCallbackClient.WritePersonalMemoryCommandResult(
		ctx,
		executionapplication.PersonalMemoryCommandResultRequest{
			CommandID: result.CommandID,
			ErrorCode: result.ErrorCode,
			Status:    result.Status,
		},
	))
}
