package memoryactivity

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Handler interface {
	AppendConversationMemory(
		context.Context,
		temporalruntime.AppendConversationMemoryActivityInput,
	) (temporalruntime.AppendConversationMemoryActivityOutput, error)
	ExecutePersonalMemoryCommand(
		context.Context,
		memoryruntime.PersonalMemoryCommandRequest,
	) (temporalruntime.PersonalMemoryCommandActivityOutput, error)
	FinalizePersonalMemoryCommandReceipt(
		context.Context,
		temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
	) (temporalruntime.PersonalMemoryCommandActivityOutput, error)
	WritePersonalMemoryCommandResult(
		context.Context,
		temporalruntime.PersonalMemoryCommandActivityOutput,
	) error
}

type Activities struct {
	handler Handler
}

func New(handler Handler) Activities {
	return Activities{handler: handler}
}

func (activities Activities) AppendConversationMemoryActivity(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return activities.handler.AppendConversationMemory(ctx, input)
}

func (activities Activities) ExecutePersonalMemoryCommandActivity(
	ctx context.Context,
	input memoryruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return activities.handler.ExecutePersonalMemoryCommand(ctx, input)
}

func (activities Activities) FinalizePersonalMemoryCommandReceiptActivity(
	ctx context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return activities.handler.FinalizePersonalMemoryCommandReceipt(ctx, input)
}

func (activities Activities) WritePersonalMemoryCommandResultActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	return activities.handler.WritePersonalMemoryCommandResult(ctx, input)
}

var _ temporalruntime.ContextActivities = Activities{}
