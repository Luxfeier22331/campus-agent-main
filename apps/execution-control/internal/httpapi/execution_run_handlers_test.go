package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type fakeTemporalStarter struct {
	cancelRunID  string
	cancelReason string
	cancelErr    error
	input        temporalruntime.CapabilityExecutionWorkflowInput
	err          error
}

func (f *fakeTemporalStarter) StartCapabilityExecutionWorkflow(
	_ context.Context,
	input temporalruntime.CapabilityExecutionWorkflowInput,
) error {
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
				Name:    temporalruntime.ActivityTaskQueueKnowledge,
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

func TestExecutionRunCancelDelegatesToTemporalCancellation(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
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
	serialized := response.Body.String()
	for _, forbidden := range []string{"must not leak", "raw_prompt", "raw_answer", "raw_provider_result"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("step trajectory leaked forbidden payload %q: %s", forbidden, serialized)
		}
	}
}

func TestExecutionRunCancelFailsClosedWhenTemporalCancelFails(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{cancelErr: context.DeadlineExceeded}
	server := newWorkerAuthServerForTest()
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
