package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestAnswerRequestLogUsesSupervisorAPIEventName(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, nil))
	server := NewServerWithDependencies(config.Config{}, nil, nil, logger, nil)

	server.logAnswerRequest(
		context.Background(),
		"trace-001",
		http.StatusOK,
		"supervisor_response",
		12*time.Millisecond,
	)

	logged := logBuffer.String()
	if !strings.Contains(logged, "supervisor_api.answer_request") {
		t.Fatalf("log output = %q, want supervisor_api.answer_request", logged)
	}
	staleNamespace := "go_" + "shell."
	if strings.Contains(logged, staleNamespace) {
		t.Fatalf("log output = %q, must not contain stale namespace", logged)
	}
}

func TestAnswerLogsTraceAndOutcomeWithoutUserGoal(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuffer, nil))
	server := NewServerWithDependencies(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  8,
		},
		&fakeBridge{
			configured: true,
			response: bridge.ExecuteResponse{
				StatusCode: http.StatusOK,
				Kind:       "agent_response",
				Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
			},
		},
		nil,
		logger,
		nil,
	)

	request := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		strings.NewReader(`{"user_goal":"secret-question","request_id":"req-log-redaction"}`),
	)
	request.Header.Set("authorization", "Bearer secret-token")
	request.Header.Set("x-trace-id", "trace-log-1")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}

	logOutput := logBuffer.String()
	if !strings.Contains(logOutput, `"trace_id":"trace-log-1"`) {
		t.Fatalf("expected log output to contain trace id, got: %s", logOutput)
	}
	if !strings.Contains(logOutput, `"outcome":"supervisor_response"`) {
		t.Fatalf("expected log output to contain outcome, got: %s", logOutput)
	}
	if strings.Contains(logOutput, "secret-question") {
		t.Fatalf("log output should not contain raw user_goal, got: %s", logOutput)
	}
}
