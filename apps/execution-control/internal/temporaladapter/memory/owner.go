package memory

import (
	"context"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	workflowcontract "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/contract"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

// MemoryAppendWorkflowReviver reconnects durable append leases whose workflow
// is no longer running, so an erase waiting on generation drain can recover
// lost background work instead of timing out on it.
type MemoryAppendWorkflowReviver interface {
	RestartMemoryAppendWorkflow(ctx context.Context, requestID string) error
	RunningMemoryAppendWorkflows(ctx context.Context, requestIDs []string) (map[string]bool, error)
}

type Adapter struct {
	*activityprojection.Writer
	PersonalMemoryExecutor   executionapplication.MemoryExecutor
	AsyncMemoryExecutor      executionapplication.AsyncMemoryExecutor
	PersonalMemoryErr        error
	PersonalMemoryStateStore executionapplication.MemoryStore
	PersonalMemoryStateErr   error
	AppendWorkflowReviver    MemoryAppendWorkflowReviver
}

func New(adapter Adapter) *Adapter { return &adapter }
func (a *Adapter) AppendConversationMemoryActivity(ctx context.Context, in temporalruntime.AppendConversationMemoryActivityInput) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return a.AppendConversationMemory(ctx, in)
}
func (a *Adapter) ExecutePersonalMemoryCommandActivity(ctx context.Context, in temporalruntime.PersonalMemoryCommandRequest) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return a.ExecutePersonalMemoryCommand(ctx, workflowcontract.MemoryCommandToDomain(in))
}
func (a *Adapter) FinalizePersonalMemoryCommandReceiptActivity(ctx context.Context, in temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return a.FinalizePersonalMemoryCommandReceipt(ctx, in)
}
func (a *Adapter) WritePersonalMemoryCommandResultActivity(ctx context.Context, in temporalruntime.PersonalMemoryCommandActivityOutput) error {
	return a.WritePersonalMemoryCommandResult(ctx, in)
}

var _ Activities = (*Adapter)(nil)
