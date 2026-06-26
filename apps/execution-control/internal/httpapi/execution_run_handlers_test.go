package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type fakeTemporalStarter struct {
	cancelRunID  string
	cancelReason string
	cancelErr    error
	ctx          context.Context
	input        temporalruntime.CapabilityExecutionWorkflowInput
	err          error
}

func (f *fakeTemporalStarter) StartCapabilityExecutionWorkflow(
	ctx context.Context,
	input temporalruntime.CapabilityExecutionWorkflowInput,
) error {
	f.ctx = ctx
	f.input = input
	return f.err
}

func (f *fakeTemporalStarter) CancelCapabilityExecutionWorkflow(
	_ context.Context,
	input temporalruntime.CapabilityExecutionWorkflowCancelInput,
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
				Name:    temporalruntime.ActivityTaskQueueContext,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueKnowledgePlan,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueKnowledgeRetrieval,
				Type:    temporalruntime.TaskQueueTypeActivity,
				Pollers: 1,
				Healthy: true,
			},
			{
				Name:    temporalruntime.ActivityTaskQueueKnowledgeSynthesis,
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
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
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
			"surface":"campus-web",
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
					"capability":"rag-tool",
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
	if len(starter.input.VisibleCapabilities) != 1 || starter.input.VisibleCapabilities[0] != "knowledge" {
		t.Fatalf("visible capabilities = %#v, want knowledge only", starter.input.VisibleCapabilities)
	}
}

func TestExecutionRunCreateFailsClosedForProfileClosedCapability(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := strings.ReplaceAll(
		durableRunCreateBodyForTest("run-campus-closed", "conv-campus-closed"),
		`"requested_capability":"knowledge"`,
		`"requested_capability":"campus_services"`,
	)
	body = strings.ReplaceAll(body, `"selected_capability":"knowledge"`, `"selected_capability":"campus_services"`)
	body = strings.ReplaceAll(body, `"lane":"rag"`, `"lane":"campus_services"`)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusConflict, "capability_not_open")
	if starter.input.RunID != "" {
		t.Fatalf("closed capability must not start workflow: %#v", starter.input)
	}
	if _, err := store.GetRun(context.Background(), "run-campus-closed"); err == nil {
		t.Fatal("closed capability must not create a run projection")
	}
}

func TestExecutionRunCreateStartsProfileOpenCapabilityWithBoundedVisibleSet(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	server.config.OpenCapabilities = []string{"campus_services"}
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := strings.ReplaceAll(
		durableRunCreateBodyForTest("run-campus-open", "conv-campus-open"),
		`"requested_capability":"knowledge"`,
		`"requested_capability":"campus_services"`,
	)
	body = strings.ReplaceAll(body, `"selected_capability":"knowledge"`, `"selected_capability":"campus_services"`)
	body = strings.ReplaceAll(body, `"lane":"rag"`, `"lane":"campus_services"`)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.input.RequestedCapability != "campus_services" {
		t.Fatalf("requested capability = %q, want campus_services", starter.input.RequestedCapability)
	}
	if len(starter.input.VisibleCapabilities) != 1 || starter.input.VisibleCapabilities[0] != "campus_services" {
		t.Fatalf("visible capabilities = %#v, want campus_services only", starter.input.VisibleCapabilities)
	}
}

func TestExecutionRunCreatePropagatesInboundTraceContextToTemporalStart(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-traceparent-001", "conv-traceparent-001")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	request.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	request.Header.Set("baggage", "release=2026.06.18")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	traceHeaders := telemetry.InjectRuntimeTraceHeaders(starter.ctx, "req-traceparent-001", "trace-traceparent-001")
	if traceHeaders["traceparent"] != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" {
		t.Fatalf("Temporal starter context traceparent = %q", traceHeaders["traceparent"])
	}
	if traceHeaders["baggage"] != "release=2026.06.18" {
		t.Fatalf("Temporal starter context baggage = %q", traceHeaders["baggage"])
	}
}

