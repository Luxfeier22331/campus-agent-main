package httpapi

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type failingStepProjectionStore struct {
	*execution.InMemoryRunProjectionStore
}

func (s failingStepProjectionStore) UpsertRunStep(
	ctx context.Context,
	step execution.RunStepProjection,
) (execution.RunStepProjection, error) {
	if step.Status != "failed" {
		return s.InMemoryRunProjectionStore.UpsertRunStep(ctx, step)
	}
	return execution.RunStepProjection{}, execution.ErrInvalidRunStep
}

func semanticWorkerBridgeResponseForTest() bridge.ExecuteResponse {
	return bridge.ExecuteResponse{
		StatusCode: 200,
		Kind:       "semantic_agent_response",
		Body:       durableAgentResponseBodyForTest("ok"),
	}
}

func TestInvokeSemanticWorkerActivityStopsWhenProjectionAlreadyCanceled(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			t.Fatal("canceled projection must not invoke semantic bridge")
			return bridge.ExecuteResponse{}, nil
		},
	})
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-already-canceled",
		"conv-temporal-already-canceled",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.CancelRunProjection(context.Background(), execution.DurableRunCancelRequest{
		RunID:  "run-temporal-already-canceled",
		Reason: "user_requested",
		Now:    now.Add(time.Second),
	}); err != nil {
		t.Fatalf("cancel run setup: %v", err)
	}

	_, err := server.InvokeSemanticWorkerActivity(context.Background(), temporalruntime.InvokeSemanticWorkerActivityInput{
		PlanRef: "projection://runs/run-temporal-already-canceled/plan",
		RunID:   "run-temporal-already-canceled",
		TraceID: "trace-run-temporal-already-canceled",
	})

	if err == nil {
		t.Fatal("canceled projection must fail activity closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-temporal-already-canceled")
	if getErr != nil {
		t.Fatalf("get run after activity: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusCanceled {
		t.Fatalf("run status = %q, want canceled", run.Status)
	}
}

func TestInvokeSemanticWorkerActivityTimeoutProjectsFailedRun(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        1,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(ctx context.Context, _ bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-activity-timeout",
		"conv-temporal-activity-timeout",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-activity-timeout",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-activity-timeout",
		RunID:          "run-temporal-activity-timeout",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-activity-timeout",
		WorkflowID:     "campus-agent.chat.run-temporal-activity-timeout",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}

	_, err = server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-activity-timeout",
			TraceID: "trace-executor-001",
		},
	)

	if err == nil {
		t.Fatal("semantic activity timeout must fail closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-temporal-activity-timeout")
	if getErr != nil {
		t.Fatalf("get failed run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed ||
		run.TerminalReason != execution.DurableTerminalReasonWorkerUnavailable {
		t.Fatalf("run = %#v, want failed worker_unavailable", run)
	}
	events, listErr := store.ListRunEvents(context.Background(), "run-temporal-activity-timeout")
	if listErr != nil {
		t.Fatalf("list events: %v", listErr)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeWorkflowPlanned,
		execution.DurableRunEventTypeActivityStarted,
		execution.DurableRunEventTypeActivityFailed,
		execution.DurableRunEventTypeRunFailed,
	})
	steps, err := store.ListRunSteps(context.Background(), "run-temporal-activity-timeout")
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	var failedSemanticStep *execution.RunStepProjection
	for index := range steps {
		if steps[index].StepID == "semantic.rag" {
			failedSemanticStep = &steps[index]
		}
	}
	if failedSemanticStep == nil || failedSemanticStep.Status != "failed" {
		t.Fatalf("semantic.rag step = %#v, want failed", failedSemanticStep)
	}
	results, err := store.ListStepResults(context.Background(), "run-temporal-activity-timeout")
	if err != nil {
		t.Fatalf("list step results: %v", err)
	}
	var failedResult *execution.StepResultProjection
	for index := range results {
		if results[index].StepID == "semantic.rag" {
			failedResult = &results[index]
		}
	}
	if failedResult == nil ||
		failedResult.Status != "failed" ||
		failedResult.ResultKind != "activity_failure" {
		t.Fatalf("semantic.rag failed result = %#v", failedResult)
	}
	attempts, err := store.ListStepAttempts(context.Background(), "run-temporal-activity-timeout")
	if err != nil {
		t.Fatalf("list step attempts: %v", err)
	}
	var failedAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "semantic.rag" && attempts[index].Status == "failed" {
			failedAttempt = &attempts[index]
		}
	}
	if failedAttempt == nil {
		t.Fatalf("semantic.rag failed attempt missing: %#v", attempts)
	}
	if failedAttempt.TimeoutOutcome != execution.TimeoutOutcomeBridgeTimeout {
		t.Fatalf("timeout outcome = %q, want bridge_timeout", failedAttempt.TimeoutOutcome)
	}
}

