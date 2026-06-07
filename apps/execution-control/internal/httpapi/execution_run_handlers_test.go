package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type fakeTemporalStarter struct {
	cancelRunID  string
	cancelReason string
	cancelErr    error
	input        temporalruntime.ChatAnswerWorkflowInput
	err          error
}

type failingStepProjectionStore struct {
	*execution.InMemoryDurableRuntimeStore
}

func (s failingStepProjectionStore) UpsertRunStep(
	ctx context.Context,
	step execution.RunStepProjection,
) (execution.RunStepProjection, error) {
	if step.Status != "failed" {
		return s.InMemoryDurableRuntimeStore.UpsertRunStep(ctx, step)
	}
	return execution.RunStepProjection{}, execution.ErrInvalidRunStep
}

func durableWorkerBridgeResponseForTest() bridge.ExecuteResponse {
	return bridge.ExecuteResponse{
		StatusCode: 200,
		Kind:       "durable_agent_response",
		Body:       durableAgentResponseBodyForTest("ok"),
	}
}

func (f *fakeTemporalStarter) StartChatAnswerWorkflow(
	_ context.Context,
	input temporalruntime.ChatAnswerWorkflowInput,
) error {
	f.input = input
	return f.err
}

func (f *fakeTemporalStarter) CancelChatAnswerWorkflow(
	_ context.Context,
	input temporalruntime.ChatAnswerWorkflowCancelInput,
) error {
	f.cancelRunID = input.RunID
	f.cancelReason = input.Reason
	return f.cancelErr
}

