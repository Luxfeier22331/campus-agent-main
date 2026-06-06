package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestCancelEndpointCancelsActiveExecution(t *testing.T) {
	bridgeStarted := make(chan struct{})
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		WorkerSharedSecret:    "worker-secret",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  1,
		QueueCapacity:         1,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			close(bridgeStarted)
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})

	answerRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-cancel-active"),
	)
	answerRequest.Header.Set("authorization", "Bearer secret-token")
	answerResponse := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(answerResponse, answerRequest)
		close(done)
	}()

	select {
	case <-bridgeStarted:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start")
	}

	cancelRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/cancel",
		strings.NewReader(`{"request_id":"req-cancel-active","reason":"user_requested"}`),
	)
	cancelRequest.Header.Set("x-worker-origin-auth", "worker-secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancelRequest)
	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d, want 202; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	cancelBody := decodeBody(t, cancelResponse)
	if cancelBody["status"] != "cancel_requested" {
		t.Fatalf("cancel status body = %v, want cancel_requested", cancelBody["status"])
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("answer request did not finish after cancel")
	}
	assertError(t, answerResponse, statusClientClosedRequest, "execution_cancelled")

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		"campus_supervisor_api_lifecycle_cancel_requested_total 1",
	) {
		t.Fatalf("metrics missing cancel count:\n%s", metricsResponse.Body.String())
	}
}

func TestCancelEndpointPropagatesCooperativeCancelToPythonBridge(t *testing.T) {
	bridgeStarted := make(chan struct{})
	cancelSeen := make(chan bridge.CancelRequest, 1)
	auditEvents := make(chan map[string]any, 8)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode audit body: %v", err)
		}
		events, _ := body["events"].([]any)
		if len(events) != 1 {
			t.Fatalf("audit events = %#v, want one event", body["events"])
		}
		event, _ := events[0].(map[string]any)
		auditEvents <- event
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()
	server := NewServer(config.Config{
		AuthMode:                   "bearer",
		BearerToken:                "secret-token",
		WorkerSharedSecret:         "worker-secret",
		DefaultActorID:             "runtime-bearer-user",
		RequestBodyLimitBytes:      1_048_576,
		MaxConcurrentAnswers:       1,
		QueueCapacity:              1,
		BridgeCancelTimeoutMS:      500,
		ExecutionAuditEnabled:      true,
		ExecutionAuditURL:          auditServer.URL,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			close(bridgeStarted)
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
		cancelFn: func(ctx context.Context, request bridge.CancelRequest) (bridge.CancelResponse, error) {
			cancelSeen <- request
			return bridge.CancelResponse{
				StatusCode: http.StatusAccepted,
				Body:       json.RawMessage(`{"request_id":"req-cooperative-cancel","status":"cancel_requested"}`),
			}, nil
		},
	})

	answerRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-cooperative-cancel"),
	)
	answerRequest.Header.Set("authorization", "Bearer secret-token")
	answerResponse := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		server.ServeHTTP(answerResponse, answerRequest)
		close(done)
	}()

	select {
	case <-bridgeStarted:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start")
	}

	cancelRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/cancel",
		strings.NewReader(`{"request_id":"req-cooperative-cancel","reason":"user_requested"}`),
	)
	cancelRequest.Header.Set("x-worker-origin-auth", "worker-secret")
	cancelResponse := httptest.NewRecorder()
	server.ServeHTTP(cancelResponse, cancelRequest)
	if cancelResponse.Code != http.StatusAccepted {
		t.Fatalf("cancel status = %d, want 202; body: %s", cancelResponse.Code, cancelResponse.Body.String())
	}
	cancelBody := decodeBody(t, cancelResponse)
	if cancelBody["bridge_cancel_status"] != "accepted" {
		t.Fatalf("bridge_cancel_status = %v, want accepted", cancelBody["bridge_cancel_status"])
	}

	select {
	case request := <-cancelSeen:
		if request.RequestID != "req-cooperative-cancel" {
			t.Fatalf("bridge cancel request_id = %q", request.RequestID)
		}
		if request.Reason != "user_requested" {
			t.Fatalf("bridge cancel reason = %q", request.Reason)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for cooperative bridge cancel")
	}

	waitForCancelAudit := func() map[string]any {
		deadline := time.After(time.Second)
		for {
			select {
			case event := <-auditEvents:
				if event["event_type"] == "execution.cancel_requested" {
					return event
				}
			case <-deadline:
				t.Fatal("timed out waiting for cancel audit event")
				return nil
			}
		}
	}
	cancelAuditEvent := waitForCancelAudit()
	if cancelAuditEvent["bridge_cancel_status"] != "accepted" {
		t.Fatalf("audit bridge_cancel_status = %v, want accepted", cancelAuditEvent["bridge_cancel_status"])
	}

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("answer request did not finish after cancel")
	}
}

func TestCancelEndpointRequiresWorkerAuthAndActiveExecution(t *testing.T) {
	server := NewServer(config.Config{
		RequestBodyLimitBytes: 1_048_576,
		WorkerSharedSecret:    "worker-secret",
		MaxConcurrentAnswers:  1,
	}, nil)

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(
		unauthorized,
		newTestRequest(http.MethodPost, "/internal/execution/cancel", strings.NewReader(`{"request_id":"req-1"}`)),
	)
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	notFoundRequest := newTestRequest(
		http.MethodPost,
		"/internal/execution/cancel",
		strings.NewReader(`{"request_id":"req-missing"}`),
	)
	notFoundRequest.Header.Set("x-worker-origin-auth", "worker-secret")
	notFound := httptest.NewRecorder()
	server.ServeHTTP(notFound, notFoundRequest)
	assertError(t, notFound, http.StatusNotFound, "execution_not_found")
}
