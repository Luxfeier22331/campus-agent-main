package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
)

func TestLegacyAnswerRoutesAreNotActiveServingPaths(t *testing.T) {
	server := NewServer(config.Config{AppName: "campus-agent"})

	for _, route := range []string{"/answer", "/answer/stream"} {
		response := httptest.NewRecorder()
		server.ServeHTTP(
			response,
			newTestRequest(http.MethodPost, route, strings.NewReader(`{"request_id":"req_legacy"}`)),
		)

		assertError(t, response, http.StatusNotFound, "not_found")
	}
}
