//go:build temporal_e2e

package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/worker"
)

func TestExecutionRunHTTPStartsTemporalWorkflowAndProjectsCompletion(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	devServer, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-http-temporal-e2e"},
		LogLevel:      "error",
	})
	if err != nil {
		t.Fatalf("start Temporal dev server: %v", err)
	}
	defer func() {
		if err := devServer.Stop(); err != nil {
			t.Fatalf("stop Temporal dev server: %v", err)
		}
	}()
	temporalClient := devServer.Client()
	store := execution.NewInMemoryRunProjectionStore()
	activities := &httpTemporalE2EActivities{store: store}
	workers := []worker.Worker{
		temporalruntime.NewWorkflowWorker(temporalClient, temporalruntime.WorkflowTaskQueue),
		temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCore,
			activities,
			activities,
			worker.Options{},
		),
		temporalruntime.NewAgentActivityWorker(temporalClient, temporalruntime.ActivityTaskQueueAgent, activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	starter, err := temporalruntime.NewStarter(ctx, temporalruntime.StarterOptions{
		Address:      devServer.FrontendHostPort(),
		Namespace:    "campus-agent-http-temporal-e2e",
		TaskQueue:    temporalruntime.WorkflowTaskQueue,
		StartTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("create Temporal starter: %v", err)
	}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-http-temporal-e2e", "conv-http-temporal-e2e")),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	completed := waitForRunStatus(
		t,
		ctx,
		store,
		"run-http-temporal-e2e",
		execution.DurableRunStatusCompleted,
	)
	if completed.FinalResponseRef == "" {
		t.Fatalf("completed run missing final response ref: %#v", completed)
	}
	events, err := store.ListRunEvents(ctx, completed.RunID)
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	if !runEventsContain(events, execution.DurableRunEventTypeFinalizationCompleted) ||
		!runEventsContain(events, execution.DurableRunEventTypeRunCompleted) {
		t.Fatalf("completion events missing: %#v", events)
	}
	steps, err := store.ListRunSteps(ctx, completed.RunID)
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if !runStepsContainCompleted(steps, "finalization.write") {
		t.Fatalf("finalization step missing from projection: %#v", steps)
	}
	waitForTemporalHistoryEvent(
		t,
		ctx,
		temporalClient,
		"campus-agent.chat.run-http-temporal-e2e",
		enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED,
	)
}

func TestExecutionRunHTTPCancelsTemporalWorkflowAndProjectsCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	devServer, err := testsuite.StartDevServer(ctx, testsuite.DevServerOptions{
		ClientOptions: &client.Options{Namespace: "campus-agent-http-temporal-cancel-e2e"},
		LogLevel:      "error",
	})
	if err != nil {
		t.Fatalf("start Temporal dev server: %v", err)
	}
	defer func() {
		if err := devServer.Stop(); err != nil {
			t.Fatalf("stop Temporal dev server: %v", err)
		}
	}()
	temporalClient := devServer.Client()
	store := execution.NewInMemoryRunProjectionStore()
	activities := &blockingHTTPTemporalE2EActivities{
		httpTemporalE2EActivities: httpTemporalE2EActivities{store: store},
		started:                   make(chan struct{}),
	}
	workers := []worker.Worker{
		temporalruntime.NewWorkflowWorker(temporalClient, temporalruntime.WorkflowTaskQueue),
		temporalruntime.NewCoreActivityWorkerWithOptions(
			temporalClient,
			temporalruntime.ActivityTaskQueueCore,
			activities,
			activities,
			worker.Options{},
		),
		temporalruntime.NewAgentActivityWorker(temporalClient, temporalruntime.ActivityTaskQueueAgent, activities),
	}
	for _, runtimeWorker := range workers {
		if err := runtimeWorker.Start(); err != nil {
			t.Fatalf("start worker: %v", err)
		}
		defer runtimeWorker.Stop()
	}

	starter, err := temporalruntime.NewStarter(ctx, temporalruntime.StarterOptions{
		Address:      devServer.FrontendHostPort(),
		Namespace:    "campus-agent-http-temporal-cancel-e2e",
		TaskQueue:    temporalruntime.WorkflowTaskQueue,
		StartTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("create Temporal starter: %v", err)
	}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter

	createResponse := httptest.NewRecorder()
	createRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs",
		strings.NewReader(durableRunCreateBodyForTest("run-http-temporal-cancel-e2e", "conv-http-temporal-cancel-e2e")),
	)
	createRequest.Header.Set("x-worker-origin-auth", "secret")
	server.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d, want 202; body: %s", createResponse.Code, createResponse.Body.String())
	}
	select {
	case <-activities.started:
	case <-ctx.Done():
		t.Fatalf("wait for blocking agent activity: %v", ctx.Err())
	}

	cancelResponse := httptest.NewRecorder()
	cancelRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-http-temporal-cancel-e2e/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	cancelRequest.Header.Set("x-worker-origin-auth", "secret")
	server.ServeHTTP(cancelResponse, cancelRequest)

	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d, want 202; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	canceled := waitForRunStatus(
		t,
		ctx,
		store,
		"run-http-temporal-cancel-e2e",
		execution.DurableRunStatusCanceled,
	)
	if canceled.TerminalReason != execution.DurableTerminalReasonUserCanceled {
		t.Fatalf("terminal reason = %q, want user_canceled", canceled.TerminalReason)
	}
	waitForTemporalHistoryEvent(
		t,
		ctx,
		temporalClient,
		"campus-agent.chat.run-http-temporal-cancel-e2e",
		enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED,
	)
}

