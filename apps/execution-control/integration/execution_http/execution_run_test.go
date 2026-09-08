//go:build temporal_integration

package execution_http_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/integration/httpapitest"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
)

func TestExecutionRunHTTPStartsTemporalWorkflowAndProjectsCompletion(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	requestID := packageHarness.NewWorkflowID("http-completion")
	store := executionpersistence.NewInMemoryRunProjectionStore()
	activities := &projectionActivities{store: store}
	packageHarness.StartStandardWorkers(t, activities)
	server, reconciler := newExecutionServer(t, ctx, store)

	response := httptest.NewRecorder()
	request := httpapitest.ExecutionCreateRequest(ctx, requestID, "conversation-"+requestID, "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	reconciler.ReconcileOnce(ctx)
	packageHarness.CleanupRun(t, "campus-agent.chat."+requestID, "")
	completed := waitForRunStatus(
		t,
		ctx,
		store,
		requestID,
		execution.DurableRunStatusCompleted,
	)
	if completed.FinalResponseRef == "" {
		t.Fatalf("completed run missing final response ref: %#v", completed)
	}
	events, err := store.ListRunEvents(ctx, completed.RequestID)
	if err != nil {
		t.Fatalf("list run events: %v", err)
	}
	if !runEventsContain(events, execution.DurableRunEventTypeFinalizationCompleted) ||
		!runEventsContain(events, execution.DurableRunEventTypeRunCompleted) {
		t.Fatalf("completion events missing: %#v", events)
	}
	steps, err := store.ListRunSteps(ctx, completed.RequestID)
	if err != nil {
		t.Fatalf("list run steps: %v", err)
	}
	if !runStepsContainCompleted(steps, "finalization.write") {
		t.Fatalf("finalization step missing from projection: %#v", steps)
	}
	waitForTemporalHistoryEvent(
		t,
		ctx,
		"campus-agent.chat."+requestID,
		enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED,
	)
}

func TestExecutionRunHTTPCancelsTemporalWorkflowAndProjectsCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	requestID := packageHarness.NewWorkflowID("http-cancellation")
	store := executionpersistence.NewInMemoryRunProjectionStore()
	activities := &blockingProjectionActivities{
		projectionActivities: projectionActivities{store: store},
		started:              make(chan struct{}),
	}
	packageHarness.StartStandardWorkers(t, activities)
	server, reconciler := newExecutionServer(t, ctx, store)

	createResponse := httptest.NewRecorder()
	createRequest := httpapitest.ExecutionCreateRequest(ctx, requestID, "conversation-"+requestID, "secret")
	server.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusAccepted {
		t.Fatalf("create status = %d, want 202; body: %s", createResponse.Code, createResponse.Body.String())
	}
	reconciler.ReconcileOnce(ctx)
	packageHarness.CleanupRun(t, "campus-agent.chat."+requestID, "")
	select {
	case <-activities.started:
	case <-ctx.Done():
		t.Fatalf("wait for blocking agent activity: %v", ctx.Err())
	}

	cancelResponse := httptest.NewRecorder()
	cancelRequest := httptest.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"/internal/execution/requests/"+requestID+"/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	cancelRequest.Header.Set("x-worker-origin-auth", "secret")
	server.ServeHTTP(cancelResponse, cancelRequest)

	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d, want 202; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	reconciler.ReconcileOnce(ctx)
	canceled := waitForRunStatus(
		t,
		ctx,
		store,
		requestID,
		execution.DurableRunStatusCanceled,
	)
	if canceled.TerminalReason != execution.DurableTerminalReasonUserCanceled {
		t.Fatalf("terminal reason = %q, want user_canceled", canceled.TerminalReason)
	}
	waitForTemporalHistoryEvent(
		t,
		ctx,
		"campus-agent.chat."+requestID,
		enumspb.EVENT_TYPE_WORKFLOW_EXECUTION_CANCELED,
	)
}

func waitForRunStatus(
	t *testing.T,
	ctx context.Context,
	store *executionpersistence.InMemoryRunProjectionStore,
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

func waitForTemporalHistoryEvent(
	t *testing.T,
	ctx context.Context,
	workflowID string,
	eventType enumspb.EventType,
) {
	t.Helper()
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	for {
		history, err := packageHarness.History(ctx, workflowID, "")
		if err == nil && historyContainsEvent(history, eventType) {
			if historyContainsEvent(history, enumspb.EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT) {
				t.Fatal("workflow depended on activity timeout")
			}
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
