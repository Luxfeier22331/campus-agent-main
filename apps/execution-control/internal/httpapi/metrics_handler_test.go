package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestMetricsEndpointRequiresBearerTokenWhenConfigured(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers: 8,
		OpsWebInternalToken:  "ops-web-token",
	})

	unauthorized := httptest.NewRecorder()
	server.ServeHTTP(unauthorized, newTestRequest(http.MethodGet, "/metrics", nil))
	assertError(t, unauthorized, http.StatusUnauthorized, "unauthorized")

	authorized := httptest.NewRecorder()
	request := newTestRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("authorization", "Bearer ops-web-token")
	server.ServeHTTP(authorized, request)
	if authorized.Code != http.StatusOK {
		t.Fatalf("authorized metrics status = %d, want 200", authorized.Code)
	}
	if !strings.Contains(authorized.Body.String(), "campus_execution_control_requests_total") {
		t.Fatalf("metrics body missing request total: %s", authorized.Body.String())
	}
}

func TestMetricsEndpointRequiresBearerTokenOutsideLocalProfile(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers: 8,
		RuntimeMode:          "staging",
	})

	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/metrics", nil))
	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestMetricsUsesStableRouteLabelForUnknownPaths(t *testing.T) {
	server := newServerForTest()

	unknown := httptest.NewRecorder()
	server.ServeHTTP(unknown, newTestRequest(http.MethodGet, "/unexpected/student/123", nil))
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown route status = %d, want 404", unknown.Code)
	}

	metrics := httptest.NewRecorder()
	server.ServeHTTP(metrics, newTestRequest(http.MethodGet, "/metrics", nil))
	body := metrics.Body.String()
	if !strings.Contains(body, `campus_execution_control_requests_total{route="/__unknown__",outcome="not_found",status_class="4xx"} 1`) {
		t.Fatalf("metrics body missing stable unknown route label:\n%s", body)
	}
	if strings.Contains(body, "/unexpected/student/123") {
		t.Fatalf("metrics body leaked raw unknown route label:\n%s", body)
	}
}