type httpTemporalE2EActivities struct {
	store *execution.InMemoryRunProjectionStore
}

func (httpTemporalE2EActivities) AppendConversationMemoryActivity(
	_ context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return temporalruntime.AppendConversationMemoryActivityOutput{
		AppendedMessageCount: 1,
		RunID:                input.RunID,
		SchemaVersion:        "memory_conversation_append_result_v3",
		Status:               "completed",
	}, nil
}

func (httpTemporalE2EActivities) ExecutePersonalMemoryCommandActivity(
	_ context.Context,
	input memoryruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return temporalruntime.PersonalMemoryCommandActivityOutput{
		CommandID: input.CommandID,
		Status:    "succeeded",
	}, nil
}

func (httpTemporalE2EActivities) FinalizePersonalMemoryCommandReceiptActivity(
	_ context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return input.Result, nil
}

func (httpTemporalE2EActivities) WritePersonalMemoryCommandResultActivity(
	context.Context,
	temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	return nil
}

func (a httpTemporalE2EActivities) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	if err := a.transitionRunToRunning(ctx, input.RunID); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	return temporalruntime.ExecutePrimaryAgentActivityOutput{
		AgentResultRef: "projection://runs/" + input.RunID + "/agent/primary/result",
		FinalOutput:    "HTTP Temporal E2E answer",
		RunID:          input.RunID,
		Status:         "completed",
		TerminalReason: "answer_completed",
	}, nil
}

