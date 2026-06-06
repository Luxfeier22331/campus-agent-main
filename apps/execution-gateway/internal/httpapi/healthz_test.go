package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/config"
)

func TestHealthzReturnsOk(t *testing.T) {
	server := NewServer(config.Config{AppName: "campus-agent"}, nil)
	response := httptest.NewRecorder()

	server.ServeHTTP(response, newTestRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}

	body := decodeBody(t, response)
	if body["status"] != "ok" {
		t.Fatalf("status body = %v, want ok", body["status"])
	}
	if body["app_name"] != "campus-agent" {
		t.Fatalf("app_name = %v, want campus-agent", body["app_name"])
	}
}
