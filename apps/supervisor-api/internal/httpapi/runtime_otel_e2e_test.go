package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

type capturedOTLPRequest struct {
	Method      string
	Path        string
	ContentType string
	Body        []byte
}

func TestRuntimeOtelOnlineSmokeExportsSanitizedTraceToCollector(t *testing.T) {
	received := make(chan capturedOTLPRequest, 4)
	collector := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read collector request body: %v", err)
		}
		received <- capturedOTLPRequest{
			Method:      request.Method,
			Path:        request.URL.Path,
			ContentType: request.Header.Get("content-type"),
			Body:        body,
		}
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.Close)

	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OTelEnabled:           true,
		OTelEndpoint:          collector.URL,
		OTelExportTimeoutMS:   500,
		OTelSampleRatio:       1,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "agent_response",
			Body: json.RawMessage(`{
				"selected_target":"rag-agent",
				"status":"completed",
				"answer_text":"ok"
			}`),
		},
	})
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	})

	rawQuery := "校园卡丢了怎么办"
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{
			"user_goal":"`+rawQuery+`",
			"request_id":"req-runtime-otel-online-smoke",
			"requested_scope":{"corpus":"regulations","collection":"student_rules"}
		}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	request.Header.Set("baggage", "release=phase5")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("shutdown exporter: %v", err)
	}

	collected := waitForOTLPRequest(t, received)
	if collected.Method != http.MethodPost {
		t.Fatalf("collector method = %s, want POST", collected.Method)
	}
	if collected.Path != "/v1/traces" {
		t.Fatalf("collector path = %s, want /v1/traces", collected.Path)
	}
	if !strings.Contains(collected.ContentType, "application/x-protobuf") {
		t.Fatalf("content-type = %q, want OTLP protobuf", collected.ContentType)
	}
	for _, required := range []string{
		"supervisor_api.runtime.request.accepted",
		"supervisor_api.agent.bridge.started",
		"supervisor_api.agent.bridge.completed",
		"supervisor_api.runtime.request.finalized",
		"req-runtime-otel-online-smoke",
		"telemetry.allowed_attributes_version",
	} {
		if !bytes.Contains(collected.Body, []byte(required)) {
			t.Fatalf("OTLP payload missing %q", required)
		}
	}
	for _, forbidden := range []string{
		rawQuery,
		"secret-token",
		"authorization",
		"cookie",
		"raw.prompt",
		"raw.query",
		"raw.answer",
	} {
		if bytes.Contains(collected.Body, []byte(forbidden)) {
			t.Fatalf("OTLP payload leaked forbidden value %q", forbidden)
		}
	}
}

func TestRuntimeOtelUnavailableCollectorDoesNotFailAnswerPath(t *testing.T) {
	server := NewServer(config.Config{
		AuthMode:              "bearer",
		BearerToken:           "secret-token",
		DefaultActorID:        "runtime-bearer-user",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
		OTelEnabled:           true,
		OTelEndpoint:          "http://127.0.0.1:1/v1/traces",
		OTelExportTimeoutMS:   10,
		OTelSampleRatio:       1,
	}, &fakeBridge{
		configured: true,
		response: bridge.ExecuteResponse{
			StatusCode: http.StatusOK,
			Kind:       "agent_response",
			Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
		},
	})
	t.Cleanup(func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	})
	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-runtime-otel-collector-down"),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	response := httptest.NewRecorder()

	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	status := server.telemetry.Status()
	if !status.Enabled || !status.ExporterConfigured {
		t.Fatalf("telemetry status = %#v, want enabled configured exporter", status)
	}
}

func waitForOTLPRequest(
	t *testing.T,
	received <-chan capturedOTLPRequest,
) capturedOTLPRequest {
	t.Helper()
	select {
	case request := <-received:
		return request
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for OTLP request")
	}
	return capturedOTLPRequest{}
}
