package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCampusSearchObservationRoute(t *testing.T) {
	server := newServerForTest()
	server.config.AgentRuntimeSharedSecret = "query-secret"
	valid := `{"invocationId":"call","workflowStepId":"step","activityAttempt":1,"searchQuery":"图书馆","phase":"queued","at":"2026-09-08T00:00:00Z"}`
	for _, test := range []struct {
		name, body, auth string
		status           int
	}{
		{"accepted without a diagnostic store", valid, "query-secret", 204},
		{"unauthorized", valid, "", 401},
		{"reject source body", strings.Replace(valid, `"phase":"queued"`, `"phase":"queued","snapshot":{"text":"private"}`, 1), "query-secret", 400},
		{"reject server phase", strings.Replace(valid, "queued", "selected", 1), "query-secret", 400},
		{"reject trailing json", valid + ` {}`, "query-secret", 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := newTestRequest(http.MethodPost, "/internal/execution/requests/request-one/campus-search/observations", strings.NewReader(test.body))
			request.Header.Set("x-execution-query-auth", test.auth)
			response := httptest.NewRecorder()
			server.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status %d, body %s", response.Code, response.Body.String())
			}
		})
	}
}
