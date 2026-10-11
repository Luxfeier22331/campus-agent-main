package httpapi

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/config"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRetiredToolRoutesAreNotServedByControl(t *testing.T) {
	server := NewServerWithOptions(config.Config{}, ServerOptions{})
	for _, path := range []string{"/internal/campus/search", "/internal/memory/personal/recall"} {
		response := httptest.NewRecorder()
		server.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d", path, response.Code)
		}
	}
}
