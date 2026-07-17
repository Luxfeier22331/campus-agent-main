package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestExecutionRunCancelPublishesTerminalStateOnlyAfterProductCallback(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
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
	server.productFinalizationWriter = func(
		_ context.Context,
		_ execution.DurableRun,
		_ time.Time,
		_ map[string]any,
	) error {
		events, err := store.ListRunEvents(context.Background(), "run-callback-before-cancel")
		if err != nil {
			t.Fatalf("list events in product callback: %v", err)
		}
		for _, event := range events {
			if event.EventType == execution.DurableRunEventTypeRunCanceled {
				t.Fatal("run.canceled became visible before product callback succeeded")
			}
		}
		return errors.New("callback unavailable")
	}

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-callback-before-cancel/cancel",
		strings.NewReader(`{"reason":"user_requested"}`),
	)
	request.Header.Set("x-worker-origin-auth", "secret")
	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "product_finalization_callback_failed")
	run, err := store.GetRun(context.Background(), "run-callback-before-cancel")
	if err != nil {
		t.Fatalf("get run after callback failure: %v", err)
	}
	if run.Status == execution.DurableRunStatusCanceled {
		t.Fatal("callback failure must leave run projection nonterminal")
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

func TestExecutionRunCancelRejectsUnsupportedReasonCodes(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
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
		ragHandoffForDurableWorkerTest("hello"),
	)

	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/internal/execution/runs/run-temporal-cancel-invalid-reason/cancel",
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
