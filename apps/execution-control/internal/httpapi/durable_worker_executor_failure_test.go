//go:build retired_pg_lease

package httpapi

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestDurableWorkerExecutorDoesNotFinalizeRunCanceledDuringBridgeExecution(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC()
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-cancel-drift", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-executor-cancel-drift",
		"conv-executor-cancel-drift",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	bridgeEntered := make(chan struct{})
	allowBridgeReturn := make(chan struct{})
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(ctx context.Context, _ bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				close(bridgeEntered)
				select {
				case <-allowBridgeReturn:
				case <-ctx.Done():
					return bridge.ExecuteResponse{}, ctx.Err()
				}
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body:       durableAgentResponseBodyForTest("late answer"),
				}, nil
			},
		},
		WorkerID:               "worker-cancel-drift",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-cancel-drift",
		LeaseTTL:               500 * time.Millisecond,
		LeaseHeartbeatInterval: 20 * time.Millisecond,
		Now: func() time.Time {
			return time.Now().UTC()
		},
	})

	resultCh := make(chan error, 1)
	go func() {
		_, err := executor.ProcessNext(ctx)
		resultCh <- err
	}()

	select {
	case <-bridgeEntered:
	case err := <-resultCh:
		t.Fatalf("process returned before bridge entered: %v", err)
	case <-time.After(300 * time.Millisecond):
		t.Fatal("timed out waiting for bridge execution")
	}
	if _, err := store.CancelRun(ctx, execution.DurableRunCancelRequest{
		RunID:         "run-executor-cancel-drift",
		Reason:        "user_requested",
		Now:           time.Now().UTC(),
		ReleaseReason: string(execution.DurableTerminalReasonUserCanceled),
	}); err != nil {
		t.Fatalf("cancel active durable run: %v", err)
	}
	close(allowBridgeReturn)

	err := <-resultCh
	if err == nil || !errors.Is(err, execution.ErrInvalidRunTransition) {
		t.Fatalf("process after active cancel err = %v, want invalid transition", err)
	}
	run, err := store.GetRun(ctx, "run-executor-cancel-drift")
	if err != nil {
		t.Fatalf("get canceled run: %v", err)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", run.Status)
	}
	events, err := store.ListRunEvents(ctx, "run-executor-cancel-drift")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted ||
			event.EventType == execution.DurableRunEventTypeRunCompleted {
			t.Fatalf("unexpected completion event after active cancel: %#v", event)
		}
	}
}

func TestDurableWorkerExecutorDoesNotFinalizeWhenLeaseReleasedDuringBridgeExecution(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC()
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-release-drift", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-executor-release-drift",
		"conv-executor-release-drift",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	bridgeEntered := make(chan struct{})
	allowBridgeReturn := make(chan struct{})
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(ctx context.Context, _ bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				close(bridgeEntered)
				select {
				case <-allowBridgeReturn:
				case <-ctx.Done():
					return bridge.ExecuteResponse{}, ctx.Err()
				}
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body:       durableAgentResponseBodyForTest("late answer"),
				}, nil
			},
		},
		WorkerID:               "worker-release-drift",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-release-drift",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return time.Now().UTC()
		},
	})

	resultCh := make(chan error, 1)
	go func() {
		_, err := executor.ProcessNext(ctx)
		resultCh <- err
	}()

	select {
	case <-bridgeEntered:
	case err := <-resultCh:
		t.Fatalf("process returned before bridge entered: %v", err)
	case <-time.After(300 * time.Millisecond):
		t.Fatal("timed out waiting for bridge execution")
	}
	if _, err := store.ReleaseExecutionLease(
		ctx,
		"lease-executor-release-drift",
		"worker-release-drift",
		"external_release",
		time.Now().UTC(),
	); err != nil {
		t.Fatalf("release active durable lease: %v", err)
	}
	close(allowBridgeReturn)

	err := <-resultCh
	if err == nil || !errors.Is(err, execution.ErrInvalidExecutionLease) {
		t.Fatalf("process after external lease release err = %v, want invalid lease", err)
	}
	events, err := store.ListRunEvents(ctx, "run-executor-release-drift")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted ||
			event.EventType == execution.DurableRunEventTypeRunCompleted {
			t.Fatalf("unexpected completion event after external lease release: %#v", event)
		}
	}
}

