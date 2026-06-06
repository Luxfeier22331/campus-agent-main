package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/config"
)

func TestLegacyDurableHTTPRoutesAreRetired(t *testing.T) {
	server := NewServer(config.Config{
		WorkerSharedSecret:    "secret",
		RequestBodyLimitBytes: 1_048_576,
		MaxConcurrentAnswers:  8,
	}, nil)
	cases := []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/internal/durable/runs"},
		{method: http.MethodGet, path: "/internal/durable/runs/run-legacy"},
		{method: http.MethodGet, path: "/internal/durable/runs/run-legacy/events"},
		{method: http.MethodPost, path: "/internal/durable/runs/run-legacy/cancel"},
		{method: http.MethodPost, path: "/internal/durable/workers/process-next"},
		{method: http.MethodPost, path: "/api/v1/answer"},
		{method: http.MethodPost, path: "/api/v1/answer/stream"},
	}

	for _, tc := range cases {
		response := httptest.NewRecorder()
		request := newTestRequest(tc.method, tc.path, strings.NewReader(`{}`))
		request.Header.Set("x-worker-origin-auth", "secret")

		server.ServeHTTP(response, request)

		assertError(t, response, http.StatusNotFound, "not_found")
	}
}