func TestSemanticActivityContextCancelProjectsCancelOutcome(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(ctx context.Context, _ bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-activity-cancel",
		"conv-temporal-activity-cancel",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-activity-cancel",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-activity-cancel",
		RunID:          "run-temporal-activity-cancel",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-activity-cancel",
		WorkflowID:     "campus-agent.chat.run-temporal-activity-cancel",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err = server.InvokeSemanticWorkerActivity(
		ctx,
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-activity-cancel",
			TraceID: "trace-executor-001",
		},
	)

	if err == nil {
		t.Fatal("semantic activity cancel must fail closed")
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), "run-temporal-activity-cancel")
	if listErr != nil {
		t.Fatalf("list attempts: %v", listErr)
	}
	var failedAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "semantic.rag" && attempts[index].Status == "failed" {
			failedAttempt = &attempts[index]
		}
	}
	if failedAttempt == nil {
		t.Fatalf("semantic.rag failed attempt missing: %#v", attempts)
	}
	if failedAttempt.CancelOutcome != execution.CancelOutcomeActivityContextCanceled {
		t.Fatalf("cancel outcome = %q, want activity_context_canceled", failedAttempt.CancelOutcome)
	}
	if failedAttempt.TimeoutOutcome != execution.TimeoutOutcomeNotTimedOut {
		t.Fatalf("timeout outcome = %q, want not_timed_out", failedAttempt.TimeoutOutcome)
	}
}

func TestInvokeSemanticWorkerActivityBindsTemporalSemanticWorkItem(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	var seen bridge.SemanticExecutionRequest
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(_ context.Context, request bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			seen = request
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-temporal-work-item"), nil
		},
	})
	useFakeRAGSynthesisExecutorForRunTest(server, "run-temporal-work-item")
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-work-item",
		"conv-temporal-work-item",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-work-item",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-work-item",
		RunID:          "run-temporal-work-item",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-work-item",
		WorkflowID:     "campus-agent.chat.run-temporal-work-item",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}

	if _, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-work-item",
			TraceID: "trace-executor-001",
		},
	); err != nil {
		t.Fatalf("semantic activity: %v", err)
	}

	if seen.StepExecutionID != "temporal:run-temporal-work-item:semantic.rag" {
		t.Fatalf("semantic work item step execution id = %q", seen.StepExecutionID)
	}
	if seen.StepID != "activity:rag" {
		t.Fatalf("semantic work item step id = %q", seen.StepID)
	}
	if seen.Attempt != 1 {
		t.Fatalf("semantic work item attempt = %d", seen.Attempt)
	}
}

func TestInvokeSemanticWorkerActivityRequiresRAGSynthesisPacket(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerBridgeResponseForTest(), nil
		},
	})
	server.ragSynthesisExecutor = &fakeRAGSynthesisExecutor{}
	server.ragSynthesisErr = nil
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-packet-required",
		"conv-temporal-packet-required",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-packet-required",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-packet-required",
		RunID:          "run-temporal-packet-required",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-packet-required",
		WorkflowID:     "campus-agent.chat.run-temporal-packet-required",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}

	_, err = server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-packet-required",
			TraceID: "trace-executor-001",
		},
	)

	if err == nil {
		t.Fatal("semantic bridge final answer without rag synthesis packet must fail closed")
	}
	run, getErr := store.GetRun(context.Background(), "run-temporal-packet-required")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status != execution.DurableRunStatusFailed {
		t.Fatalf("run status = %q, want failed", run.Status)
	}
	attempts, listErr := store.ListStepAttempts(context.Background(), "run-temporal-packet-required")
	if listErr != nil {
		t.Fatalf("list attempts: %v", listErr)
	}
	var failedAttempt *execution.StepAttemptProjection
	for index := range attempts {
		if attempts[index].StepID == "semantic.rag" && attempts[index].Status == "failed" {
			failedAttempt = &attempts[index]
		}
	}
	if failedAttempt == nil {
		t.Fatalf("semantic.rag failed attempt missing: %#v", attempts)
	}
	if failedAttempt.SanitizedPayload["failure_kind"] != "rag_synthesis_packet_missing" {
		t.Fatalf("failure payload = %#v", failedAttempt.SanitizedPayload)
	}
}