func TestDurableWorkerExecutorDoesNotFinalizeWhenLeaseOwnershipDrifts(t *testing.T) {
	ctx := context.Background()
	baseStore := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC()
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, baseStore, execution.DurableLaneRAG, "worker-owner", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		baseStore,
		"run-executor-owner-drift",
		"conv-executor-owner-drift",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	store := &leaseOwnershipDriftStore{InMemoryDurableRuntimeStore: baseStore}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				store.driftLeaseOwner = true
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body:       durableAgentResponseBodyForTest("late answer"),
				}, nil
			},
		},
		WorkerID:               "worker-owner",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-owner-drift",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return time.Now().UTC()
		},
	})

	_, err := executor.ProcessNext(ctx)
	if err == nil || !errors.Is(err, execution.ErrExecutionLeaseDrift) {
		t.Fatalf("process after lease ownership drift err = %v, want lease drift", err)
	}
	events, err := baseStore.ListRunEvents(ctx, "run-executor-owner-drift")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeFinalizationCompleted ||
			event.EventType == execution.DurableRunEventTypeRunCompleted {
			t.Fatalf("unexpected completion event after lease ownership drift: %#v", event)
		}
	}
}

func TestDurableWorkerExecutorFailsRunWhenBridgeReturnsError(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 15, 5, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-err", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-executor-error",
		"conv-executor-error",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				return bridge.ExecuteResponse{}, errors.New("worker unavailable")
			},
		},
		WorkerID:               "worker-err",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-error",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(5 * time.Second)
		},
	})

	result, err := executor.ProcessNext(ctx)
	if err != nil {
		t.Fatalf("process next durable run with bridge error: %v", err)
	}
	if result.Status != execution.DurableRunStatusFailed {
		t.Fatalf("result status = %q, want failed", result.Status)
	}
	run, err := store.GetRun(ctx, "run-executor-error")
	if err != nil {
		t.Fatalf("get durable run: %v", err)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	if run.TerminalReason != execution.DurableTerminalReasonWorkerUnavailable {
		t.Fatalf("terminal reason = %q, want worker_unavailable", run.TerminalReason)
	}
	events, err := store.ListRunEvents(ctx, "run-executor-error")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeAgentStarted,
		execution.DurableRunEventTypeAgentFailed,
		execution.DurableRunEventTypeRunFailed,
		execution.DurableRunEventTypeLeaseReleased,
	})
}

func TestDurableWorkerExecutorRequiresExplicitStepID(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
		},
		WorkerID:               "worker-step",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-step",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
	})

	_, err := executor.ProcessNext(context.Background())
	if err == nil || !strings.Contains(err.Error(), "step_id") {
		t.Fatalf("process without step_id error = %v, want explicit step_id failure", err)
	}
}

func TestDurableWorkerExecutorFailsClosedWhenRunMetadataIsIncomplete(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 15, 10, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-metadata", now)
	if _, err := store.CreateRun(ctx, execution.DurableRun{
		RunID:          "run-metadata-missing",
		ConversationID: "conv-metadata-missing",
		TurnID:         "turn-metadata-missing",
		RequestID:      "req-metadata-missing",
		TraceID:        "trace-metadata-missing",
		OwnerUserID:    "user-metadata",
		Surface:        "public-chat-web",
		Lane:           execution.DurableLaneRAG,
		Status:         execution.DurableRunStatusCreated,
		CreatedAt:      now,
		Metadata:       map[string]any{},
	}); err != nil {
		t.Fatalf("create durable run: %v", err)
	}
	if _, err := store.TransitionRun(
		ctx,
		"run-metadata-missing",
		execution.DurableRunStatusQueued,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("queue durable run: %v", err)
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
		},
		WorkerID:               "worker-metadata",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-metadata-missing",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(5 * time.Second)
		},
	})

	result, err := executor.ProcessNext(ctx)
	if err != nil {
		t.Fatalf("process incomplete metadata as failed run: %v", err)
	}
	if result.Status != execution.DurableRunStatusFailed {
		t.Fatalf("result status = %q, want failed", result.Status)
	}
	run, err := store.GetRun(ctx, "run-metadata-missing")
	if err != nil {
		t.Fatalf("get failed metadata run: %v", err)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	if run.TerminalReason != execution.DurableTerminalReasonWorkerUnavailable {
		t.Fatalf("terminal reason = %q, want worker_unavailable", run.TerminalReason)
	}
	lease, err := store.GetExecutionLease(ctx, "lease-metadata-missing")
	if err != nil {
		t.Fatalf("get metadata lease: %v", err)
	}
	if lease.Status != execution.ExecutionLeaseStatusReleased {
		t.Fatalf("lease status = %q, want released", lease.Status)
	}
	events, err := store.ListRunEvents(ctx, "run-metadata-missing")
	if err != nil {
		t.Fatalf("list metadata failure events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeAgentFailed,
		execution.DurableRunEventTypeRunFailed,
		execution.DurableRunEventTypeLeaseReleased,
	})
	if events[3].Payload["failure_kind"] != "bridge_payload_invalid" {
		t.Fatalf("agent failed payload = %#v", events[3].Payload)
	}
	if !strings.Contains(events[3].Payload["message"].(string), "execution_payload") {
		t.Fatalf("agent failed message = %#v", events[3].Payload)
	}
}
