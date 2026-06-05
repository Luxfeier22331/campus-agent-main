package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestDurableWorkerExecutorProcessesNextLeaseToCompletion(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 15, 0, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-001", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-executor-001",
		"conv-executor-001",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	bridgeClient := &fakeBridge{
		configured: true,
		executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			if request.RunID != "run-executor-001" {
				t.Fatalf("durable request run_id = %q, want run-executor-001", request.RunID)
			}
			if request.LeaseID != "lease-executor-001" {
				t.Fatalf("durable request lease_id = %q, want lease-executor-001", request.LeaseID)
			}
			if request.StepID != "handoff:rag-agent:rag_request" {
				t.Fatalf("durable request step_id = %q", request.StepID)
			}
			if request.Lane != "rag" {
				t.Fatalf("durable request lane = %q", request.Lane)
			}
			var payload map[string]any
			if err := json.Unmarshal(request.Execution.Payload, &payload); err != nil {
				t.Fatalf("decode execution payload: %v", err)
			}
			decisions := expectRecord(t, payload["runtime_decisions"], "runtime_decisions")
			handoff := expectRecord(t, decisions["handoff"], "runtime_decisions.handoff")
			agentRequest := expectRecord(t, handoff["agent_request"], "agent_request")
			workflowContext := expectRecord(t, agentRequest["workflow_context"], "workflow_context")
			if workflowContext["workflow_run_ref"] != "workflow:req-executor-001" {
				t.Fatalf("workflow_run_ref before worker binding = %#v", workflowContext["workflow_run_ref"])
			}
			return bridge.ExecuteResponse{
				StatusCode: 200,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:                  store,
		Coordinator:            execution.NewDurableLeaseCoordinator(store),
		Bridge:                 bridgeClient,
		WorkerID:               "worker-001",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-001",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(5 * time.Second)
		},
	})

	result, err := executor.ProcessNext(ctx)
	if err != nil {
		t.Fatalf("process next durable run: %v", err)
	}
	if result.RunID != "run-executor-001" || result.LeaseID != "lease-executor-001" {
		t.Fatalf("result = %#v", result)
	}
	if result.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("result status = %q, want completed", result.Status)
	}

	run, err := store.GetRun(ctx, "run-executor-001")
	if err != nil {
		t.Fatalf("get durable run: %v", err)
	}
	if run.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("run status = %q, want completed", run.Status)
	}
	if run.TerminalReason != execution.DurableTerminalReasonAnswerCompleted {
		t.Fatalf("terminal reason = %q, want answer_completed", run.TerminalReason)
	}
	events, err := store.ListRunEvents(ctx, "run-executor-001")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeAgentStarted,
		execution.DurableRunEventTypeAgentCompleted,
		execution.DurableRunEventTypeFinalizationCompleted,
		execution.DurableRunEventTypeRunCompleted,
		execution.DurableRunEventTypeLeaseReleased,
	})
	last := events[len(events)-1]
	if last.Payload["release_reason"] != "answer_completed" {
		t.Fatalf("lease release payload = %#v", last.Payload)
	}
}

