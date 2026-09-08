package memory

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func PersonalMemoryResultFingerprint(commandID string, status string, errorCode string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(commandID) + "\x00" + strings.TrimSpace(status) + "\x00" + strings.TrimSpace(errorCode)))
	return hex.EncodeToString(sum[:])
}

func PersonalMemoryOwnerScopeHash(ownerSalt string, tenantID string, userID string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(ownerSalt)))
	_, _ = mac.Write([]byte(strings.TrimSpace(tenantID) + "\x00" + strings.TrimSpace(userID)))
	return hex.EncodeToString(mac.Sum(nil))
}

func PersonalMemorySubjectScopeHash(ownerHash string, subjectID string) string {
	subjectID = strings.TrimSpace(subjectID)
	if subjectID == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(ownerHash))
	_, _ = mac.Write([]byte(subjectID))
	return hex.EncodeToString(mac.Sum(nil))
}

func PersonalMemoryActivityOutput(commandID string, status string, errorCode string) temporalruntime.PersonalMemoryCommandActivityOutput {
	return temporalruntime.PersonalMemoryCommandActivityOutput{
		CommandID:         strings.TrimSpace(commandID),
		ErrorCode:         strings.TrimSpace(errorCode),
		ResultFingerprint: PersonalMemoryResultFingerprint(commandID, status, errorCode),
		Status:            status,
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
	if s.PersonalMemoryExecutor == nil || s.PersonalMemoryErr != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"personal_memory_not_configured",
			s.PersonalMemoryErr,
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
		if drainErr != nil || !drained {
			_ = s.PersonalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_generation_not_drained",
				drainErr,
				false,
			)
		}
	}
	if command.CommandKind == "conversation_prune" || command.CommandKind == "conversation_delete" {
		drained, drainErr := s.PersonalMemoryStateStore.SubjectDrained(ctx, ownerHash, command.OwnerGeneration, command.SubjectScopeHash, command.OwnerSequence)
		if drainErr != nil || !drained {
			_ = s.PersonalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_subject_not_drained",
				drainErr,
				false,
			)
		}
	}
	activityprojection.RecordTemporalActivityHeartbeat(ctx, "memory.command.provider")
	result, err := s.PersonalMemoryExecutor.ExecuteCommand(ctx, command)
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
	result.ResultFingerprint = PersonalMemoryResultFingerprint(result.CommandID, result.Status, result.ErrorCode)
	ownerHash := PersonalMemoryOwnerScopeHash(s.Config.PersonalMemoryOwnerSalt, input.Command.TenantID, input.Command.UserID)
	input.Command.SubjectScopeHash = PersonalMemorySubjectScopeHash(ownerHash, input.Command.SubjectID)
	leaseTTL := time.Duration(s.Config.PersonalMemoryTimeoutSeconds*float64(time.Second)) + 15*time.Second
	if _, _, err := s.PersonalMemoryStateStore.BeginCommand(ctx, ownerHash, workflowcontract.MemoryCommandToDomain(input.Command), leaseTTL); err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_command_receipt_conflict",
				err,
				true,
			)
		}
		if errors.Is(err, memoryruntime.ErrMemoryReceiptBlocked) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
				"memory_command_owner_blocked",
				err,
				false,
			)
		}
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, activityprojection.SanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			err,
			false,
		)
	}
	lifecycle := ""
	switch input.Command.CommandKind {
	case "owner_transition":
		lifecycle = input.Command.LifecycleState
	case "owner_erase":
		lifecycle = "erased"
	}
	if _, err := s.PersonalMemoryStateStore.FinalizeCommand(ctx, result.CommandID, ownerHash, result.Status, result.ErrorCode, result.ResultFingerprint, lifecycle); err != nil {
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
	case "hindsight_command_failed", "personal_memory_command_failed":
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
	if result.ResultFingerprint == "" {
		result.ResultFingerprint = PersonalMemoryResultFingerprint(result.CommandID, result.Status, result.ErrorCode)
	}
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
			CommandID:         result.CommandID,
			ErrorCode:         result.ErrorCode,
			ResultFingerprint: result.ResultFingerprint,
			Status:            result.Status,
		},
	))
}
