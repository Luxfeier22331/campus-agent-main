package executionapplication

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

// RunCommandService is the application boundary used by HTTP handlers.
type RunCommandService interface {
	StoreConfigured() bool
	CreateRun(context.Context, CreateRunRequest) (execution.DurableRunCreateResult, error)
	RequestRunCancellation(context.Context, RequestRunCancellationRequest) (execution.DurableRun, error)
}

// AgentToolPort keeps provider and run-state orchestration out of HTTP.
type AgentToolPort interface {
	CampusSearch(context.Context, CampusSearchRequest) (map[string]any, error)
	PersonalMemoryRecall(context.Context, PersonalMemoryRecallRequest) (map[string]any, error)
}
