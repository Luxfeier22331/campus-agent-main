package httpapi

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestExecutionRunCancelPersistsCommandBeforeTemporalFinalization(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-callback-before-cancel",
		"conv-callback-before-cancel",
		time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC),
		nil,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/requests/run-callback-before-cancel/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	run, err := store.GetRun(context.Background(), "run-callback-before-cancel")
	if err != nil {
		t.Fatalf("get run after callback failure: %v", err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("cancel request must not publish terminal state: %q", run.Status)
	}
	events, err := store.ListRunEvents(context.Background(), "run-callback-before-cancel")
	if err != nil {
		t.Fatalf("list cancel command events: %v", err)
	}
	for _, event := range events {
		if event.EventType == execution.DurableRunEventTypeRunCanceled {
			t.Fatal("run.canceled became visible before Temporal finalization")
		}
	}
}

func TestExecutionRunCancelDefersCancellationUntilReconcilerCanVerifyIdentity(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
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
		agentRequestForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/requests/run-temporal-cancel/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	if starter.cancelRunID != "" {
		t.Fatalf("Temporal cancel must be deferred to the reconciler: run=%q", starter.cancelRunID)
	}
	reconcileTemporalRunsOnceForTest(context.Background(), server)
	if starter.cancelRunID != "" || starter.cancelReason != "" {
		t.Fatalf("Temporal cancel used unverified legacy identity: run=%q reason=%q", starter.cancelRunID, starter.cancelReason)
	}
}

func TestExecutionRunCancelRejectsUnsupportedReasonCodes(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	starter := &fakeTemporalStarter{}
	server := newWorkerAuthServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	server.temporalStarter = starter
	now := time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-temporal-cancel-invalid-reason",
		"conv-temporal-cancel-invalid-reason",
		now,
		agentRequestForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/requests/run-temporal-cancel-invalid-reason/cancel",
		strings.NewReader(`{"reason":"operator typed free text"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadRequest, "invalid_request")
	if starter.cancelRunID != "" || starter.cancelReason != "" {
		t.Fatalf("Temporal cancel must not be called for invalid reason: run=%q reason=%q", starter.cancelRunID, starter.cancelReason)
	}
	run, err := store.GetRun(context.Background(), "run-temporal-cancel-invalid-reason")
	if err != nil {
		t.Fatalf("get run after invalid cancel: %v", err)
	}
	if run.Status == execution.DurableRunStatusCanceled {
		t.Fatal("invalid cancel reason must not mark projection canceled")
	}
}

func TestExecutionRunCancelRetriesWhenTemporalIdentityIsUnavailable(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
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
		agentRequestForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/requests/run-temporal-cancel-fail/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")

	server.ServeHTTP(response, request)

	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	reconcileTemporalRunsOnceForTest(context.Background(), server)
	if starter.cancelRunID != "" {
		t.Fatalf("Temporal cancel used unverified identity: run=%q", starter.cancelRunID)
	}
	run, err := store.GetRun(context.Background(), "run-temporal-cancel-fail")
	if err != nil {
		t.Fatalf("get run after failed cancel: %v", err)
	}
	if run.Status != execution.DurableRunStatusQueued {
		t.Fatalf("failed Temporal cancel must leave run nonterminal, got %q", run.Status)
	}
	leaseNow := time.Now().UTC().Add(time.Minute)
	commands, err := store.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "test-cancel-retry",
		Now:        leaseNow,
		LeaseUntil: leaseNow.Add(time.Minute),
		Limit:      1,
	})
	if err != nil {
		t.Fatalf("lease retriable cancellation command: %v", err)
	}
	if len(commands) != 1 || commands[0].LastErrorCode != "temporal_cancel_identity_unavailable" {
		t.Fatalf("retriable cancellation commands = %#v, want one identity-unavailable command", commands)
	}
}

func TestExecutionRunCancelDoesNotDependOnStaleGetRunSnapshot(t *testing.T) {
	base := executionpersistence.NewInMemoryRunProjectionStore()
	server := newWorkerAuthServerForTest()
	now := time.Date(2026, 7, 23, 11, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(t, base, "run-cancel-atomic-store", "conv-cancel-atomic-store", now, nil)
	store := failingGetRunProjectionStore{RunProjectionStore: base, err: errors.New("stale read unavailable")}
	attachRunProjectionStoreForHandlerTest(server, store)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/requests/run-cancel-atomic-store/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	server.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202; body: %s", response.Code, response.Body.String())
	}
	commands, err := base.LeaseRunCancellationCommands(context.Background(), execution.LifecycleLeaseRequest{
		LeaseToken: "cancel-atomic-store", Now: time.Now().UTC().Add(time.Minute),
		LeaseUntil: time.Now().UTC().Add(2 * time.Minute), Limit: 1,
	})
	if err != nil || len(commands) != 1 {
		t.Fatalf("atomic cancellation command = %#v, err=%v", commands, err)
	}
}

type failingGetRunProjectionStore struct {
	execution.RunProjectionStore
	err error
}

func (store failingGetRunProjectionStore) GetRun(
	context.Context,
	string,
) (execution.DurableRun, error) {
	return execution.DurableRun{}, store.err
}
