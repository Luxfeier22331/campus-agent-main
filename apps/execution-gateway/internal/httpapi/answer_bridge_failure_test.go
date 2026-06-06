package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestAnswerBridgeProtocolFailureAuditIncludesBridgeDuration(t *testing.T) {
	received := make(chan map[string]any, 1)
	auditServer := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode audit body: %v", err)
		}
		received <- body
		response.WriteHeader(http.StatusOK)
	}))
	defer auditServer.Close()

	server := NewServer(config.Config{
		AuthMode:                   "bearer",
		BearerToken:                "secret-token",
		DefaultActorID:             "runtime-bearer-user",
		ExecutionAuditEnabled:      true,
		ExecutionAuditSharedSecret: "audit-secret",
		ExecutionAuditTimeoutMS:    500,
		ExecutionAuditURL:          auditServer.URL + "/api/internal/execution/audit-events",
		RequestBodyLimitBytes:      1_048_576,
		MaxConcurrentAnswers:       8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			time.Sleep(2 * time.Millisecond)
			return bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "",
				Body:       json.RawMessage(`{}`),
			}, nil
		},
	})
	defer func() {
		_ = server.Shutdown(context.Background())
	}()
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-audit-bridge-protocol"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_invalid_response")
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
		if event["bridge_duration_ms"] == nil {
			t.Fatalf("bridge_duration_ms = nil, want measured duration: %#v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for execution audit event")
	}
}

func TestAnswerMapsBridgeTimeout(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		BridgeTimeoutMS:       1,
	}, &fakeBridge{
		configured: true,
		executeErr: context.DeadlineExceeded,
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-timeout"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusGatewayTimeout, "supervisor_bridge_timeout")
}

func TestAnswerRedactsBridgeTransportError(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeErr: errors.New("dial http://internal-host:1234/secret?token=raw-token: connection refused"),
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-bridge-redaction"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	assertError(t, response, http.StatusBadGateway, "supervisor_bridge_unavailable")
	body := response.Body.String()
	if !strings.Contains(body, "Supervisor Python bridge is unavailable.") {
		t.Fatalf("response body missing sanitized bridge message: %s", body)
	}
	for _, secret := range []string{"internal-host", "/secret", "raw-token"} {
		if strings.Contains(body, secret) {
			t.Fatalf("response body leaked bridge error detail %q: %s", secret, body)
		}
	}
}

func TestAnswerReturnsWithoutWritingWhenClientContextIsCanceled(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, &fakeBridge{
		configured: true,
		executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
			<-ctx.Done()
			return bridge.ExecuteResponse{}, ctx.Err()
		},
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-client-cancelled"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	canceledContext, cancel := context.WithCancel(request.Context())
	cancel()
	request = request.WithContext(canceledContext)

	response := newTrackingResponseWriter()
	server.ServeHTTP(response, request)

	if response.wrote {
		t.Fatalf("expected canceled request to stop without writing response, wrote status %d", response.status)
	}
}
