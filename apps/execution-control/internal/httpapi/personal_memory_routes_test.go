package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRetiredPersonalMemoryControlPlaneRoutesAreNotExposed(t *testing.T) {
	server := newWorkerAuthServerForTest()
	paths := []string{
		"/internal/memory/hindsight/webhooks",
		"/internal/memory/personal/items:upsert",
		"/internal/memory/personal/items:disable",
		"/internal/memory/personal/owner:disable",
		"/internal/memory/personal/operations:status",
		"/internal/memory/personal/operations:list",
		"/internal/memory/personal/operations:cancel",
		"/internal/memory/personal/operations:retry",
		"/internal/memory/personal/turns:append",
		"/internal/memory/personal/graph:recall",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			request := newTestRequest(http.MethodPost, path, strings.NewReader(`{}`))
			request.Header.Set("x-worker-origin-auth", "secret")
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if response.Code != http.StatusNotFound {
				t.Fatalf("status = %d body = %s, want 404", response.Code, response.Body.String())
			}
		})
	}
}
