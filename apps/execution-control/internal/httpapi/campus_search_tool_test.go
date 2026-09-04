package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeCampusSearchToolEnvelopeAndRejectsUnauthenticatedRequests(t *testing.T) {
	valid := `{"access_context":{"activity_attempt":1,"request_id":"request-1","invocation_id":"call-1","citation_start":1,"result_limit":5,"user_goal":"本科生学籍规定"},"payload":{"search_query":"学籍规定"}}`
	envelope, err := decodeCampusSearchToolEnvelope([]byte(valid))
	if err != nil {
		t.Fatalf("decode valid campus search envelope: %v", err)
	}
	if envelope.Payload.SearchQuery != "学籍规定" || envelope.AccessContext.RequestID != "request-1" {
		t.Fatalf("decoded envelope = %#v", envelope)
	}
	if _, err := decodeCampusSearchToolEnvelope([]byte(strings.Replace(valid, `"payload"`, `"unexpected"`, 1))); err == nil {
		t.Fatal("decoder accepted an unknown field")
	}

	server := newServerForTest()
	server.config.AgentRuntimeSharedSecret = "execution-query-secret"
	request := newTestRequest(http.MethodPost, "/internal/campus/search", strings.NewReader(valid))
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}