func TestSemanticActivityFailureFailsClosedWhenStepProjectionWriteFails(t *testing.T) {
	baseStore := execution.NewInMemoryRunProjectionStore()
	projectionStore := failingStepProjectionStore{InMemoryRunProjectionStore: baseStore}
	server := NewServer(config.Config{
		BridgeTimeoutMS:        1,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(ctx context.Context, _ bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})
	attachRunProjectionStoreForHandlerTest(server, baseStore)
	server.runProjectionStore = projectionStore
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		baseStore,
		"run-temporal-step-projection-fails",
		"conv-temporal-step-projection-fails",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-step-projection-fails",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-step-projection-fails",
		RunID:          "run-temporal-step-projection-fails",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-step-projection-fails",
		WorkflowID:     "campus-agent.chat.run-temporal-step-projection-fails",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}

	_, err = server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-step-projection-fails",
			TraceID: "trace-executor-001",
		},
	)

	if !errors.Is(err, execution.ErrInvalidRunStep) {
		t.Fatalf("semantic activity err = %v, want ErrInvalidRunStep", err)
	}
	run, getErr := baseStore.GetRun(context.Background(), "run-temporal-step-projection-fails")
	if getErr != nil {
		t.Fatalf("get run: %v", getErr)
	}
	if run.Status == execution.DurableRunStatusFailed {
		t.Fatal("run must not be marked failed when failed step projection cannot be written")
	}
}

func TestTemporalActivitiesProjectTypedStepEvents(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:               500,
		TemporalNamespace:             "campus-agent-test",
		TemporalWorkerIdentity:        "test:rag:worker",
		TemporalWorkflowIDSalt:        "test-salt",
		RequestBodyLimitBytes:         1_048_576,
		WorkerSharedSecret:            "secret",
		MaxConcurrentAnswers:          8,
		PromptStrictStructuredOutputs: true,
	}, &fakeBridge{
		configured: true,
		executeSemanticFn: func(context.Context, bridge.SemanticExecutionRequest) (bridge.ExecuteResponse, error) {
			return semanticWorkerSynthesisPacketResponseForRunTest(t, "run-temporal-steps"), nil
		},
	})
	useFakeRAGSynthesisExecutorForRunTest(server, "run-temporal-steps")
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-steps",
		"conv-temporal-steps",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.AppendRunEvent(context.Background(), execution.DurableRunEvent{
		EventID:              "run-temporal-steps:run-queued",
		RunID:                "run-temporal-steps",
		ConversationID:       "conv-temporal-steps",
		EventType:            execution.DurableRunEventTypeRunQueued,
		OccurredAt:           now.Add(time.Second),
		Visibility:           execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": string(execution.DurableRunStatusQueued)},
	}); err != nil {
		t.Fatalf("append queued event setup: %v", err)
	}

	plan, err := server.PlanChatAnswerActivity(context.Background(), temporalruntime.PlanChatAnswerActivityInput{
		ConversationID: "conv-temporal-steps",
		Namespace:      "campus-agent-test",
		PayloadSHA256:  "hash",
		RequestID:      "req-run-temporal-steps",
		RunID:          "run-temporal-steps",
		TraceID:        "trace-executor-001",
		TurnID:         "turn-run-temporal-steps",
		WorkflowID:     "campus-agent.chat.run-temporal-steps",
	})
	if err != nil {
		t.Fatalf("plan activity: %v", err)
	}
	semantic, err := server.InvokeSemanticWorkerActivity(
		context.Background(),
		temporalruntime.InvokeSemanticWorkerActivityInput{
			PlanRef: plan.PlanRef,
			RunID:   "run-temporal-steps",
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
			RunID:     "run-temporal-steps",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("synthesis activity: %v", err)
	}
	finalization, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: synthesis.BridgeRef,
			PlanRef:   plan.PlanRef,
			RunID:     "run-temporal-steps",
			TraceID:   "trace-executor-001",
		},
	)
	if err != nil {
		t.Fatalf("finalization activity: %v", err)
	}
	if finalization.ProjectionRef != "projection://runs/run-temporal-steps/finalization" {
		t.Fatalf("projection ref = %q", finalization.ProjectionRef)
	}
	events, err := store.ListRunEvents(context.Background(), "run-temporal-steps")
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	assertHTTPAPIDurableEventTypes(t, events, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunQueued,
		execution.DurableRunEventTypeWorkflowPlanned,
		execution.DurableRunEventTypeActivityStarted,
		execution.DurableRunEventTypeActivityCompleted,
		execution.DurableRunEventTypeFinalizationCompleted,
		execution.DurableRunEventTypeRunCompleted,
	})
}
