package executionreadmodel

import (
	"context"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

// Reader is the query boundary exposed to HTTP handlers. It deliberately
// contains only read operations; projection mutation remains owned by the
// execution application and reconciler.
type Reader interface {
	GetRun(context.Context, string) (execution.DurableRun, error)
	ListRunEvents(context.Context, string) ([]execution.DurableRunEvent, error)
	ListRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error)
	WaitForRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error)
	ListRunSteps(context.Context, string) ([]execution.RunStepProjection, error)
	ListStepAttempts(context.Context, string) ([]execution.StepAttemptProjection, error)
	ListStepResults(context.Context, string) ([]execution.StepResultProjection, error)
}

type StoreReader struct{ store executionapplication.RunStore }

func NewStoreReader(store executionapplication.RunStore) Reader { return StoreReader{store: store} }
func (r StoreReader) GetRun(ctx context.Context, id string) (execution.DurableRun, error) {
	return r.store.GetRun(ctx, id)
}
func (r StoreReader) ListRunEvents(ctx context.Context, id string) ([]execution.DurableRunEvent, error) {
	return r.store.ListRunEvents(ctx, id)
}
func (r StoreReader) ListRunEventsAfter(ctx context.Context, id string, after int64) ([]execution.DurableRunEvent, error) {
	return r.store.ListRunEventsAfter(ctx, id, after)
}
func (r StoreReader) WaitForRunEventsAfter(ctx context.Context, id string, after int64) ([]execution.DurableRunEvent, error) {
	return r.store.WaitForRunEventsAfter(ctx, id, after)
}
func (r StoreReader) ListRunSteps(ctx context.Context, id string) ([]execution.RunStepProjection, error) {
	return r.store.ListRunSteps(ctx, id)
}
func (r StoreReader) ListStepAttempts(ctx context.Context, id string) ([]execution.StepAttemptProjection, error) {
	return r.store.ListStepAttempts(ctx, id)
}
func (r StoreReader) ListStepResults(ctx context.Context, id string) ([]execution.StepResultProjection, error) {
	return r.store.ListStepResults(ctx, id)
}