func TestDurableWorkerExecutorHeartbeatsActiveLeaseDuringBridgeExecution(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC()
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-heartbeat", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-executor-heartbeat",
		"conv-executor-heartbeat",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	heartbeatObserved := make(chan struct{})
	bridgeDone := make(chan struct{})
	bridgeClient := &fakeBridge{
		configured: true,
		executeDurableFn: func(ctx context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			if request.LeaseID != "lease-executor-heartbeat" {
				t.Fatalf("durable request lease_id = %q, want lease-executor-heartbeat", request.LeaseID)
			}
			select {
			case <-heartbeatObserved:
			case <-ctx.Done():
				return bridge.ExecuteResponse{}, ctx.Err()
			case <-time.After(300 * time.Millisecond):
				t.Fatal("timed out waiting for active lease heartbeat")
			}
			close(bridgeDone)
			return bridge.ExecuteResponse{
				StatusCode: 200,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:                  store,
		Coordinator:            execution.NewDurableLeaseCoordinator(store),
		Bridge:                 bridgeClient,
		WorkerID:               "worker-heartbeat",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-heartbeat",
		LeaseTTL:               200 * time.Millisecond,
		LeaseHeartbeatInterval: 10 * time.Millisecond,
		Now: func() time.Time {
			return time.Now().UTC()
		},
	})

	resultCh := make(chan error, 1)
	go func() {
		result, err := executor.ProcessNext(ctx)
		if err == nil && result.Status != execution.DurableRunStatusCompleted {
			err = errors.New("durable heartbeat run did not complete")
		}
		resultCh <- err
	}()

	waitForHTTPAPIDurableEventType(
		t,
		store,
		"run-executor-heartbeat",
		execution.DurableRunEventTypeLeaseHeartbeat,
		heartbeatObserved,
	)
	select {
	case <-bridgeDone:
	case err := <-resultCh:
		t.Fatalf("process returned before bridge completed: %v", err)
	case <-time.After(300 * time.Millisecond):
		t.Fatal("bridge did not observe heartbeat")
	}
	if err := <-resultCh; err != nil {
		t.Fatalf("process with active heartbeat: %v", err)
	}
	events, err := store.ListRunEvents(ctx, "run-executor-heartbeat")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var heartbeatEvent *execution.DurableRunEvent
	for index := range events {
		if events[index].EventType == execution.DurableRunEventTypeLeaseHeartbeat {
			heartbeatEvent = &events[index]
			break
		}
	}
	if heartbeatEvent == nil {
		t.Fatalf("lease heartbeat event missing: %#v", events)
	}
	if heartbeatEvent.Payload["lease_id"] != "lease-executor-heartbeat" {
		t.Fatalf("heartbeat payload = %#v", heartbeatEvent.Payload)
	}
	if heartbeatEvent.Payload["worker_id"] != "worker-heartbeat" {
		t.Fatalf("heartbeat payload = %#v", heartbeatEvent.Payload)
	}
}

func TestDurableWorkerExecutorAppendsUniqueHeartbeatEvents(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Now().UTC()
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-heartbeat-many", now)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-executor-heartbeat-many",
		"conv-executor-heartbeat-many",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	heartbeatCountReached := make(chan struct{})
	bridgeClient := &fakeBridge{
		configured: true,
		executeDurableFn: func(ctx context.Context, _ bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			waitForHTTPAPIDurableEventCount(
				t,
				store,
				"run-executor-heartbeat-many",
				execution.DurableRunEventTypeLeaseHeartbeat,
				2,
				heartbeatCountReached,
			)
			select {
			case <-heartbeatCountReached:
			case <-ctx.Done():
				return bridge.ExecuteResponse{}, ctx.Err()
			}
			return bridge.ExecuteResponse{
				StatusCode: 200,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:                  store,
		Coordinator:            execution.NewDurableLeaseCoordinator(store),
		Bridge:                 bridgeClient,
		WorkerID:               "worker-heartbeat-many",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-executor-heartbeat-many",
		LeaseTTL:               200 * time.Millisecond,
		LeaseHeartbeatInterval: 10 * time.Millisecond,
		Now: func() time.Time {
			return time.Now().UTC()
		},
	})

	if _, err := executor.ProcessNext(ctx); err != nil {
		t.Fatalf("process with repeated active heartbeats: %v", err)
	}
	events, err := store.ListRunEvents(ctx, "run-executor-heartbeat-many")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	eventIDs := map[string]bool{}
	heartbeatEvents := 0
	for _, event := range events {
		if eventIDs[event.EventID] {
			t.Fatalf("duplicate event_id %q in events %#v", event.EventID, events)
		}
		eventIDs[event.EventID] = true
		if event.EventType == execution.DurableRunEventTypeLeaseHeartbeat {
			heartbeatEvents++
		}
	}
	if heartbeatEvents < 2 {
		t.Fatalf("heartbeat event count = %d, want at least 2", heartbeatEvents)
	}
}

func TestDurableWorkerExecutorAppendsFinalizationCompletedEvent(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 16, 40, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-final", now)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-final-event", "conv-final-event", now, nil)

	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:       store,
		Coordinator: execution.NewDurableLeaseCoordinator(store),
		Bridge: &fakeBridge{
			configured: true,
			executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
				return bridge.ExecuteResponse{
					StatusCode: 200,
					Kind:       "durable_agent_response",
					Body: json.RawMessage(`{
						"target":"rag-agent",
						"status":"completed",
						"answer_text":"国家奖学金每学年评审一次。",
						"follow_up_question":"",
						"confidence":"high",
						"result":{"evidence":{"sources":[{"doc_id":"student_rules:national-scholarship"}]}}
					}`),
				}, nil
			},
		},
		WorkerID:               "worker-final",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-final-event",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(5 * time.Second)
		},
	})

	if _, err := executor.ProcessNext(ctx); err != nil {
		t.Fatalf("process next durable run: %v", err)
	}
	events, err := store.ListRunEvents(ctx, "run-final-event")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var finalEvent *execution.DurableRunEvent
	for index := range events {
		if events[index].EventType == execution.DurableRunEventTypeFinalizationCompleted {
			finalEvent = &events[index]
			break
		}
	}
	if finalEvent == nil {
		t.Fatalf("finalization.completed event missing; events = %#v", events)
	}
	if finalEvent.Visibility != execution.DurableRunEventVisibilityBrowser {
		t.Fatalf("finalization visibility = %q, want browser", finalEvent.Visibility)
	}
	response := expectRecord(t, finalEvent.Payload["response"], "finalization.response")
	if response["status"] != "completed" {
		t.Fatalf("finalization response status = %#v", response["status"])
	}
	if response["answer_text"] != "国家奖学金每学年评审一次。" {
		t.Fatalf("finalization response answer_text = %#v", response["answer_text"])
	}
	if response["trace_id"] != "trace-executor-001" {
		t.Fatalf("finalization response trace_id = %#v", response["trace_id"])
	}
}

