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

type CampusSearchToolPort interface {
	CampusSearch(context.Context, CampusSearchRequest) (map[string]any, error)
}
type PersonalMemoryRecallToolPort interface {
	PersonalMemoryRecall(context.Context, PersonalMemoryRecallRequest) (map[string]any, error)
}

type OwnerDeletionPort interface {
	StoreConfigured() bool
	Begin(context.Context, string) (execution.OwnerDeletionStatus, error)
	Finalize(context.Context, string) (execution.OwnerDeletionStatus, error)
}
