package temporaladapter

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/outboundadapter"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func personalMemoryResultFingerprint(commandID string, status string, errorCode string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(commandID) + "\x00" + strings.TrimSpace(status) + "\x00" + strings.TrimSpace(errorCode)))
	return hex.EncodeToString(sum[:])
}

func personalMemoryOwnerScopeHash(ownerSalt string, tenantID string, userID string) string {
	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(ownerSalt)))
	_, _ = mac.Write([]byte(strings.TrimSpace(tenantID) + "\x00" + strings.TrimSpace(userID)))
	return hex.EncodeToString(mac.Sum(nil))
}

func personalMemorySubjectScopeHash(ownerHash string, subjectID string) string {
	subjectID = strings.TrimSpace(subjectID)
	if subjectID == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(ownerHash))
	_, _ = mac.Write([]byte(subjectID))
	return hex.EncodeToString(mac.Sum(nil))
}

func personalMemoryActivityOutput(commandID string, status string, errorCode string) temporalruntime.PersonalMemoryCommandActivityOutput {
	return temporalruntime.PersonalMemoryCommandActivityOutput{
		CommandID:         strings.TrimSpace(commandID),
		ErrorCode:         strings.TrimSpace(errorCode),
		ResultFingerprint: personalMemoryResultFingerprint(commandID, status, errorCode),
		Status:            status,
	}
}

func (s *Adapter) ExecutePersonalMemoryCommand(
	ctx context.Context,
	command memoryruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	stopHeartbeat := startTemporalActivityHeartbeat(ctx, "memory.command", 10*time.Second)
	defer stopHeartbeat()
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(command); err != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_invalid",
			err,
			true,
		)
	}
	if s.personalMemoryStateStore == nil || s.personalMemoryStateErr != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			s.personalMemoryStateErr,
			false,
		)
	}
	if s.personalMemoryExecutor == nil || s.personalMemoryErr != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"personal_memory_not_configured",
			s.personalMemoryErr,
			false,
		)
	}

	ownerHash := personalMemoryOwnerScopeHash(s.config.PersonalMemoryOwnerSalt, command.TenantID, command.UserID)
	command.SubjectScopeHash = personalMemorySubjectScopeHash(ownerHash, command.SubjectID)
	leaseTTL := time.Duration(s.config.PersonalMemoryTimeoutSeconds*float64(time.Second)) + 15*time.Second
	receipt, shouldExecute, err := s.personalMemoryStateStore.BeginCommand(ctx, ownerHash, command, leaseTTL)
	if err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryReceiptBlocked) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_command_owner_blocked",
				err,
				true,
			)
		}
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			err,
			false,
		)
	}
	if !shouldExecute {
		switch receipt.Status {
		case "succeeded":
			return personalMemoryActivityOutput(command.CommandID, "succeeded", ""), nil
		case "failed":
			errorCode := personalMemoryCommandErrorCode(receipt.ErrorCode)
			return personalMemoryActivityOutput(command.CommandID, "failed", errorCode), nil
		default:
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_command_receipt_active",
				errors.New("personal memory command receipt is already active"),
				true,
			)
		}
	}
	if command.CommandKind == "owner_erase" {
		drained, drainErr := s.personalMemoryStateStore.GenerationDrained(ctx, ownerHash, command.OwnerGeneration-1)
		if drainErr != nil || !drained {
			_ = s.personalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_generation_not_drained",
				drainErr,
				false,
			)
		}
	}
	if command.CommandKind == "conversation_prune" || command.CommandKind == "conversation_delete" {
		drained, drainErr := s.personalMemoryStateStore.SubjectDrained(ctx, ownerHash, command.OwnerGeneration, command.SubjectScopeHash, command.OwnerSequence)
		if drainErr != nil || !drained {
			_ = s.personalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_subject_not_drained",
				drainErr,
				false,
			)
		}
	}
	recordTemporalActivityHeartbeat(ctx, "memory.command.provider")
	result, err := s.personalMemoryExecutor.ExecuteCommand(ctx, command)
	if err != nil {
		_ = s.personalMemoryStateStore.MarkCommandRetryable(ctx, command.CommandID, ownerHash)
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"hindsight_command_failed",
			err,
			false,
		)
	}
	if result.Status != "succeeded" {
		errorCode := personalMemoryCommandErrorCode(result.ErrorCode)
		return personalMemoryActivityOutput(command.CommandID, "failed", errorCode), nil
	}
	recordTemporalActivityHeartbeat(ctx, "memory.command.completed")
	return personalMemoryActivityOutput(command.CommandID, "succeeded", ""), nil
}