func (a httpTemporalE2EActivities) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	run, err := a.store.GetRun(ctx, input.RunID)
	if err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	completedAt := time.Now().UTC()
	finalizationRef := "projection://runs/" + input.RunID + "/finalization"
	if _, err := a.store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              input.RunID + ":finalization-completed",
		RunID:                input.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeFinalizationCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"agent_result_ref": input.AgentResult.AgentResultRef,
			"request_id":       run.RequestID,
			"trace_id":         run.TraceID,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if _, err := a.store.UpsertStepResult(ctx, execution.StepResultProjection{
		ResultID:             temporalStepResultID(input.RunID, "finalization.write", 1),
		StepID:               "finalization.write",
		RunID:                input.RunID,
		AttemptID:            temporalStepAttemptID(input.RunID, "finalization.write", 1),
		Status:               "completed",
		ResultKind:           "final_answer_projection",
		ProjectionRef:        finalizationRef,
		CreatedAt:            completedAt,
		PayloadSchemaVersion: "step-result-projection-v1",
		SanitizedPayload:     map[string]any{"activity_attempt": 1},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if _, err := a.store.CompleteRunProjection(ctx, execution.DurableRunCompleteRequest{
		FinalResponseRef: finalizationRef,
		Now:              completedAt,
		RunID:            input.RunID,
		TerminalReason:   execution.DurableTerminalReasonAnswerCompleted,
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if _, err := a.store.AppendRunEvent(ctx, execution.DurableRunEvent{
		EventID:              input.RunID + ":run-completed",
		RunID:                input.RunID,
		ConversationID:       run.ConversationID,
		EventType:            execution.DurableRunEventTypeRunCompleted,
		OccurredAt:           completedAt,
		Visibility:           execution.DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"projection_ref":  finalizationRef,
			"status":          string(execution.DurableRunStatusCompleted),
			"terminal_reason": string(execution.DurableTerminalReasonAnswerCompleted),
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	if _, err := a.store.UpsertRunStep(ctx, execution.RunStepProjection{
		StepID:               "finalization.write",
		RunID:                input.RunID,
		ConversationID:       run.ConversationID,
		StepKind:             "finalization",
		Tool:                 "",
		Status:               "completed",
		TaskQueue:            temporalruntime.ActivityTaskQueueCore,
		WorkerID:             "http-temporal-e2e",
		StartedAt:            completedAt,
		CompletedAt:          completedAt,
		UpdatedAt:            completedAt,
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload: map[string]any{
			"agent_result_ref": input.AgentResult.AgentResultRef,
			"projection_ref":   finalizationRef,
		},
	}); err != nil {
		return temporalruntime.WriteFinalizationActivityOutput{}, err
	}
	return temporalruntime.WriteFinalizationActivityOutput{
		CompletedAt:   completedAt,
		ProjectionRef: finalizationRef,
		RunID:         input.RunID,
		Status:        "completed",
	}, nil
}

func (a httpTemporalE2EActivities) FinalizeExecutionCancellationActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	run, err := a.store.CancelRunProjection(ctx, execution.DurableRunCancelRequest{
		RunID:  input.RunID,
		Reason: input.Reason,
		Now:    input.CanceledAt,
	})
	if err != nil {
		return temporalruntime.FinalizeExecutionCancellationActivityOutput{}, err
	}
	return temporalruntime.FinalizeExecutionCancellationActivityOutput{
		RunID:  run.RunID,
		Status: string(run.Status),
	}, nil
}

func (httpTemporalE2EActivities) FinalizeExecutionFailureActivity(
	_ context.Context,
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return temporalruntime.FinalizeExecutionFailureActivityOutput{
		CompletedAt: input.FailedAt,
		RunID:       input.RunID,
		Status:      "failed",
	}, nil
}

func (a httpTemporalE2EActivities) transitionRunToRunning(ctx context.Context, runID string) error {
	now := time.Now().UTC()
	run, err := a.store.GetRun(ctx, runID)
	if err != nil {
		return err
	}
	switch run.Status {
	case execution.DurableRunStatusQueued:
		if _, err := a.store.TransitionRun(ctx, runID, execution.DurableRunStatusAdmitted, "", now); err != nil {
			return err
		}
		_, err := a.store.TransitionRun(ctx, runID, execution.DurableRunStatusRunning, "", now)
		return err
	case execution.DurableRunStatusAdmitted:
		_, err := a.store.TransitionRun(ctx, runID, execution.DurableRunStatusRunning, "", now)
		return err
	case execution.DurableRunStatusRunning, execution.DurableRunStatusStreaming:
		return nil
	default:
		return nil
	}
}

type blockingHTTPTemporalE2EActivities struct {
	httpTemporalE2EActivities
	once    sync.Once
	started chan struct{}
}

func (a *blockingHTTPTemporalE2EActivities) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	if err := a.transitionRunToRunning(ctx, input.RunID); err != nil {
		return temporalruntime.ExecutePrimaryAgentActivityOutput{}, err
	}
	a.once.Do(func() { close(a.started) })
	<-ctx.Done()
	return temporalruntime.ExecutePrimaryAgentActivityOutput{}, ctx.Err()
}

func waitForRunStatus(
	t *testing.T,
	ctx context.Context,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	status execution.DurableRunStatus,
) execution.DurableRun {
	t.Helper()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		run, err := store.GetRun(ctx, runID)
		if err == nil && run.Status == status {
			return run
		}
		select {
		case <-ctx.Done():
			t.Fatalf("wait for run %s status %s: %v", runID, status, ctx.Err())
		case <-ticker.C:
		}
	}
}

func runEventsContain(events []execution.DurableRunEvent, eventType execution.DurableRunEventType) bool {
	for _, event := range events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}

func runStepsContainCompleted(steps []execution.RunStepProjection, stepID string) bool {
	for _, step := range steps {
		if step.StepID == stepID && step.Status == "completed" {
			return true
		}
	}
	return false
}

func temporalWorkflowHistory(
	ctx context.Context,
	temporalClient client.Client,
	workflowID string,
) (*historypb.History, error) {
	var history historypb.History
	iter := temporalClient.GetWorkflowHistory(ctx, workflowID, "", false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	for iter.HasNext() {
		event, err := iter.Next()
		if err != nil {
			return nil, err
		}
		history.Events = append(history.Events, event)
	}
	return &history, nil
}

func waitForTemporalHistoryEvent(
	t *testing.T,
	ctx context.Context,
	temporalClient client.Client,
	workflowID string,
	eventType enumspb.EventType,
) {
	t.Helper()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		history, err := temporalWorkflowHistory(ctx, temporalClient, workflowID)
		if err == nil && historyContainsEvent(history, eventType) {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("wait for Temporal history event %s on %s: %v", eventType, workflowID, ctx.Err())
		case <-ticker.C:
		}
	}
}

func historyContainsEvent(history *historypb.History, eventType enumspb.EventType) bool {
	for _, event := range history.GetEvents() {
		if event.GetEventType() == eventType {
			return true
		}
	}
	return false
}
