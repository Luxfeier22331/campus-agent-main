package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

func TestMetricsEndpointReportsCountersForSuccessSaturationAndTimeout(t *testing.T) {
	controller := admission.NewController(admission.Config{
		MaxConcurrent: 1,
		QueueCapacity: 0,
		QueueTimeout:  3 * time.Second,
	})
	callCount := 0
	server := NewServerWithDependencies(
		config.Config{
			AuthMode:              "bearer",
			BearerToken:           "secret-token",
			DefaultActorID:        "runtime-bearer-user",
			RequestBodyLimitBytes: 1_048_576,
			MaxConcurrentAnswers:  1,
			QueueCapacity:         0,
			QueueTimeoutMS:        3_000,
		},
		&fakeBridge{
			configured: true,
			executeFn: func(ctx context.Context, request bridge.Request) (bridge.ExecuteResponse, error) {
				callCount++
				if callCount == 1 {
					return bridge.ExecuteResponse{
						StatusCode: http.StatusOK,
						Kind:       "agent_response",
						Body:       json.RawMessage(`{"selected_target":"rag-agent","status":"completed","answer_text":"ok"}`),
					}, nil
				}
				return bridge.ExecuteResponse{}, context.DeadlineExceeded
			},
		},
		controller,
		nil,
		nil,
	)

	successRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-metrics-success"),
	)
	successRequest.Header.Set("authorization", "Bearer secret-token")
	successResponse := httptest.NewRecorder()
	server.ServeHTTP(successResponse, successRequest)
	if successResponse.Code != http.StatusOK {
		t.Fatalf("success status = %d, want 200", successResponse.Code)
	}

	lease, decision := controller.Acquire(context.Background())
	if decision != admission.DecisionAdmittedImmediate {
		t.Fatal("expected limiter acquire to succeed for saturation setup")
	}
	saturatedRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-metrics-saturated"),
	)
	saturatedRequest.Header.Set("authorization", "Bearer secret-token")
	saturatedResponse := httptest.NewRecorder()
	server.ServeHTTP(saturatedResponse, saturatedRequest)
	lease.Release()
	assertError(t, saturatedResponse, http.StatusServiceUnavailable, "transport_queue_full")

	timeoutRequest := newTestRequest(
		http.MethodPost,
		"/api/v1/answer",
		delegateAnswerBody("req-metrics-timeout"),
	)
	timeoutRequest.Header.Set("authorization", "Bearer secret-token")
	timeoutResponse := httptest.NewRecorder()
	server.ServeHTTP(timeoutResponse, timeoutRequest)
	assertError(t, timeoutResponse, http.StatusGatewayTimeout, "supervisor_bridge_timeout")

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if metricsResponse.Code != http.StatusOK {
		t.Fatalf("metrics status = %d, want 200", metricsResponse.Code)
	}
	metricsBody := metricsResponse.Body.String()
	expectedSnippets := []string{
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="supervisor_response",status_class="2xx"} 1`,
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="transport_queue_full",status_class="5xx"} 1`,
		`campus_supervisor_api_requests_total{route="/api/v1/answer",outcome="supervisor_bridge_timeout",status_class="5xx"} 1`,
		`campus_supervisor_api_admission_decisions_total{decision="queue_full"} 1`,
		`campus_supervisor_api_admission_queue_depth 0`,
		`campus_supervisor_api_admission_active 0`,
		`campus_supervisor_api_bridge_failures_total{kind="timeout"} 1`,
		`campus_supervisor_api_inflight_requests{route="/api/v1/answer"} 0`,
	}
	for _, snippet := range expectedSnippets {
		if !strings.Contains(metricsBody, snippet) {
			t.Fatalf("expected metrics body to contain %q, got:\n%s", snippet, metricsBody)
		}
	}
}

func TestMetricsEndpointRequiresBearerTokenWhenConfigured(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers: 8,
		MetricsBearerToken:   "metrics-token",
	}, nil)

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(unauthorized, newTestRequest(http.MethodGet, "/metrics", nil))
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	authorized := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("authorization", "Bearer metrics-token")
	server.ServeHTTP(authorized, request)
	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized metrics status = %d, want 200", authorized.Code)
	}
	if !strings.Contains(authorized.Body.String(), "campus_supervisor_api_requests_total") {
		t.Fatalf("metrics body missing request total: %s", authorized.Body.String())
	}
}

func TestMetricsUsesStableRouteLabelForUnknownPaths(t *testing.T) {
	server := NewServer(config.Config{MaxConcurrentAnswers: 8}, nil)

	unknown := httptest.NewRecorder()
	server.ServeHTTP(unknown, newTestRequest(http.MethodGet, "/unexpected/student/123", nil))
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d, want 404", unknown.Code)
	}

	metrics := httptest.NewRecorder()
	server.ServeHTTP(metrics, newTestRequest(http.MethodGet, "/metrics", nil))
	body := metrics.Body.String()
	if !strings.Contains(body, `campus_supervisor_api_requests_total{route="/__unknown__",outcome="not_found",status_class="4xx"} 1`) {
		t.Fatalf("metrics body missing stable unknown route label:\n%s", body)
	}
	if strings.Contains(body, "/unexpected/student/123") {
		t.Fatalf("metrics body leaked raw unknown route label:\n%s", body)
	}
}
