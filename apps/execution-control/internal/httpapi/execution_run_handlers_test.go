package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestDurableRunResponseIncludesFinalResponseRef(t *testing.T) {
	const finalResponseRef = "projection://runs/run-response/finalization/write"
	response := durableRunResponse(execution.DurableRun{FinalResponseRef: finalResponseRef})
	if response["final_response_ref"] != finalResponseRef {
		t.Fatalf("final_response_ref = %#v, want %q", response["final_response_ref"], finalResponseRef)
	}
}

func TestExecutionRunCreatePersistsStartIntentBeforeTemporalReconciliation(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
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
	body := decodeBody(t, response)
	if finalResponseRef, ok := body["final_response_ref"].(string); !ok || finalResponseRef != "" {
		t.Fatalf("final_response_ref = %#v, want empty string for a non-terminal run", body["final_response_ref"])
	}
	run, err := store.GetRun(context.Background(), "run-temporal-001")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("projection status = %q, want created before reconciliation", run.Status)
	}
	if starter.input.RunID != "" {
		t.Fatalf("Temporal start must be deferred to the reconciler: %#v", starter.input)
	}

	server.ReconcileTemporalRunsOnce(context.Background())

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
	if len(starter.input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames) != 0 {
		t.Fatalf("visible tools = %#v, want none", starter.input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames)
	}
	snapshot := starter.input.AdmissionSnapshot
	if snapshot.ToolRuntimeFingerprintSHA256 == "" ||
		validateToolRuntimeFingerprintSnapshot(snapshot.ToolRuntimeFingerprint) != nil {
		t.Fatalf("tool runtime admission snapshot = %#v", snapshot)
	}
}

func TestExecutionRunCreateHidesPersonalMemoryToolWhenRuntimeIsUnavailable(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := strings.Replace(
		durableRunCreateBodyForTest("run-memory-runtime-unavailable", "conv-memory-runtime-unavailable"),
		`"personal_memory_recall_allowed":false`,
		`"personal_memory_recall_allowed":true`,
		1,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	server.ReconcileTemporalRunsOnce(context.Background())
	strategy := starter.input.AdmissionSnapshot.ExecutionStrategy
	if strategy.MemoryRecall != "disabled" || strategy.MaxToolCalls != 0 || len(strategy.VisibleToolNames) != 0 {
		t.Fatalf("execution strategy = %#v, want memory disabled", strategy)
	}
}

func TestExecutionRunCreateClassifiesExecutionInputErrors(t *testing.T) {
	for _, test := range []struct {
		code       string
		name       string
		retryable  bool
		runID      string
		statusCode int
	}{
		{
			code:       "dependency_not_ready",
			name:       "retryable upstream failure",
			retryable:  true,
			runID:      "run-execution-input-retryable",
			statusCode: http.StatusServiceUnavailable,
		},
		{
			code:       "execution_workflow_input_invalid",
			name:       "deterministic contract failure",
			retryable:  false,
			runID:      "run-execution-input-deterministic",
			statusCode: http.StatusBadRequest,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := execution.NewInMemoryRunProjectionStore()
			server := newWorkerAuthServerForTest()
			attachAgentAdmissionProviderConfigsForTest(server)
			attachRunProjectionStoreForHandlerTest(server, store)
			server.executionInputLoader = failingExecutionInputLoader{err: execution.NewInputError(
				"load",
				"execution_input_unavailable",
				test.retryable,
				errors.New("sensitive upstream failure"),
			)}

			response := httptest.NewRecorder()
			request := newTestRequest(
				http.MethodPost,
				"/internal/execution/runs",
				strings.NewReader(durableRunCreateBodyForTest(test.runID, "conv-"+test.runID)),
			)
			request.Header.Set("x-worker-origin-auth", "secret")

			server.ServeHTTP(response, request)

			assertError(t, response, test.statusCode, test.code)
			body := decodeBody(t, response)
			errorBody := expectRecord(t, body["error"], "error")
			if errorBody["retryable"] != test.retryable {
				t.Fatalf("retryable = %#v, want %t", errorBody["retryable"], test.retryable)
			}
			if test.retryable && errorBody["message"] != "A required execution dependency is not ready." {
				t.Fatalf("message = %#v", errorBody["message"])
			}
			if strings.Contains(response.Body.String(), "sensitive upstream failure") {
				t.Fatalf("execution input error leaked upstream detail: %s", response.Body.String())
			}
			if _, err := store.GetRun(context.Background(), test.runID); err == nil {
				t.Fatal("execution input failure must not create a run projection")
			}
		})
	}
}

