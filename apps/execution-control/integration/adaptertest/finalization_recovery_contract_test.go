package adaptertest

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
)

func TestFinalizationRejectsOversizedResponseBeforeProductSuccess(t *testing.T) {
	store, adapter, input := workflowFinalizationFixture(t, "run-finalization-size")
	input.WorkflowResult.FinalOutput = strings.Repeat("x", 1<<20)
	calls := 0
	adapter.ProductFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error { calls++; return nil }
	_, err := adapter.WriteWorkflowFinalization(t.Context(), input)
	if err == nil || !strings.Contains(err.Error(), "finalization_response_too_large") || calls != 0 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
	events, err := store.ListRunEvents(t.Context(), input.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted {
			t.Fatal("published success evidence for rejected response")
		}
	}
}

func TestFinalizationRejectsUnknownFieldsBeforeProductSuccess(t *testing.T) {
	_, adapter, input := workflowFinalizationFixture(t, "run-finalization-fields")
	input.WorkflowResult.StageTiming = map[string]any{"private_debug": 1.0}
	calls := 0
	adapter.ProductFinalizationWriter = func(context.Context, execution.DurableRun, time.Time, map[string]any) error { calls++; return nil }
	_, err := adapter.WriteWorkflowFinalization(t.Context(), input)
	if err == nil || calls != 0 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

type finalizationEventFailureStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	failed bool
}

type finalizationCASFailureStore struct {
	*executionpersistence.InMemoryRunProjectionStore
	failed bool
}

func (s *finalizationCASFailureStore) FinalizeRunProjection(ctx context.Context, request execution.RunProjectionFinalizeRequest) (execution.RunProjectionFinalizeResult, error) {
	if !s.failed {
		s.failed = true
		return execution.RunProjectionFinalizeResult{}, errors.New("injected finalization CAS failure")
	}
	return s.InMemoryRunProjectionStore.FinalizeRunProjection(ctx, request)
}

func TestFinalizationCASFailureConvergesAfterProductSuccess(t *testing.T) {
	store, adapter, input := workflowFinalizationFixture(t, "run-finalization-cas-retry")
	adapter.RunProjectionStore = &finalizationCASFailureStore{InMemoryRunProjectionStore: store}
	var times []time.Time
	var hashes []string
	adapter.ProductFinalizationWriter = func(_ context.Context, _ execution.DurableRun, at time.Time, response map[string]any) error {
		times = append(times, at)
		hashes = append(hashes, execution.HashAdmissionJSON(response))
		return nil
	}
	if _, err := adapter.WriteWorkflowFinalization(t.Context(), input); err == nil {
		t.Fatal("expected injected CAS failure")
	}
	events, err := store.ListRunEvents(t.Context(), input.RequestID)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCompleted {
			t.Fatal("published browser completion before CAS")
		}
	}
	if _, err := adapter.WriteWorkflowFinalization(t.Context(), input); err != nil {
		t.Fatal(err)
	}
	if len(times) != 2 || !times[0].Equal(times[1]) || hashes[0] != hashes[1] {
		t.Fatal("CAS retry changed canonical callback")
	}
	run, err := store.GetRun(t.Context(), input.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run=%+v err=%v", run, err)
	}
}

func (s *finalizationEventFailureStore) AppendRunEvent(ctx context.Context, event execution.DurableRunEvent) (execution.DurableRunEvent, error) {
	if event.EventType == execution.DurableRunEventTypeFinalizationCompleted && !s.failed {
		s.failed = true
		return execution.DurableRunEvent{}, errors.New("injected completion event write failure")
	}
	return s.InMemoryRunProjectionStore.AppendRunEvent(ctx, event)
}

func TestFinalizationEventFailureReplaysIdenticalProductCallback(t *testing.T) {
	store, adapter, input := workflowFinalizationFixture(t, "run-finalization-event-retry")
	adapter.RunProjectionStore = &finalizationEventFailureStore{InMemoryRunProjectionStore: store}
	var timestamps []time.Time
	var fingerprints []string
	adapter.ProductFinalizationWriter = func(_ context.Context, _ execution.DurableRun, at time.Time, response map[string]any) error {
		timestamps = append(timestamps, at)
		fingerprints = append(fingerprints, execution.HashAdmissionJSON(response))
		return nil
	}
	if _, err := adapter.WriteWorkflowFinalization(t.Context(), input); err == nil {
		t.Fatal("expected injected event failure")
	}
	if _, err := adapter.WriteWorkflowFinalization(t.Context(), input); err != nil {
		t.Fatal(err)
	}
	if len(timestamps) != 2 || !timestamps[0].Equal(timestamps[1]) || fingerprints[0] != fingerprints[1] {
		t.Fatal("callback replay changed canonical response or time")
	}
	run, err := store.GetRun(t.Context(), input.RequestID)
	if err != nil || run.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run=%+v err=%v", run, err)
	}
	if _, err := adapter.WriteWorkflowFinalization(t.Context(), input); err != nil {
		t.Fatal(err)
	}
	if len(timestamps) != 2 {
		t.Fatal("completed replay sent another callback")
	}
}
