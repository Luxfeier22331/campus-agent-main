package bridge

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPClientExecuteCallsPrivateBridgeEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", request.Method)
		}
		if request.URL.Path != answerPath {
			t.Fatalf("path = %s, want %s", request.URL.Path, answerPath)
		}
		if request.Header.Get("x-supervisor-bridge-auth") != "bridge-secret" {
			t.Fatalf(
				"x-supervisor-bridge-auth = %q, want bridge-secret",
				request.Header.Get("x-supervisor-bridge-auth"),
			)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if string(body) != `{"user_goal":"hello"}` {
			t.Fatalf("body = %s, want projected payload", string(body))
		}
		writer.Header().Set("x-supervisor-bridge-kind", "supervisor_response")
		writer.Header().Set("content-type", "application/json")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"status":"completed"}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "bridge-secret")
	response, err := client.Execute(context.Background(), Request{
		Payload: []byte(`{"user_goal":"hello"}`),
	})
	if err != nil {
		t.Fatalf("execute returned error: %v", err)
	}
	if response.Kind != "supervisor_response" {
		t.Fatalf("kind = %q, want supervisor_response", response.Kind)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if string(response.Body) != `{"status":"completed"}` {
		t.Fatalf("body = %s, want response body", string(response.Body))
	}
}

func TestHTTPClientReadyzCallsPrivateBridgeEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			t.Fatalf("method = %s, want GET", request.Method)
		}
		if request.URL.Path != readyzPath {
			t.Fatalf("path = %s, want %s", request.URL.Path, readyzPath)
		}
		if request.Header.Get("x-supervisor-bridge-auth") != "bridge-secret" {
			t.Fatalf(
				"x-supervisor-bridge-auth = %q, want bridge-secret",
				request.Header.Get("x-supervisor-bridge-auth"),
			)
		}
		writer.Header().Set("content-type", "application/json")
		writer.WriteHeader(http.StatusServiceUnavailable)
		_, _ = writer.Write([]byte(`{"status":"degraded"}`))
	}))
	defer server.Close()

	client := NewHTTPClient(server.URL, "bridge-secret")
	response, err := client.Readyz(context.Background())
	if err != nil {
		t.Fatalf("readyz returned error: %v", err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if string(response.Body) != `{"status":"degraded"}` {
		t.Fatalf("body = %s, want readiness body", string(response.Body))
	}
}

func TestHTTPClientConfiguredRequiresBaseURLAndSecret(t *testing.T) {
	if NewHTTPClient("", "secret").Configured() {
		t.Fatal("expected empty base URL to be unconfigured")
	}
	if NewHTTPClient("http://bridge.local", "").Configured() {
		t.Fatal("expected empty shared secret to be unconfigured")
	}
	if !NewHTTPClient("http://bridge.local", "secret").Configured() {
		t.Fatal("expected base URL and secret to configure bridge client")
	}
}
