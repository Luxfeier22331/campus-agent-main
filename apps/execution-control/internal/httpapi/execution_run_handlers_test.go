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

func TestExecutionRunCreateQueuesProjectionAndStartsTemporalWorkflow(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	server.config.PersonalMemoryTimeoutSeconds = 10
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-temporal-001", "conv-temporal-001")),
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
	if starter.input.PersonalMemoryTimeoutSeconds != 10 {
		t.Fatalf("personal memory timeout = %v, want 10s from runtime config", starter.input.PersonalMemoryTimeoutSeconds)
	}
	if strings.Contains(starter.input.PayloadSHA256, "hello") {
		t.Fatalf("workflow payload hash must not contain raw prompt: %q", starter.input.PayloadSHA256)
	}
	if len(starter.input.VisibleToolNames) != 1 || starter.input.VisibleToolNames[0] != "knowledge_query" {
		t.Fatalf("visible tools = %#v, want knowledge_query handoff", starter.input.VisibleToolNames)
	}
}

func TestExecutionRunCreateRejectsUnknownMetadataField(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = &fakeTemporalStarter{}
	body := strings.Replace(
		durableRunCreateBodyForTest("run-unknown-metadata", "conv-unknown-metadata"),
		`"metadata":{`,
		`"metadata":{"unexpected":true,`,
		1,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if _, err := store.GetRun(context.Background(), "run-unknown-metadata"); err == nil {
		t.Fatal("unknown metadata must not create a run projection")
	}
}

func TestExecutionRunCreateRejectsUnknownExecutionPayloadField(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = &fakeTemporalStarter{}
	body := strings.Replace(
		durableRunCreateBodyForTest("run-unknown-payload", "conv-unknown-payload"),
		`"user_goal":"hello",`,
		`"user_goal":"hello","unexpected":true,`,
		1,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if _, err := store.GetRun(context.Background(), "run-unknown-payload"); err == nil {
		t.Fatal("unknown execution payload must not create a run projection")
	}
}

func TestExecutionRunCreateRejectsUnknownExplicitToolHint(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := durableRunCreateBodyWithToolForTest(
		"run-campus-closed",
		"conv-campus-closed",
		"unpublished_tool",
		"",
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if starter.input.RunID != "" {
		t.Fatalf("unsupported tool hint must not start workflow: %#v", starter.input)
	}
	if _, err := store.GetRun(context.Background(), "run-campus-closed"); err == nil {
		t.Fatal("unsupported tool hint must not create a run projection")
	}
}

func TestExecutionRunCreateStartsExplicitModelVisibleToolWithBoundedVisibleSet(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := durableRunCreateBodyWithToolForTest(
		"run-campus-open",
		"conv-campus-open",
		"transport_schedule_lookup",
		"",
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.input.RequestedTool != "transport_schedule_lookup" {
		t.Fatalf("requested tool = %q, want transport_schedule_lookup", starter.input.RequestedTool)
	}
	if len(starter.input.VisibleToolNames) != 1 || starter.input.VisibleToolNames[0] != "transport_schedule_lookup" {
		t.Fatalf("visible tools = %#v, want transport_schedule_lookup only", starter.input.VisibleToolNames)
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
	traceHeaders := telemetry.InjectExecutionTraceHeaders(starter.ctx, "req-traceparent-001", "trace-traceparent-001")
	if traceHeaders["traceparent"] != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" {
		t.Fatalf("Temporal starter context traceparent = %q", traceHeaders["traceparent"])
	}
	if traceHeaders["baggage"] != "release=2026.06.18" {
		t.Fatalf("Temporal starter context baggage = %q", traceHeaders["baggage"])
	}
}

func TestExecutionRunCreateKeepsNeutralToolForPrimaryAgentWorkflow(t *testing.T) {
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
			"runtime_versions":{"contract":"durable-agent-runtime-contract-v1"},
			"metadata":{
				"execution_payload":{
					"execution_contract_version":"tool_execution_v1",
					"response_contract":"execution_finalization_response_v2",
					"user_goal":"hi 你是谁",
					"request_id":"req-temporal-neutral",
					"conversation_id":"conv-temporal-neutral",
					"trace":{"trace_id":"trace-temporal-neutral"},
					"context":{"actor":{"user_id":"user-temporal-neutral"}},
					"version_query":{}
					}
				}
			}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.input.RequestedTool != "" {
		t.Fatalf(
			"workflow requested tool = %q, want empty before primary agent",
			starter.input.RequestedTool,
		)
	}
	if len(starter.input.VisibleToolNames) != 2 ||
		starter.input.VisibleToolNames[0] != "transport_schedule_lookup" ||
		starter.input.VisibleToolNames[1] != "knowledge_query" {
		t.Fatalf(
			"visible tools = %#v, want registry model-visible tools",
			starter.input.VisibleToolNames,
		)
	}
	run, err := store.GetRun(context.Background(), "run-temporal-neutral")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if run.RequestedTool != "" {
		t.Fatalf("run requested tool = %q, want empty", run.RequestedTool)
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
			Tool:                 "",
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
	seedCancelProjectionStep("finalization.write", "scheduled", time.Time{}, time.Time{})

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
		stepByID["finalization.write"].Status != "canceled" {
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
	if attemptByStep["finalization.write"].Status != "canceled" ||
		attemptByStep["finalization.write"].CancelOutcome != execution.CancelOutcomeRequestedBeforeStart ||
		attemptByStep["finalization.write"].TerminalReason != string(execution.DurableTerminalReasonUserCanceled) {
		t.Fatalf("scheduled attempt cancel evidence = %#v", attemptByStep["finalization.write"])
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
		StepID:               "agent.primary",
		RunID:                "run-temporal-trajectory",
		ConversationID:       "conv-temporal-trajectory",
		StepKind:             "agent",
		Status:               "completed",
		TaskQueue:            temporalruntime.ActivityTaskQueueAgent,
		WorkerID:             "staging:context:worker-1",
		StartedAt:            now,
		CompletedAt:          now.Add(100 * time.Millisecond),
		UpdatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"payload_ref":        "projection://runs/run-temporal-trajectory/agent/primary/input",
			"raw_prompt":         "must not leak",
			"visible_tool_names": []any{"knowledge_query"},
		},
	}); err != nil {
		t.Fatalf("upsert step: %v", err)
	}
	if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
		AttemptID:             "agent.primary:attempt:1",
		StepID:                "agent.primary",
		RunID:                 "run-temporal-trajectory",
		Attempt:               1,
		Status:                "completed",
		TaskQueue:             temporalruntime.ActivityTaskQueueAgent,
		WorkerID:              "staging:context:worker-1",
		WorkflowID:            "campus-agent.chat.run-temporal-trajectory",
		TemporalRunID:         "temporal-run-trajectory",
		ActivityID:            "activity-agent-1",
		ActivityType:          temporalruntime.ExecutePrimaryAgentActivityName,
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
		CancelOutcome:         execution.CancelOutcomeNotRequested,
		TimeoutOutcome:        execution.TimeoutOutcomeNotTimedOut,
		LateCompletionOutcome: execution.LateCompletionOutcomeIgnoredAfterTimeout,
		FailCloseReason:       "current_state_unverifiable",
		TerminalReason:        "answer_completed",
		UpdatedAt:             now.Add(100 * time.Millisecond),
		PayloadSchemaVersion:  "step-attempt-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_type": temporalruntime.ExecutePrimaryAgentActivityName,
			"raw_answer":    "must not leak",
		},
	}); err != nil {
		t.Fatalf("upsert attempt: %v", err)
	}
	if _, err := store.UpsertStepResult(context.Background(), execution.StepResultProjection{
		ResultID:             "agent.primary:result:1",
		StepID:               "agent.primary",
		RunID:                "run-temporal-trajectory",
		AttemptID:            "agent.primary:attempt:1",
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "projection://runs/run-temporal-trajectory/agent/primary/result",
		CreatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"result_ref":          "projection://runs/run-temporal-trajectory/agent/primary/result",
			"raw_provider_result": "must not leak",
			"selected_tools":      []any{"knowledge_query", "knowledge_search"},
			"tool_results": []any{
				map[string]any{
					"arguments_json_sha256": "sha256:knowledge-search",
					"authorization":         "nested authorization must not leak",
					"payload_kind":          "knowledge_search",
					"result": map[string]any{
						"outcome":        "found",
						"resolved_scope": "student_rules",
						"source_body":    "nested source body must not leak",
					},
					"result_ref": "projection://runs/run-temporal-trajectory/knowledge/search/search-1",
					"status":     "completed",
					"tool_name":  "knowledge_search",
				},
			},
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
	if step["step_kind"] != "agent" || step["task_queue"] != temporalruntime.ActivityTaskQueueAgent {
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
		"activity_id":             "activity-agent-1",
		"activity_type":           temporalruntime.ExecutePrimaryAgentActivityName,
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
		"cancel_outcome":          string(execution.CancelOutcomeNotRequested),
		"timeout_outcome":         string(execution.TimeoutOutcomeNotTimedOut),
		"late_completion_outcome": string(execution.LateCompletionOutcomeIgnoredAfterTimeout),
		"fail_close_reason":       "current_state_unverifiable",
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
	if evalTrajectory["selected_tool"] != "knowledge_query" {
		t.Fatalf("eval trajectory = %#v", evalTrajectory)
	}
	toolCalls, ok := evalTrajectory["tool_calls"].([]any)
	if !ok || len(toolCalls) != 1 {
		t.Fatalf("eval tool calls = %#v, want one tool call", evalTrajectory["tool_calls"])
	}
	toolCall := expectRecord(t, toolCalls[0], "agent_runtime_eval_projection.trajectory.tool_calls[0]")
	if toolCall["selected_tool"] != "knowledge_query" {
		t.Fatalf("eval tool call = %#v", toolCall)
	}
	serialized := response.Body.String()
	for _, forbidden := range []string{
		"must not leak",
		"raw_prompt",
		"raw_answer",
		"raw_provider_result",
		"source_body",
		"authorization",
	} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("step trajectory leaked forbidden payload %q: %s", forbidden, serialized)
		}
	}
}
