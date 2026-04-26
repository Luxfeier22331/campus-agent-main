package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestAnswerReturnsQueueFullWhenAdmissionQueueIsFull(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 0,
		QueueTimeout:  3 * time.Second,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         0,
			QueueTimeoutMS:        3_000,
		},
		&fakeBridge{configured: true},
		controller,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-queue-full"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_queue_full")
	if response.Header().Get("retry-after") != "3" {
		t.Fatalf("retry-after = %q, want 3", response.Header().Get("retry-after"))
	}
}

func TestAnswerQueueFullEmitsExecutionAuditEvent(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/internal/execution/audit-events" {
			t.Fatalf("audit path = %q, want /api/internal/execution/audit-events", request.URL.Path)
		}
		if request.Header.Get("x-app-internal-auth") != "audit-secret" {
			t.Fatalf("x-app-internal-auth = %q, want audit-secret", request.Header.Get("x-app-internal-auth"))
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 0,
		QueueTimeout:  3 * time.Second,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:                    "bearer",
			BearerToken:                 "secret-token",
			DefaultActorID:              "runtime-bearer-user",
			ExecutionAuditBatchSize:     1,
			ExecutionAuditEnabled:       true,
			ExecutionAuditQueueCapacity: 4,
			ExecutionAuditSharedSecret:  "audit-secret",
			ExecutionAuditTimeoutMS:     500,
			ExecutionAuditURL:           auditServer.URL + "/api/internal/execution/audit-events",
			RequestBodyLimitBytes:       1_048_576,
			MaxConcurrentAnswers:        1,
			QueueCapacity:               0,
			QueueTimeoutMS:              3_000,
		},
		&fakeBridge{configured: true},
		controller,
	)
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-audit-queue-full"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_queue_full")
	select {
	case body := <-received:
		events, ok := body["events"].([]any)
		if !ok || len(events) != 1 {
			t.Fatalf("events = %#v, want one event", body["events"])
		}
		event, ok := events[0].(map[string]any)
		if !ok {
			t.Fatalf("event = %#v, want object", events[0])
		}
		if event["event_type"] != "execution.admission_rejected" {
			t.Fatalf("event_type = %v, want execution.admission_rejected", event["event_type"])
		}
		if event["request_id"] != "req-audit-queue-full" {
			t.Fatalf("request_id = %v", event["request_id"])
		}
		if _, ok := event["user_goal"]; ok {
			t.Fatal("audit event must not include raw user_goal")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for execution audit event")
	}
}

func TestAnswerReturnsQueueTimeoutWhenAdmissionWaitExpires(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  5 * time.Millisecond,
	})
	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected setup acquire to succeed")
	}
	defer lease.Release()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         1,
			QueueTimeoutMS:        5,
		},
		&fakeBridge{configured: true},
		controller,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-queue-timeout"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_lane_queue_timeout")
}

func TestAnswerRejectsDuplicateInFlightRequestID(t *testing.T) {
	bridgeStarted := make(chan struct{})
	releaseBridge := make(chan struct{})
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		WorkerSharedSecret:    "worker-secret",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  2,
		QueueCapacity:         2,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			close(bridgeStarted)
			select {
			case <-ctx.Done():
				return bridge.ExecuteResponse{}, ctx.Err()
			case <-releaseBridge:
				return bridge.ExecuteResponse{
					StatusCode: http.StatusOK,
					Kind:       "agent_response",
					Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
				}, nil
			}
		},
	})

	firstRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-duplicate"),
	)
	firstRequest.Header.Set("authorization", "Bearer secret-token")
	firstResponse := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(firstResponse, firstRequest)
		close(done)
	}()

	select {
	case <-bridgeStarted:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start")
	}

	secondRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-duplicate"),
	)
	secondRequest.Header.Set("authorization", "Bearer secret-token")
	secondResponse := httptest.NewRecorder()
	server.ServeHTTP(secondResponse, secondRequest)
	assertError(t, secondResponse, http.StatusConflict, "execution_already_in_flight")

	close(releaseBridge)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("first request did not complete")
	}
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("first response status = %d, want 200; body: %s", firstResponse.Code, firstResponse.Body.String())
	}
}

func TestAnswerRejectsWhileAdmissionIsDraining(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 1,
		QueueTimeout:  time.Second,
	})
	controller.StartDraining()

	server := NewServerWithAdmission(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         1,
			QueueTimeoutMS:        1_000,
		},
		&fakeBridge{configured: true},
		controller,
	)
	response := httptest.NewRecorder()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-draining"),
	)
	request.Header.Set("authorization", "Bearer secret-token")

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusServiceUnavailable, "transport_draining")
}