func TestExecutionRunCreateReturnsDependencyNotReadyForAdmissionDependencies(t *testing.T) {
	for _, test := range []struct {
		configure func(*Server)
		name      string
		runID     string
	}{
		{
			name:  "llm provider missing",
			runID: "run-llm-provider-missing",
			configure: func(server *Server) {
				server.providerConfigResolver = staticProviderConfigResolver{
					providerconfig.KindEmbedding: embeddingProviderConfigSnapshotForTest(
						providerconfig.KindEmbedding,
						"https://embedding.example/v1",
					),
				}
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := execution.NewInMemoryRunProjectionStore()
			server := newWorkerAuthServerForTest()
			attachAgentAdmissionProviderConfigsForTest(server)
			test.configure(server)
			attachRunProjectionStoreForHandlerTest(server, store)

			response := httptest.NewRecorder()
			request := newTestRequest(
				http.MethodPost,
				"/internal/execution/runs",
				strings.NewReader(durableRunCreateBodyForTest(test.runID, "conv-"+test.runID)),
			)
			request.Header.Set("x-worker-origin-auth", "secret")

			server.ServeHTTP(response, request)

			assertError(t, response, http.StatusServiceUnavailable, "dependency_not_ready")
			body := decodeBody(t, response)
			errorBody := expectRecord(t, body["error"], "error")
			if errorBody["retryable"] != true {
				t.Fatalf("retryable = %#v, want true", errorBody["retryable"])
			}
			if errorBody["message"] != "A required execution dependency is not ready." {
				t.Fatalf("message = %#v", errorBody["message"])
			}
			if strings.Contains(response.Body.String(), "sensitive") ||
				strings.Contains(response.Body.String(), "no active model setting") {
				t.Fatalf("dependency error leaked internal detail: %s", response.Body.String())
			}
			if _, err := store.GetRun(context.Background(), test.runID); err == nil {
				t.Fatal("dependency admission failure must not create a run projection")
			}
		})
	}
}

func TestExecutionRunCreateReturnsDependencyNotReadyForToolRuntimeRegistry(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, "configs", "runtime")
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("create runtime config directory: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "tools.v6.json"), []byte("{"), 0o600); err != nil {
		t.Fatalf("write malformed tool registry: %v", err)
	}
	t.Chdir(root)

	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	const runID = "run-tool-runtime-registry-invalid"

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest(runID, "conv-"+runID)),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "dependency_not_ready")
	body := decodeBody(t, response)
	errorBody := expectRecord(t, body["error"], "error")
	if errorBody["retryable"] != true ||
		errorBody["message"] != "A required execution dependency is not ready." ||
		strings.Contains(response.Body.String(), "invalid character") {
		t.Fatalf("tool runtime dependency error was not sanitized and retryable: %s", response.Body.String())
	}
	if _, err := store.GetRun(context.Background(), runID); err == nil {
		t.Fatal("tool runtime admission failure must not create a run projection")
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
		`"surface":"campus-web"`,
		`"surface":"campus-web","execution_payload":{"unexpected":true}`,
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

func TestExecutionRunCreateRejectsCallerToolHint(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := durableRunCreateBodyWithToolForTest(
		"run-campus-closed",
		"conv-campus-closed",
		"unpublished_tool",
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if starter.input.RunID != "" {
		t.Fatalf("caller tool hint must not start workflow: %#v", starter.input)
	}
	if _, err := store.GetRun(context.Background(), "run-campus-closed"); err == nil {
		t.Fatal("caller tool hint must not create a run projection")
	}
}

func TestExecutionRunCreateRejectsKnownCallerToolHint(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	body := durableRunCreateBodyWithToolForTest(
		"run-campus-open",
		"conv-campus-open",
		"personal_memory_recall",
	)
	response := httptest.NewRecorder()
	request := newTestRequest(http.MethodPost, "/internal/execution/runs", strings.NewReader(body))
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if starter.input.RunID != "" {
		t.Fatalf("caller tool hint must not start workflow: %#v", starter.input)
	}
}

func TestExecutionRunCreatePropagatesInboundTraceContextToTemporalStart(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
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

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	server.ReconcileTemporalRunsOnce(context.Background())
	traceHeaders := telemetry.InjectExecutionTraceHeaders(starter.ctx, "req-traceparent-001", "trace-traceparent-001")
	if traceHeaders["traceparent"] != "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" {
		t.Fatalf("Temporal starter context traceparent = %q", traceHeaders["traceparent"])
	}
}

func TestExecutionRunCreateKeepsClosedToolsOutOfPrimaryAgent(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest(
			"run-temporal-neutral",
			"conv-temporal-neutral",
		)),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	server.ReconcileTemporalRunsOnce(context.Background())
	if len(starter.input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames) != 0 {
		t.Fatalf("visible tools = %#v, want none", starter.input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames)
	}
}

func TestExecutionRunCreateAcceptsWhenTemporalStarterMissing(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
	attachRunProjectionStoreForHandlerTest(server, store)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-temporal-missing", "conv-temporal-missing")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	run, err := store.GetRun(context.Background(), "run-temporal-missing")
	if err != nil {
		t.Fatalf("get run projection: %v", err)
	}
	if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("projection status = %q, want created", run.Status)
	}
	server.ReconcileTemporalRunsOnce(context.Background())
	if run, err = store.GetRun(context.Background(), "run-temporal-missing"); err != nil {
		t.Fatalf("get run after no-op reconciliation: %v", err)
	} else if run.Status != execution.DurableRunStatusCreated {
		t.Fatalf("projection status after no-op reconciliation = %q, want created", run.Status)
	}
}