func (f *fakeTemporalStarter) CheckReadiness(context.Context) temporalruntime.RuntimeReadiness {
	return temporalruntime.RuntimeReadiness{
		Healthy: true,
		TaskQueues: []temporalruntime.TaskQueueReadiness{
			{
				Name:    temporalruntime.WorkflowTaskQueue,
				Type:    temporalruntime.TaskQueueTypeWorkflow,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueRAG,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueFinalization,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
		},
	}
}

func TestExecutionRunCreateQueuesProjectionAndStartsTemporalWorkflow(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{}
	server := NewServer(config.Config{
		WorkerSharedSecret:     "secret",
		RequestBodyLimitBytes:  1_048_576,
		MaxConcurrentAnswers:   8,
		TemporalNamespace:      "campus-agent-test",
		TemporalTaskQueue:      temporalruntime.WorkflowTaskQueue,
		TemporalWorkflowIDSalt: "test-salt",
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(`{
			"run_id":"run-temporal-001",
			"conversation_id":"conv-temporal-001",
			"turn_id":"turn-temporal-001",
			"request_id":"req-temporal-001",
			"trace_id":"trace-temporal-001",
			"owner_user_id":"user-temporal-001",
			"surface":"public-chat-web",
			"requested_capability":"knowledge",
			"selected_capability":"knowledge",
			"lane":"rag",
			"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
			"metadata":{
				"execution_payload":{
					"user_goal":"hello",
					"request_id":"req-temporal-001",
					"conversation_id":"conv-temporal-001",
					"trace":{"trace_id":"trace-temporal-001"},
					"runtime_decisions":{"runtime_decision_summary":{}}
				},
				"handoff":{
					"target":"rag-tool",
					"payload_kind":"rag_request",
					"allowed_tools":["retrieval.query"],
					"payload":{"query_text":"hello"}
				}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	run, err := store.GetRun(context.Background(), "run-temporal-001")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("projection status = %q, want queued", run.Status)
	}
	if starter.input.RunID != "run-temporal-001" {
		t.Fatalf("workflow input run id = %q", starter.input.RunID)
	}
	if starter.input.WorkflowID != "campus-agent.chat.run-temporal-001" {
		t.Fatalf("workflow id = %q", starter.input.WorkflowID)
	}
	if starter.input.PayloadSHA256 == "" {
		t.Fatal("workflow input payload hash is required")
	}
	if strings.Contains(starter.input.PayloadSHA256, "hello") {
		t.Fatalf("workflow payload hash must not contain raw prompt: %q", starter.input.PayloadSHA256)
	}
}

func TestExecutionRunCreateFailsClosedWhenTemporalStarterMissing(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-temporal-missing", "conv-temporal-missing")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "temporal_runtime_not_configured")
}

func TestExecutionRunCreateFailsClosedWhenTemporalStartFails(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{err: context.DeadlineExceeded}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-temporal-fail", "conv-temporal-fail")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "temporal_workflow_start_failed")
	if _, err := store.GetRun(context.Background(), "run-temporal-fail"); err == nil {
		t.Fatal("failed Temporal start must not leave an admitted run projection")
	}
}

func TestExecutionRunCancelDelegatesToTemporalCancellation(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-cancel",
		"conv-temporal-cancel",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-temporal-cancel/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.cancelRunID != "run-temporal-cancel" {
		t.Fatalf("Temporal cancel run id = %q, want run-temporal-cancel", starter.cancelRunID)
	}
	if starter.cancelReason != "user_requested" {
		t.Fatalf("Temporal cancel reason = %q, want user_requested", starter.cancelReason)
	}
}

func TestExecutionRunStepsReturnsSanitizedStepTrajectory(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-trajectory",
		"conv-temporal-trajectory",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
		StepID:               "planning",
		RunID:                "run-temporal-trajectory",
		ConversationID:       "conv-temporal-trajectory",
		StepKind:             "planning",
		Capability:           "knowledge",
		Status:               "completed",
		TaskQueue:            temporalruntime.ActivityTaskQueueRAG,
		WorkerID:             "staging:rag:worker-1",
		StartedAt:            now,
		CompletedAt:          now.Add(100 * time.Millisecond),
		UpdatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"payload_ref": "projection://runs/run-temporal-trajectory/planning/input",
			"raw_prompt":  "must not leak",
		},
	}); err != nil {
		t.Fatalf("upsert step: %v", err)
	}
	if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
		AttemptID:            "planning:attempt:1",
		StepID:               "planning",
		RunID:                "run-temporal-trajectory",
		Attempt:              1,
		Status:               "completed",
		TaskQueue:            temporalruntime.ActivityTaskQueueRAG,
		WorkerID:             "staging:rag:worker-1",
		StartedAt:            now,
		CompletedAt:          now.Add(100 * time.Millisecond),
		UpdatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "step-attempt-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_type": "PlanChatAnswerActivity",
			"raw_answer":    "must not leak",
		},
	}); err != nil {
		t.Fatalf("upsert attempt: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "planning:result:1",
		StepID:               "planning",
		RunID:                "run-temporal-trajectory",
		AttemptID:            "planning:attempt:1",
		Status:               "completed",
		ResultKind:           "plan",
		ProjectionRef:        "projection://runs/run-temporal-trajectory/planning",
		CreatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"result_ref":          "projection://runs/run-temporal-trajectory/planning/result",
			"raw_provider_result": "must not leak",
			"selected_capability": "knowledge",
			"selected_task_queue": temporalruntime.ActivityTaskQueueRAG,
		},
	}); err != nil {
		t.Fatalf("upsert result: %v", err)
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-temporal-trajectory/steps",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	steps, ok := body["steps"].([]any)
	if !ok || len(steps) != 1 {
		t.Fatalf("steps = %#v, want one step", body["steps"])
	}
	step := expectRecord(t, steps[0], "steps[0]")
	if step["step_kind"] != "planning" || step["task_queue"] != temporalruntime.ActivityTaskQueueRAG {
		t.Fatalf("step = %#v", step)
	}
	attempts, ok := body["attempts"].([]any)
	if !ok || len(attempts) != 1 {
		t.Fatalf("attempts = %#v, want one attempt", body["attempts"])
	}
	results, ok := body["results"].([]any)
	if !ok || len(results) != 1 {
		t.Fatalf("results = %#v, want one result", body["results"])
	}
	serialized := response.Body.String()
	for _, forbidden := range []string{"must not leak", "raw_prompt", "raw_answer", "raw_provider_result"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("step trajectory leaked forbidden payload %q: %s", forbidden, serialized)
		}
	}
}

func TestExecutionRunCancelFailsClosedWhenTemporalCancelFails(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	starter := &fakeTemporalStarter{cancelErr: context.DeadlineExceeded}
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-cancel-fail",
		"conv-temporal-cancel-fail",
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-temporal-cancel-fail/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "temporal_workflow_cancel_failed")
	run, err := store.GetRun(context.Background(), "run-temporal-cancel-fail")
	if err != nil {
		t.Fatalf("get run after failed cancel: %v", err)
	}
	if run.Status == execution.DurableRunStatusCanceled {
		t.Fatal("failed Temporal cancel must not mark projection canceled")
	}
}

func TestInvokeSemanticWorkerActivityStopsWhenProjectionAlreadyCanceled(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
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
	if _, err := store.CancelRun(context.Background(), execution.DurableRunCancelRequest{
		RunID:         "run-temporal-already-canceled",
		Reason:        "user_requested",
		Now:           now.Add(time.Second),
		ReleaseReason: string(execution.DurableTerminalReasonUserCanceled),
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
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        1,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(ctx context.Context, _ bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
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
}

func TestInvokeSemanticWorkerActivityBindsTemporalDurableWorkItem(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	var seen bridge.DurableExecutionRequest
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(_ context.Context, request bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			seen = request
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
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

	if seen.LeaseID != "temporal:run-temporal-work-item:semantic.rag" {
		t.Fatalf("durable work item lease id = %q", seen.LeaseID)
	}
	if seen.StepID != "activity:rag" {
		t.Fatalf("durable work item step id = %q", seen.StepID)
	}
	if seen.Attempt != 1 {
		t.Fatalf("durable work item attempt = %d", seen.Attempt)
	}
}

func TestSemanticActivityFailureFailsClosedWhenStepProjectionWriteFails(t *testing.T) {
	baseStore := execution.NewInMemoryDurableRuntimeStore()
	projectionStore := failingStepProjectionStore{InMemoryDurableRuntimeStore: baseStore}
	server := NewServer(config.Config{
		BridgeTimeoutMS:        1,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(ctx context.Context, _ bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
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
	store := execution.NewInMemoryDurableRuntimeStore()
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
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
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
	finalization, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
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

func TestAppendTemporalRunEventAcceptsIdenticalRetryProjection(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
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
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:finalization:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
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
	first, err := server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
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
			BridgeRef: semantic.BridgeRef,
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
	store := execution.NewInMemoryDurableRuntimeStore()
	var bridgeCalls int
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:rag:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			bridgeCalls++
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
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
}

func TestLateFinalizationActivityDoesNotOverrideCanceledProjection(t *testing.T) {
	store := execution.NewInMemoryDurableRuntimeStore()
	server := NewServer(config.Config{
		BridgeTimeoutMS:        500,
		TemporalWorkerIdentity: "test:finalization:worker",
	}, &fakeBridge{
		configured: true,
		executeDurableFn: func(context.Context, bridge.DurableExecutionRequest) (bridge.ExecuteResponse, error) {
			return durableWorkerBridgeResponseForTest(), nil
		},
	})
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
	if _, err := store.CancelRunProjection(context.Background(), execution.DurableRunCancelRequest{
		RunID:         "run-temporal-late-finalization",
		Reason:        "user_requested",
		Now:           now.Add(time.Second),
		ReleaseReason: string(execution.DurableTerminalReasonUserCanceled),
	}); err != nil {
		t.Fatalf("cancel projection setup: %v", err)
	}

	_, err = server.FinalizeChatAnswerActivity(
		context.Background(),
		temporalruntime.FinalizeChatAnswerActivityInput{
			BridgeRef: semantic.BridgeRef,
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
