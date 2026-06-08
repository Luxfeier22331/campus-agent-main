package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestAppendTemporalRunEventAcceptsIdenticalRetryProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-event-retry",
		"conv-temporal-event-retry",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	event := execution.DurableRunEvent{
		EventID:              "run-temporal-event-retry:workflow-planned",
		RunID:                "run-temporal-event-retry",
		ConversationID:       "conv-temporal-event-retry",
		EventType:            execution.DurableRunEventTypeWorkflowPlanned,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"workflow_id": "campus-agent.chat.run-temporal-event-retry"},
	}
	if err := server.appendTemporalRunEvent(context.Background(), event); err != nil {
		t.Fatalf("append first event: %v", err)
	}
	if err := server.appendTemporalRunEvent(context.Background(), event); err != nil {
		t.Fatalf("append identical retry event: %v", err)
	}
	events, err := store.ListRunEvents(context.Background(), "run-temporal-event-retry")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("event count = %d, want 1", len(events))
	}
}

func TestFinalizeChatAnswerActivityReturnsCompletedProjectionOnRetry(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:finalization:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-temporal-finalize-retry"), nil
		},
	})
	useFakeRAGSynthesisExecutorForRunTest(server, "run-temporal-finalize-retry")
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-finalize-retry",
		"conv-temporal-finalize-retry",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-finalize-retry",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-finalize-retry",
		RunID:          "run-temporal-finalize-retry",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-finalize-retry",
		WorkflowID:     "campus-agent.chat.run-temporal-finalize-retry",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-finalize-retry",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}
	synthesis, err := server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-finalize-retry",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("synthesis activity: %v", err)
	}
	first, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: synthesis.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-finalize-retry",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("first finalization activity: %v", err)
	}
	second, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: synthesis.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-finalize-retry",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retry finalization activity: %v", err)
	}
	if second.ProjectionRef != first.ProjectionRef || second.Status != "completed" {
		t.Fatalf("retry finalization result = %#v, first = %#v", second, first)
	}
	events, err := store.ListRunEvents(context.Background(), "run-temporal-finalize-retry")
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	var completedCount int
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCompleted {
			completedCount++
		}
	}
	if completedCount != 1 {
		t.Fatalf("run.completed count = %d, want 1", completedCount)
	}
}

func TestInvokeSemanticWorkerActivityReturnsStoredProjectionOnRetry(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	var bridgeCalls int
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			bridgeCalls++
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-temporal-semantic-retry"), nil
		},
	})
	useFakeRAGSynthesisExecutorForRunTest(server, "run-temporal-semantic-retry")
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-semantic-retry",
		"conv-temporal-semantic-retry",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-semantic-retry",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-semantic-retry",
		RunID:          "run-temporal-semantic-retry",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-semantic-retry",
		WorkflowID:     "campus-agent.chat.run-temporal-semantic-retry",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	first, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-semantic-retry",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("first semantic activity: %v", err)
	}
	second, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-semantic-retry",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("retry semantic activity: %v", err)
	}
	if second.BridgeRef != first.BridgeRef || second.Status != "completed" {
		t.Fatalf("retry semantic result = %#v, first = %#v", second, first)
	}
	if bridgeCalls != 1 {
		t.Fatalf("semantic bridge calls = %d, want 1", bridgeCalls)
	}
	if _, err := server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			BridgeRef: first.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-semantic-retry",
			TraceID:   "trace-executor-001",
		},
	); err != nil {
		t.Fatalf("synthesis activity after semantic retry: %v", err)
	}
}

func TestLateFinalizationActivityDoesNotOverrideCanceledProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:finalization:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-temporal-late-finalization"), nil
		},
	})
	useFakeRAGSynthesisExecutorForRunTest(server, "run-temporal-late-finalization")
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-late-finalization",
		"conv-temporal-late-finalization",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-late-finalization",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-late-finalization",
		RunID:          "run-temporal-late-finalization",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-late-finalization",
		WorkflowID:     "campus-agent.chat.run-temporal-late-finalization",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-late-finalization",
			TraceID: "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("semantic activity: %v", err)
	}
	synthesis, err := server.SynthesizeRAGAnswerActivity(
		context.Background(),
		temporalruntime.SynthesizeRAGAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-late-finalization",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("synthesis activity: %v", err)
	}
	if _, err := store.CancelRunProjection(context.Background(), execution.DurableRunCancelRequest{
		RunID:  "run-temporal-late-finalization",
		Reason: "user_requested",
		Now:    now.Add(time.Second),
	}); err != nil {
		t.Fatalf("cancel projection setup: %v", err)
	}

	_, err = server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: synthesis.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-late-finalization",
			TraceID:   "trace-executor-001",
		},
	)

	if err == nil {
		t.Fatal("late finalization must fail closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-temporal-late-finalization")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", run.Status)
	}
	events, listErr := store.ListRunEvents(context.Background(), "run-temporal-late-finalization")
	if listErr != nil {
		t.Fatalf("list events: %v", listErr)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCompleted ||
			event.EventType == execution.DurableRunEventTypeFinalizationCompleted {
			t.Fatalf("late finalization published terminal success event: %#v", event)
		}
	}
}