func TestDurableWorkerExecutorPlansRAGHandoffWhenRunMetadataHasNoHandoff(t *testing.T) {
	ctx := context.Background()
	store := execution.NewInMemoryDurableRuntimeStore()
	now := time.Date(2026, 6, 4, 15, 3, 0, 0, time.UTC)
	prepareHTTPAPIDurableLeaseDependenciesForTest(t, store, execution.DurableLaneRAG, "worker-plan", now)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-plan-001", "conv-plan-001", now, nil)

	bridgeClient := &fakeBridge{
		configured: true,
		executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			var payload map[string]any
			if err := json.Unmarshal(request.Execution.Payload, &payload); err != nil {
				t.Fatalf("decode execution payload: %v", err)
			}
			decisions := expectRecord(t, payload["runtime_decisions"], "runtime_decisions")
			handoff := expectRecord(t, decisions["handoff"], "runtime_decisions.handoff")
			if handoff["target"] != "rag-agent" {
				t.Fatalf("planned handoff target = %#v", handoff["target"])
			}
			agentRequest := expectRecord(t, handoff["agent_request"], "agent_request")
			if agentRequest["user_goal"] != "hello" {
				t.Fatalf("agent request user_goal = %#v", agentRequest["user_goal"])
			}
			agentPayload := expectRecord(t, agentRequest["payload"], "agent_request.payload")
			if agentPayload["kind"] != "rag_request" {
				t.Fatalf("agent payload kind = %#v", agentPayload["kind"])
			}
			return bridge.ExecuteResponse{
				StatusCode: 200,
				Kind:       "durable_agent_response",
				Body:       durableAgentResponseBodyForTest("ok"),
			}, nil
		},
	}
	executor := newDurableWorkerExecutor(durableWorkerExecutorOptions{
		Store:                  store,
		Coordinator:            execution.NewDurableLeaseCoordinator(store),
		Bridge:                 bridgeClient,
		WorkerID:               "worker-plan",
		StepID:                 "handoff:rag-agent:rag_request",
		Lane:                   execution.DurableLaneRAG,
		LeaseID:                "lease-plan-001",
		LeaseTTL:               30 * time.Second,
		LeaseHeartbeatInterval: 5 * time.Second,
		Now: func() time.Time {
			return now.Add(5 * time.Second)
		},
	})

	result, err := executor.ProcessNext(ctx)
	if err != nil {
		t.Fatalf("process next with supervisor-owned handoff planning: %v", err)
	}
	if result.Status != execution.DurableRunStatusCompleted {
		t.Fatalf("result status = %q, want completed", result.Status)
	}
}
