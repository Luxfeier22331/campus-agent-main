package adaptertest

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestWriteChatProductFinalizationBindsFingerprintToExactResponseJSON(t *testing.T) {
	type capturedRequest struct {
		body        []byte
		contentType string
		method      string
		path        string
		secret      string
	}
	captured := make(chan capturedRequest, 1)
	callback := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, "read request", http.StatusInternalServerError)
			return
		}
		captured <- capturedRequest{
			body:        body,
			contentType: request.Header.Get("content-type"),
			method:      request.Method,
			path:        request.URL.Path,
			secret:      request.Header.Get("x-app-product-callback-auth"),
		}
		response.WriteHeader(http.StatusNoContent)
	}))
	defer callback.Close()

	server := newAdapterForTest(config.Config{
		ProductCallbackBaseURL:      callback.URL,
		AppAPIExecutionSharedSecret: "callback-secret",
		ProductCallbackTimeoutMS:    1_000,
	})
	runID := "run-exact-response-json"
	completedAt := time.Date(2026, 7, 24, 8, 9, 10, 123_000_000, time.UTC)
	finalizedResponse := map[string]any{
		"answer_text": "escaped <>&\u2028\u2029",
		"result": map[string]any{
			"nested": map[string]any{"count": 7.25},
		},
		"status": "completed",
	}
	expectedResponseJSON, err := json.Marshal(finalizedResponse)
	if err != nil {
		t.Fatalf("marshal expected response: %v", err)
	}
	for _, escaped := range []string{`\u003c`, `\u003e`, `\u0026`, `\u2028`, `\u2029`} {
		if !strings.Contains(string(expectedResponseJSON), escaped) {
			t.Fatalf("response JSON %q does not contain %q", expectedResponseJSON, escaped)
		}
	}

	if err := server.WriteChatProductFinalization(
		context.Background(),
		execution.DurableRun{RequestID: runID},
		completedAt,
		finalizedResponse,
	); err != nil {
		t.Fatalf("write chat product finalization: %v", err)
	}
	request := <-captured
	if request.method != http.MethodPut || request.path != "/api/internal/execution/requests/"+runID+"/product-finalization" {
		t.Fatalf("callback request = %s %s", request.method, request.path)
	}
	if request.contentType != "application/json" || request.secret != "callback-secret" {
		t.Fatalf("callback headers content-type=%q secret=%q", request.contentType, request.secret)
	}

	var payload map[string]json.RawMessage
	if err := json.Unmarshal(request.body, &payload); err != nil {
		t.Fatalf("decode callback payload: %v", err)
	}
	if _, exists := payload["response"]; exists {
		t.Fatal("callback payload contains retired response field")
	}
	var responseJSON string
	if err := json.Unmarshal(payload["response_json"], &responseJSON); err != nil {
		t.Fatalf("decode response_json: %v", err)
	}
	if responseJSON != string(expectedResponseJSON) {
		t.Fatalf("response_json = %q, want exact marshaled bytes %q", responseJSON, expectedResponseJSON)
	}
	var fingerprint string
	if err := json.Unmarshal(payload["finalization_fingerprint"], &fingerprint); err != nil {
		t.Fatalf("decode finalization_fingerprint: %v", err)
	}
	sum := sha256.Sum256(append([]byte(runID+"\x00"), expectedResponseJSON...))
	if want := hex.EncodeToString(sum[:]); fingerprint != want {
		t.Fatalf("finalization_fingerprint = %q, want %q", fingerprint, want)
	}
	var completedAtPayload string
	if err := json.Unmarshal(payload["completed_at"], &completedAtPayload); err != nil {
		t.Fatalf("decode completed_at: %v", err)
	}
	if completedAtPayload != completedAt.Format(time.RFC3339Nano) {
		t.Fatalf("completed_at = %q, want %q", completedAtPayload, completedAt.Format(time.RFC3339Nano))
	}
}