func TestExecutionRunCreateKeepsNeutralCapabilityForPrimaryAgentWorkflow(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(`{
			"run_id":"run-temporal-neutral",
			"conversation_id":"conv-temporal-neutral",
			"turn_id":"turn-temporal-neutral",
			"request_id":"req-temporal-neutral",
			"trace_id":"trace-temporal-neutral",
			"owner_user_id":"user-temporal-neutral",
			"surface":"campus-web",
			"lane":"default",
			"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
			"metadata":{
				"execution_payload":{
					"user_goal":"hi 你是谁",
					"request_id":"req-temporal-neutral",
					"conversation_id":"conv-temporal-neutral",
					"trace":{"trace_id":"trace-temporal-neutral"},
					"actor":{"user_id":"user-temporal-neutral"},
					"context":{"actor":{"user_id":"user-temporal-neutral"}},
					"runtime_decisions":{"runtime_decision_summary":{}}
				}
			}
		}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.input.RequestedCapability != "" {
		t.Fatalf(
			"workflow requested capability = %q, want empty before primary agent",
			starter.input.RequestedCapability,
		)
	}
	if len(starter.input.VisibleCapabilities) != 1 || starter.input.VisibleCapabilities[0] != "knowledge" {
		t.Fatalf("visible capabilities = %#v, want knowledge only", starter.input.VisibleCapabilities)
	}
	run, err := store.GetRun(context.Background(), "run-temporal-neutral")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if run.RequestedCapability != "" {
		t.Fatalf("run requested capability = %q, want empty", run.RequestedCapability)
	}
}

func TestExecutionRunCreateFailsClosedWhenTemporalStarterMissing(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
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
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{err: context.DeadlineExceeded}
	server := newWorkerAuthServerForTest()
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

func TestExecutionRunEventsWaitsForNewEventsWithinBoundedBudget(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 15, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-events-wait", "conv-events-wait", now, nil)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-events-wait/events?after_sequence=0&wait_ms=100",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	go func() {
		time.Sleep(20 * time.Millisecond)
		_, _ = store.AppendRunEvent(context.Background(), execution.DurableRunEvent{
			EventID:              "event-final",
			RunID:                "run-events-wait",
			ConversationID:       "conv-events-wait",
			EventType:            execution.DurableRunEventTypeFinalizationCompleted,
			OccurredAt:           now.Add(2 * time.Second),
			Visibility:           execution.DurableRunEventVisibilityBrowser,
			Payload:              map[string]any{"request_id": "req-executor-001", "trace_id": "trace-executor-001"},
			PayloadSchemaVersion: "run-event-v1",
		})
	}()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	events, ok := body["events"].([]any)
	if !ok || len(events) != 1 {
		t.Fatalf("events = %#v, want one event", body["events"])
	}
	event, ok := events[0].(map[string]any)
	if !ok {
		t.Fatalf("event = %#v, want object", events[0])
	}
	if event["event_type"] != "finalization.completed" {
		t.Fatalf("event_type = %#v, want finalization.completed", event["event_type"])
	}
}

func TestExecutionRunEventsRejectsInvalidWaitBudget(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	createHTTPAPIQueuedDurableRunForTest(t, store, "run-events-invalid-wait", "conv-events-invalid-wait", time.Now(), nil)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodGet,
		"/internal/execution/runs/run-events-invalid-wait/events?wait_ms=60000",
		nil,
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
}

func TestExecutionRunCancelProjectsIncompleteStepOutcomes(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 12, 1, 2, 3, 0, time.UTC)
	runID := "run-temporal-cancel-steps"
	conversationID := "conv-temporal-cancel-steps"
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		runID,
		conversationID,
		now,
		ragHandoffForDurableWorkerTest("hello"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(2*time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.TransitionRun(
		context.Background(),
		runID,
		execution.DurableRunStatusRunning,
		"",
		now.Add(3*time.Second),
	); err != nil {
		t.Fatalf("start run: %v", err)
	}
	seedCancelProjectionStep := func(stepID string, status string, startedAt time.Time, completedAt time.Time) {
		t.Helper()
		if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
			StepID:               stepID,
			RunID:                runID,
			ConversationID:       conversationID,
			StepKind:             "agent",
			Capability:           "primary_agent",
			Status:               status,
			TaskQueue:            temporalruntime.ActivityTaskQueueAgent,
			WorkerID:             "test:agent:001",
			StartedAt:            startedAt,
			CompletedAt:          completedAt,
			UpdatedAt:            now.Add(4 * time.Second),
			PayloadSchemaVersion: "run-step-projection-v1",
			SanitizedPayload:     map[string]any{"step_id": stepID},
		}); err != nil {
			t.Fatalf("seed step %s: %v", stepID, err)
		}
		if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
			AttemptID:             stepID + ":attempt:1",
			StepID:                stepID,
			RunID:                 runID,
			Attempt:               1,
			Status:                status,
			TaskQueue:             temporalruntime.ActivityTaskQueueAgent,
			WorkerID:              "test:agent:001",
			WorkflowID:            "campus-agent.chat." + runID,
			ActivityID:            stepID + ":activity",
			ActivityType:          "ExecutePrimaryAgentActivity",
			ActivityAttempt:       1,
			ScheduledAt:           now.Add(time.Second),
			StartedAt:             startedAt,
			CompletedAt:           completedAt,
			CancelOutcome:         execution.CancelOutcomeNotRequested,
			TimeoutOutcome:        execution.TimeoutOutcomeNotTimedOut,
			LateCompletionOutcome: execution.LateCompletionOutcomeNotLate,
			UpdatedAt:             now.Add(4 * time.Second),
			PayloadSchemaVersion:  "step-attempt-projection-v1",
			SanitizedPayload:      map[string]any{"step_id": stepID},
		}); err != nil {
			t.Fatalf("seed attempt %s: %v", stepID, err)
		}
	}
	seedCancelProjectionStep(
		"memory.recall",
		"completed",
		now.Add(3*time.Second),
		now.Add(3500*time.Millisecond),
	)
	seedCancelProjectionStep("agent.primary", "running", now.Add(4*time.Second), time.Time{})
	seedCancelProjectionStep("synthesis", "scheduled", time.Time{}, time.Time{})

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/"+runID+"/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	steps, err := store.ListRunSteps(context.Background(), runID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	stepByID := map[string]execution.RunStepProjection{}
	for _, step := range steps {
		stepByID[step.StepID] = step
	}
	if stepByID["memory.recall"].Status != "completed" {
		t.Fatalf("completed step changed after cancel: %#v", stepByID["memory.recall"])
	}
	if stepByID["agent.primary"].Status != "canceled" ||
		stepByID["synthesis"].Status != "canceled" {
		t.Fatalf("incomplete steps were not canceled: %#v", stepByID)
	}
	attempts, err := store.ListStepAttempts(context.Background(), runID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	attemptByStep := map[string]execution.StepAttemptProjection{}
	for _, attempt := range attempts {
		attemptByStep[attempt.StepID] = attempt
	}
	if attemptByStep["memory.recall"].Status != "completed" ||
		attemptByStep["memory.recall"].CancelOutcome != execution.CancelOutcomeNotRequested {
		t.Fatalf("completed attempt changed after cancel: %#v", attemptByStep["memory.recall"])
	}
	if attemptByStep["agent.primary"].Status != "canceled" ||
		attemptByStep["agent.primary"].CancelOutcome != execution.CancelOutcomeActivityContextCanceled ||
		attemptByStep["agent.primary"].TerminalReason != string(execution.DurableTerminalReasonUserCanceled) {
		t.Fatalf("started attempt cancel evidence = %#v", attemptByStep["agent.primary"])
	}
	if attemptByStep["synthesis"].Status != "canceled" ||
		attemptByStep["synthesis"].CancelOutcome != execution.CancelOutcomeRequestedBeforeStart ||
		attemptByStep["synthesis"].TerminalReason != string(execution.DurableTerminalReasonUserCanceled) {
		t.Fatalf("scheduled attempt cancel evidence = %#v", attemptByStep["synthesis"])
	}
}

func TestExecutionRunStepsReturnsSanitizedStepTrajectory(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
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
		StepID:               "plan.route",
		RunID:                "run-temporal-trajectory",
		ConversationID:       "conv-temporal-trajectory",
		StepKind:             "planning",
		Capability:           "knowledge",
		Status:               "completed",
		TaskQueue:            temporalruntime.ActivityTaskQueueContext,
		WorkerID:             "staging:context:worker-1",
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
		AttemptID:             "plan.route:attempt:1",
		StepID:                "plan.route",
		RunID:                 "run-temporal-trajectory",
		Attempt:               1,
		Status:                "completed",
		TaskQueue:             temporalruntime.ActivityTaskQueueContext,
		WorkerID:              "staging:context:worker-1",
		WorkflowID:            "campus-agent.chat.run-temporal-trajectory",
		TemporalRunID:         "temporal-run-trajectory",
		ActivityID:            "activity-planning-1",
		ActivityType:          "PlanRouteActivity",
		ActivityAttempt:       1,
		ScheduledAt:           now.Add(-25 * time.Millisecond),
		StartedAt:             now,
		CompletedAt:           now.Add(100 * time.Millisecond),
		ScheduleToStartMS:     25,
		DurationMS:            100,
		ProviderRequestRef:    "provider://requests/req_001",
		ProviderResponseID:    "resp_001",
		ModelProvider:         "openai",
		ModelName:             "gpt-5-mini",
		InputTokens:           120,
		OutputTokens:          42,
		CachedInputTokens:     10,
		EstimatedCostMicroUSD: 321,
		PricingVersion:        "provider-pricing-v1",
		CancelOutcome:         execution.CancelOutcomeNotRequested,
		TimeoutOutcome:        execution.TimeoutOutcomeNotTimedOut,
		LateCompletionOutcome: execution.LateCompletionOutcomeIgnoredAfterTimeout,
		FailCloseReason:       "current_state_unverifiable",
		ReplanReason:          "bounded_replan_after_provider_timeout",
		TerminalReason:        "answer_completed",
		UpdatedAt:             now.Add(100 * time.Millisecond),
		PayloadSchemaVersion:  "step-attempt-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_type": "PlanRouteActivity",
			"raw_answer":    "must not leak",
		},
	}); err != nil {
		t.Fatalf("upsert attempt: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "plan.route:result:1",
		StepID:               "plan.route",
		RunID:                "run-temporal-trajectory",
		AttemptID:            "plan.route:attempt:1",
		Status:               "completed",
		ResultKind:           "route_plan",
		ProjectionRef:        "projection://runs/run-temporal-trajectory/plan/route",
		CreatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"result_ref":          "projection://runs/run-temporal-trajectory/plan/route/result",
			"raw_provider_result": "must not leak",
			"rag": map[string]any{
				"required_facts": []any{"学习成绩"},
				"source_refs": []any{
					map[string]any{
						"source_title": "本科生国家奖学金评审办法",
						"source_body":  "nested source body must not leak",
					},
				},
			},
			"planning": map[string]any{
				"planned_steps": []any{"indexed_lookup"},
				"raw_source":    "nested raw source must not leak",
			},
			"tool_call": map[string]any{
				"authorization": "nested authorization must not leak",
				"selected_tool": "retrieval.query",
			},
			"memory": map[string]any{
				"behavior": "previous_evidence_reuse",
				"secret":   "nested secret must not leak",
			},
			"selected_capability": "knowledge",
			"selected_task_queue": temporalruntime.ActivityTaskQueueContext,
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
	if step["step_kind"] != "planning" || step["task_queue"] != temporalruntime.ActivityTaskQueueContext {
		t.Fatalf("step = %#v", step)
	}
	attempts, ok := body["attempts"].([]any)
	if !ok || len(attempts) != 1 {
		t.Fatalf("attempts = %#v, want one attempt", body["attempts"])
	}
	attempt := expectRecord(t, attempts[0], "attempts[0]")
	for key, want := range map[string]any{
		"workflow_id":             "campus-agent.chat.run-temporal-trajectory",
		"temporal_run_id":         "temporal-run-trajectory",
		"activity_id":             "activity-planning-1",
		"activity_type":           "PlanRouteActivity",
		"activity_attempt":        float64(1),
		"schedule_to_start_ms":    float64(25),
		"duration_ms":             float64(100),
		"provider_request_ref":    "provider://requests/req_001",
		"provider_response_id":    "resp_001",
		"model_provider":          "openai",
		"model_name":              "gpt-5-mini",
		"input_tokens":            float64(120),
		"output_tokens":           float64(42),
		"cached_input_tokens":     float64(10),
		"estimated_cost_microusd": float64(321),
		"pricing_version":         "provider-pricing-v1",
		"cancel_outcome":          string(execution.CancelOutcomeNotRequested),
		"timeout_outcome":         string(execution.TimeoutOutcomeNotTimedOut),
		"late_completion_outcome": string(execution.LateCompletionOutcomeIgnoredAfterTimeout),
		"fail_close_reason":       "current_state_unverifiable",
		"replan_reason":           "bounded_replan_after_provider_timeout",
		"terminal_reason":         "answer_completed",
	} {
		if attempt[key] != want {
			t.Fatalf("attempt[%s] = %#v, want %#v; attempt=%#v", key, attempt[key], want, attempt)
		}
	}
	results, ok := body["results"].([]any)
	if !ok || len(results) != 1 {
		t.Fatalf("results = %#v, want one result", body["results"])
	}
	evalProjection := expectRecord(t, body["agent_runtime_eval_projection"], "agent_runtime_eval_projection")
	if evalProjection["schema_version"] != "agent_runtime_eval_projection.v1" {
		t.Fatalf("eval projection schema = %#v", evalProjection["schema_version"])
	}
	evalRun := expectRecord(t, evalProjection["run"], "agent_runtime_eval_projection.run")
	if evalRun["run_id"] != "run-temporal-trajectory" ||
		evalRun["request_id"] != "req-executor-001" ||
		evalRun["trace_id"] != "trace-executor-001" {
		t.Fatalf("eval projection run identity = %#v", evalRun)
	}
	evalTrajectory := expectRecord(t, evalProjection["trajectory"], "agent_runtime_eval_projection.trajectory")
	if evalTrajectory["selected_capability"] != "knowledge" {
		t.Fatalf("eval trajectory = %#v", evalTrajectory)
	}
	toolCalls, ok := evalTrajectory["tool_calls"].([]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("eval tool calls = %#v, want one tool call", evalTrajectory["tool_calls"])
	}
	toolCall := expectRecord(t, toolCalls[0], "agent_runtime_eval_projection.trajectory.tool_calls[0]")
	if toolCall["selected_tool"] != "retrieval.query" {
		t.Fatalf("eval tool call = %#v", toolCall)
	}
	evalRAG := expectRecord(t, evalProjection["rag"], "agent_runtime_eval_projection.rag")
	sourceRefs, ok := evalRAG["source_refs"].([]any)
	if !ok || len(sourceRefs) != 1 {
		t.Fatalf("eval rag source_refs = %#v, want one source ref", evalRAG["source_refs"])
	}
	sourceRef := expectRecord(t, sourceRefs[0], "agent_runtime_eval_projection.rag.source_refs[0]")
	if sourceRef["source_title"] != "本科生国家奖学金评审办法" {
		t.Fatalf("eval rag source ref = %#v", sourceRef)
	}
	serialized := response.Body.String()
	for _, forbidden := range []string{
		"must not leak",
		"raw_prompt",
		"raw_answer",
		"raw_provider_result",
		"source_body",
		"raw_source",
		"authorization",
		"secret",
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("step trajectory leaked forbidden payload %q: %s", forbidden, serialized)
		}
	}
}
