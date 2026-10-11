package executionreadmodel

import (
	"context"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

// This type has only Reader methods, so constructor dependency widening fails
// compilation even when production persistence implements both reads and writes.
type readOnlyStore struct{ requestID string }

func (s *readOnlyStore) GetRun(_ context.Context, id string) (execution.DurableRun, error) {
	s.requestID = id
	return execution.DurableRun{RequestID: id}, nil
}
func (*readOnlyStore) ListRunEvents(context.Context, string) ([]execution.DurableRunEvent, error) {
	return nil, nil
}
func (*readOnlyStore) ListRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error) {
	return nil, nil
}
func (*readOnlyStore) WaitForRunEventsAfter(context.Context, string, int64) ([]execution.DurableRunEvent, error) {
	return nil, nil
}
func (*readOnlyStore) ListRunSteps(context.Context, string) ([]execution.RunStepProjection, error) {
	return nil, nil
}
func (*readOnlyStore) ListStepAttempts(context.Context, string) ([]execution.StepAttemptProjection, error) {
	return nil, nil
}
func (*readOnlyStore) ListStepResults(context.Context, string) ([]execution.StepResultProjection, error) {
	return nil, nil
}
func TestStoreReaderAcceptsReadOnlyStore(t *testing.T) {
	store := &readOnlyStore{}
	run, err := NewStoreReader(store).GetRun(t.Context(), "read-only")
	if err != nil || run.RequestID != "read-only" || store.requestID != "read-only" {
		t.Fatalf("run=%#v err=%v", run, err)
	}
}