func TestExecutionRunCreateRetriesWhenTemporalStartFails(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{err: context.DeadlineExceeded}
	server := newWorkerAuthServerForTest()
	attachAgentAdmissionProviderConfigsForTest(server)
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

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	server.ReconcileTemporalRunsOnce(context.Background())
	if _, err := store.GetRun(context.Background(), "run-temporal-fail"); err != nil {
		t.Fatalf("failed Temporal start must retain the durable run: %v", err)
	}
	intents, err := store.LeaseWorkflowStartIntents(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "test-start-retry",
		Now:        time.Now().UTC().Add(time.Minute),
		LeaseUntil: time.Now().UTC().Add(2 * time.Minute),
		Limit:      1,
	})
	if err != nil {
		t.Fatalf("lease retriable start intent: %v", err)
	}
	if len(intents) != 1 || intents[0].LastErrorCode != "temporal_workflow_start_uncertain" {
		t.Fatalf("retriable start intents = %#v, want one uncertain intent", intents)
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

func TestExecutionRunCancelDefersStepProjectionToTemporalFinalizer(t *testing.T) {
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
		agentRequestForDurableWorkerTest("hello"),
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
		stepKind := "agent"
		tool := ""
		taskQueue := temporalruntime.ActivityTaskQueueAgent
		payload := map[string]any{"step_id": stepID}
		if strings.HasPrefix(stepID, "sdk_tool.execute.personal_memory_recall.") {
			stepKind = "tool"
			tool = personalMemoryRecallToolName
			taskQueue = temporalruntime.ActivityTaskQueueForToolTarget(tool)
			payload["tool_name"] = tool
		}
		if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
			StepID:               stepID,
			RunID:                runID,
			ConversationID:       conversationID,
			StepKind:             stepKind,
			Tool:                 tool,
			Status:               status,
			TaskQueue:            taskQueue,
			WorkerID:             "test:agent:001",
			StartedAt:            startedAt,
			CompletedAt:          completedAt,
			UpdatedAt:            now.Add(4 * time.Second),
			PayloadSchemaVersion: "run-step-projection-v1",
			SanitizedPayload:     payload,
		}); err != nil {
			t.Fatalf("seed step %s: %v", stepID, err)
		}
		if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
			AttemptID:             stepID + ":attempt:1",
			StepID:                stepID,
			RunID:                 runID,
			Attempt:               1,
			Status:                status,
			TaskQueue:             taskQueue,
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
			SanitizedPayload:      payload,
		}); err != nil {
			t.Fatalf("seed attempt %s: %v", stepID, err)
		}
	}
	memoryStepID := "sdk_tool.execute.personal_memory_recall.1"
	seedCancelProjectionStep(
		memoryStepID,
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
	server.ReconcileTemporalRunsOnce(context.Background())
	if starter.cancelRunID != "" {
		t.Fatalf("reconciler must not cancel without verified workflow identity: run=%q", starter.cancelRunID)
	}
	steps, err := store.ListRunSteps(context.Background(), runID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	stepByID := map[string]execution.RunStepProjection{}
	for _, step := range steps {
		stepByID[step.StepID] = step
	}
	if stepByID[memoryStepID].Status != "completed" {
		t.Fatalf("completed step changed after cancel: %#v", stepByID[memoryStepID])
	}
	if stepByID["agent.primary"].Status != "running" ||
		stepByID["finalization.write"].Status != "scheduled" {
		t.Fatalf("HTTP cancel must not project step terminal state: %#v", stepByID)
	}
	attempts, err := store.ListStepAttempts(context.Background(), runID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	attemptByStep := map[string]execution.StepAttemptProjection{}
	for _, attempt := range attempts {
		attemptByStep[attempt.StepID] = attempt
	}
	if attemptByStep[memoryStepID].Status != "completed" ||
		attemptByStep[memoryStepID].CancelOutcome != execution.CancelOutcomeNotRequested {
		t.Fatalf("completed attempt changed after cancel: %#v", attemptByStep[memoryStepID])
	}
	if attemptByStep["agent.primary"].Status != "running" ||
		attemptByStep["agent.primary"].CancelOutcome != execution.CancelOutcomeNotRequested {
		t.Fatalf("HTTP cancel must not project started attempt terminal state: %#v", attemptByStep["agent.primary"])
	}
	if attemptByStep["finalization.write"].Status != "scheduled" ||
		attemptByStep["finalization.write"].CancelOutcome != execution.CancelOutcomeNotRequested {
		t.Fatalf("HTTP cancel must not project scheduled attempt terminal state: %#v", attemptByStep["finalization.write"])
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
		agentRequestForDurableWorkerTest("hello"),
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
			"visible_tool_names": []any{"personal_memory_recall"},
		},
	}); err != nil {
		t.Fatalf("upsert step: %v", err)
	}
	if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
		AttemptID:             temporalStepAttemptID("run-temporal-trajectory", "agent.primary", 1),
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
		AttemptID:            temporalStepAttemptID("run-temporal-trajectory", "agent.primary", 1),
		Status:               "completed",
		ResultKind:           "agent_final_output",
		ProjectionRef:        "projection://runs/run-temporal-trajectory/agent/primary/result",
		CreatedAt:            now.Add(100 * time.Millisecond),
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload: map[string]any{
			"activity_attempt":    1,
			"result_ref":          "projection://runs/run-temporal-trajectory/agent/primary/result",
			"raw_provider_result": "must not leak",
			"tool_results": []any{
				map[string]any{
					"arguments_json_sha256": "sha256:personal-memory-recall",
					"authorization":         "nested authorization must not leak",
					"payload_kind":          "personal_memory_recall",
					"result": map[string]any{
						"outcome":     "matched",
						"memory_text": "nested memory text must not leak",
						"source_body": "nested source body must not leak",
					},
					"result_ref": "projection://runs/run-temporal-trajectory/sdk-tools/personal_memory_recall/1",
					"status":     "completed",
					"tool_name":  "personal_memory_recall",
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
	if evalProjection["schema_version"] != "agent_runtime_eval_projection.v3" {
		t.Fatalf("eval projection schema = %#v", evalProjection["schema_version"])
	}
	evalRun := expectRecord(t, evalProjection["run"], "agent_runtime_eval_projection.run")
	if evalRun["run_id"] != "run-temporal-trajectory" ||
		evalRun["request_id"] != "req-executor-001" ||
		evalRun["trace_id"] != "trace-executor-001" {
		t.Fatalf("eval projection run identity = %#v", evalRun)
	}
	evalTrajectory := expectRecord(t, evalProjection["trajectory"], "agent_runtime_eval_projection.trajectory")
	if _, exists := evalTrajectory["selected_tool"]; exists {
		t.Fatalf("eval trajectory must not expose selected_tool: %#v", evalTrajectory)
	}
	toolCalls, ok := evalTrajectory["tool_calls"].([]any)
	if !ok || len(toolCalls) != 0 {
		t.Fatalf("eval tool calls = %#v, want only durable SDK tool projections", evalTrajectory["tool_calls"])
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
