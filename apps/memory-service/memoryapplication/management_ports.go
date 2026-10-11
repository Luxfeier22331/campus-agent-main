package memoryapplication

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
)

type MemoryManagementPort interface {
	StarterConfigured() bool
	StateConfigured() bool
	StartCommand(context.Context, memoryruntime.PersonalMemoryCommandRequest) error
	CommandStatus(context.Context, string, string, string) (MemoryCommandStatus, error)
}

type PersonalMemoryCommandInput struct {
	Command    memoryruntime.PersonalMemoryCommandRequest
	WorkflowID string
}
type MemoryCommandResultClient interface {
	WritePersonalMemoryCommandResult(context.Context, PersonalMemoryCommandResultRequest) error
}

type PersonalMemoryCommandResultRequest struct {
	CommandID string
	ErrorCode string
	Status    string
}