func (s *Adapter) FinalizePersonalMemoryCommandReceipt(
	ctx context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(input.Command); err != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_invalid",
			err,
			true,
		)
	}
	if strings.TrimSpace(input.Result.CommandID) != strings.TrimSpace(input.Command.CommandID) {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_result_invalid",
			errors.New("personal memory result identity mismatch"),
			true,
		)
	}
	if s.personalMemoryStateStore == nil || s.personalMemoryStateErr != nil {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			s.personalMemoryStateErr,
			false,
		)
	}
	result := input.Result
	result.Status = strings.TrimSpace(result.Status)
	if result.Status != "succeeded" && result.Status != "failed" {
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_result_invalid",
			errors.New("personal memory result status is invalid"),
			true,
		)
	}
	result.ErrorCode = personalMemoryCommandErrorCodeForStatus(result.Status, result.ErrorCode)
	result.ResultFingerprint = personalMemoryResultFingerprint(result.CommandID, result.Status, result.ErrorCode)
	ownerHash := personalMemoryOwnerScopeHash(s.config.PersonalMemoryOwnerSalt, input.Command.TenantID, input.Command.UserID)
	input.Command.SubjectScopeHash = personalMemorySubjectScopeHash(ownerHash, input.Command.SubjectID)
	leaseTTL := time.Duration(s.config.PersonalMemoryTimeoutSeconds*float64(time.Second)) + 15*time.Second
	if _, _, err := s.personalMemoryStateStore.BeginCommand(ctx, ownerHash, input.Command, leaseTTL); err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_command_receipt_conflict",
				err,
				true,
			)
		}
		if errors.Is(err, memoryruntime.ErrMemoryReceiptBlocked) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_command_owner_blocked",
				err,
				false,
			)
		}
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
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
	if _, err := s.personalMemoryStateStore.FinalizeCommand(ctx, result.CommandID, ownerHash, result.Status, result.ErrorCode, result.ResultFingerprint, lifecycle); err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
			return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
				"memory_command_receipt_conflict",
				err,
				true,
			)
		}
		return temporalruntime.PersonalMemoryCommandActivityOutput{}, sanitizedTemporalApplicationError(
			"memory_command_state_unavailable",
			err,
			false,
		)
	}
	return result, nil
}

func personalMemoryCommandErrorCode(errorCode string) string {
	switch strings.TrimSpace(errorCode) {
	case "hindsight_command_failed", "personal_memory_command_failed":
		return strings.TrimSpace(errorCode)
	default:
		return "personal_memory_command_failed"
	}
}

func personalMemoryCommandErrorCodeForStatus(status string, errorCode string) string {
	if status == "succeeded" {
		return ""
	}
	return personalMemoryCommandErrorCode(errorCode)
}

func (s *Adapter) WritePersonalMemoryCommandResult(
	ctx context.Context,
	result temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	if result.ResultFingerprint == "" {
		result.ResultFingerprint = personalMemoryResultFingerprint(result.CommandID, result.Status, result.ErrorCode)
	}
	if s == nil || s.productCallbackClient == nil {
		return sanitizedTemporalApplicationError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
			true,
		)
	}
	return mapProductCallbackError(s.productCallbackClient.WritePersonalMemoryCommandResult(
		ctx,
		outboundadapter.PersonalMemoryCommandResultRequest{
			CommandID:         result.CommandID,
			ErrorCode:         result.ErrorCode,
			ResultFingerprint: result.ResultFingerprint,
			Status:            result.Status,
		},
	))
}

func (s *Adapter) writeChatProductFinalization(
	ctx context.Context,
	run execution.DurableRun,
	completedAt time.Time,
	finalizedResponse map[string]any,
) error {
	if s == nil || s.productCallbackClient == nil {
		return sanitizedTemporalApplicationError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
			true,
		)
	}
	return mapProductCallbackError(s.productCallbackClient.WriteExecutionFinalization(
		ctx,
		outboundadapter.ExecutionFinalizationRequest{
			RequestID:   run.RequestID,
			CompletedAt: completedAt,
			Response:    finalizedResponse,
		},
	))
}

func mapProductCallbackError(err error) error {
	if err == nil {
		return nil
	}
	var callbackErr *outboundadapter.ProductCallbackError
	if errors.As(err, &callbackErr) && callbackErr.Code != "" {
		return sanitizedTemporalApplicationError(
			callbackErr.Code,
			callbackErr,
			callbackErr.Code != "product_callback_unavailable",
		)
	}
	return sanitizedTemporalApplicationError("product_callback_unavailable", err, false)
}

func productTerminalErrorResponse(
	run execution.DurableRun,
	status string,
	code string,
	message string,
	retryable bool,
) map[string]any {
	return executionFinalizationResponseWireMap(ExecutionFinalizationResponseWire{
		AnswerText:    "",
		Error:         map[string]any{"code": code, "message": message, "retryable": retryable},
		ModelUsage:    ModelUsageWire{},
		Observability: nil,
		Result:        nil,
		Status:        status,
	})
}
