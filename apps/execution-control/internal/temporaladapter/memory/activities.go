package memory

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Activities interface {
	temporalruntime.ContextActivities
	FinalizeMemoryAppendActivity(context.Context, temporalruntime.FinalizeMemoryAppendActivityInput) error
	AppendConversationMemoryActivity(context.Context, temporalruntime.AppendConversationMemoryActivityInput) (temporalruntime.AppendConversationMemoryActivityOutput, error)
	ExecutePersonalMemoryCommandActivity(context.Context, temporalruntime.PersonalMemoryCommandRequest) (temporalruntime.PersonalMemoryCommandActivityOutput, error)
	WritePersonalMemoryCommandResultActivity(context.Context, temporalruntime.PersonalMemoryCommandActivityOutput) error
}
