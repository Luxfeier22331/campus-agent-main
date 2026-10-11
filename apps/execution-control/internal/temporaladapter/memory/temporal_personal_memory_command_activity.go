package memory

import (
	"context"
	"errors"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/activitysupport"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

func (s *Adapter) ExecutePersonalMemoryCommand(ctx context.Context, command memoryruntime.PersonalMemoryCommandRequest) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	stop := activitysupport.StartTemporalActivityHeartbeat(ctx, "memory.command", 10*time.Second)
	defer stop()
	result, err := s.Service.ExecutePersonalMemoryCommand(ctx, command)
	return commandOutput(result), mapApplicationError(err)
}
func (s *Adapter) FinalizePersonalMemoryCommandReceipt(ctx context.Context, input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	result, err := s.Service.FinalizePersonalMemoryCommandReceipt(ctx, memoryapplication.FinalizeCommandInput{
		Command: workflowcontract.MemoryCommandToDomain(input.Command),
		Result:  memoryruntime.PersonalMemoryCommandResult{CommandID: input.Result.CommandID, Status: input.Result.Status, ErrorCode: input.Result.ErrorCode},
	})
	return commandOutput(result), mapApplicationError(err)
}
func commandOutput(result memoryruntime.PersonalMemoryCommandResult) temporalruntime.PersonalMemoryCommandActivityOutput {
	return temporalruntime.PersonalMemoryCommandActivityOutput{CommandID: result.CommandID, Status: result.Status, ErrorCode: result.ErrorCode}
}
func mapApplicationError(err error) error {
	var failure *memoryapplication.Error
	if errors.As(err, &failure) {
		return activitysupport.SanitizedTemporalApplicationError(failure.Code, failure.Cause, failure.NonRetryable)
	}
	return err
}
func (s *Adapter) WritePersonalMemoryCommandResult(
	ctx context.Context,
	result temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	if s == nil || s.MemoryResultClient == nil {
		return activitysupport.SanitizedTemporalApplicationError(
			"product_callback_not_configured",
			errors.New("app-api product callback is not configured"),
			true,
		)
	}
	return activitysupport.MapProductCallbackError(s.MemoryResultClient.WritePersonalMemoryCommandResult(
		ctx,
		memoryapplication.PersonalMemoryCommandResultRequest{
			CommandID: result.CommandID,
			ErrorCode: result.ErrorCode,
			Status:    result.Status,
		},
	))
}
