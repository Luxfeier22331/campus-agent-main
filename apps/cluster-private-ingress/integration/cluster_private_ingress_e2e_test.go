package integration_test

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/cluster-private-ingress/internal/ingress"
)

type observedRequest struct {
	method   string
	path     string
	rawQuery string
	headers  http.Header
	body     string
}

func startBackend(t *testing.T, requests chan<- observedRequest, status int, response string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read backend body: %v", err)
			return
		}
		requests <- observedRequest{
			method:   r.Method,
			path:     r.URL.Path,
			rawQuery: r.URL.RawQuery,
			headers:  r.Header.Clone(),
			body:     string(body),
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, response)
	}))
}

func receiveRequest(t *testing.T, requests <-chan observedRequest) observedRequest {
	t.Helper()
	select {
	case request := <-requests:
		return request
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for backend request")
		return observedRequest{}
	}
}

func assertNoRequest(t *testing.T, requests <-chan observedRequest) {
	t.Helper()
	select {
	case request := <-requests:
		t.Fatalf("unexpected backend request: %+v", request)
	case <-time.After(100 * time.Millisecond):
	}
}

func doJSON(t *testing.T, client *http.Client, method, url, secret, body string) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("x-edge-ingress-auth", secret)
	request.Header.Set("x-worker-origin-auth", "spoofed")
	request.Header.Set("x-memory-origin-auth", "spoofed")
	request.Header.Set("Authorization", "Bearer spoofed")
	request.Header.Set("Cookie", "session=private")
	request.Header.Set("Content-Type", "application/json")
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestHTTPBoundaryRoutesAndCredentialIsolation(t *testing.T) {
	controlRequests := make(chan observedRequest, 1)
	memoryRequests := make(chan observedRequest, 1)
	control := startBackend(t, controlRequests, http.StatusConflict, `{"error":{"code":"control_conflict"}}`)
	defer control.Close()
	memory := startBackend(t, memoryRequests, http.StatusNotFound, `{"error":{"code":"memory_not_found"}}`)
	defer memory.Close()

	handler, err := ingress.New(ingress.Config{
		EdgeSecret:    "edge-secret",
		ControlURL:    control.URL,
		ControlSecret: "control-secret",
		MemoryURL:     memory.URL,
		MemorySecret:  "memory-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	edge := httptest.NewServer(handler)
	defer edge.Close()

	unauthorized := doJSON(t, edge.Client(), http.MethodPost, edge.URL+"/v1/control/internal/execution/requests", "", `{"value":"blocked"}`)
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d, want %d", unauthorized.StatusCode, http.StatusUnauthorized)
	}
	_ = unauthorized.Body.Close()
	assertNoRequest(t, controlRequests)

	controlResponse := doJSON(t, edge.Client(), http.MethodPost,
		edge.URL+"/v1/control/internal/execution/requests?after=2&wait_ms=20000",
		"edge-secret", `{"value":"中文"}`)
	controlBody, _ := io.ReadAll(controlResponse.Body)
	_ = controlResponse.Body.Close()
	if controlResponse.StatusCode != http.StatusConflict || string(controlBody) != `{"error":{"code":"control_conflict"}}` {
		t.Fatalf("control response = %d %s", controlResponse.StatusCode, controlBody)
	}
	controlRequest := receiveRequest(t, controlRequests)
	if controlRequest.method != http.MethodPost || controlRequest.path != "/internal/execution/requests" ||
		controlRequest.rawQuery != "after=2&wait_ms=20000" || controlRequest.body != `{"value":"中文"}` {
		t.Fatalf("control request = %+v", controlRequest)
	}
	if controlRequest.headers.Get("x-worker-origin-auth") != "control-secret" {
		t.Fatalf("control credential = %q", controlRequest.headers.Get("x-worker-origin-auth"))
	}
	for _, header := range []string{"x-edge-ingress-auth", "x-memory-origin-auth", "Authorization", "Cookie"} {
		if value := controlRequest.headers.Get(header); value != "" {
			t.Errorf("control leaked %s = %q", header, value)
		}
	}

	memoryResponse := doJSON(t, edge.Client(), http.MethodPost,
		edge.URL+"/v1/memory/internal/memory/profile?owner_id=user-1",
		"edge-secret", `{"profile":"student"}`)
	memoryBody, _ := io.ReadAll(memoryResponse.Body)
	_ = memoryResponse.Body.Close()
	if memoryResponse.StatusCode != http.StatusNotFound || string(memoryBody) != `{"error":{"code":"memory_not_found"}}` {
		t.Fatalf("memory response = %d %s", memoryResponse.StatusCode, memoryBody)
	}
	memoryRequest := receiveRequest(t, memoryRequests)
	if memoryRequest.method != http.MethodPost || memoryRequest.path != "/internal/memory/profile" ||
		memoryRequest.rawQuery != "owner_id=user-1" || memoryRequest.body != `{"profile":"student"}` {
		t.Fatalf("memory request = %+v", memoryRequest)
	}
	if memoryRequest.headers.Get("x-memory-origin-auth") != "memory-secret" {
		t.Fatalf("memory credential = %q", memoryRequest.headers.Get("x-memory-origin-auth"))
	}
	for _, header := range []string{"x-edge-ingress-auth", "x-worker-origin-auth", "Authorization", "Cookie"} {
		if value := memoryRequest.headers.Get(header); value != "" {
			t.Errorf("memory leaked %s = %q", header, value)
		}
	}

	unsupported := doJSON(t, edge.Client(), http.MethodPost, edge.URL+"/v1/memory/internal/memory/recall", "edge-secret", `{}`)
	if unsupported.StatusCode != http.StatusNotFound {
		t.Fatalf("unsupported route status = %d, want %d", unsupported.StatusCode, http.StatusNotFound)
	}
	_ = unsupported.Body.Close()
	assertNoRequest(t, memoryRequests)
}

func TestHTTPBoundaryStreamingCancellation(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(cancelled)
	}))
	defer backend.Close()

	handler, err := ingress.New(ingress.Config{
		EdgeSecret:    "edge-secret",
		ControlURL:    backend.URL,
		ControlSecret: "control-secret",
		MemoryURL:     backend.URL,
		MemorySecret:  "memory-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	edge := httptest.NewServer(handler)
	defer edge.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet,
		edge.URL+"/v1/control/internal/execution/requests/run-1/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("x-edge-ingress-auth", "edge-secret")
	response, err := edge.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(response.Body).ReadString('\n')
	if err != nil || line != "data: first\n" {
		t.Fatalf("stream first line = %q, err = %v", line, err)
	}
	cancel()
	_ = response.Body.Close()

	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("client cancellation did not reach backend")
	}
}

func TestHTTPBoundaryUnavailableBackend(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	backendURL := backend.URL
	backend.Close()

	handler, err := ingress.New(ingress.Config{
		EdgeSecret:    "edge-secret",
		ControlURL:    backendURL,
		ControlSecret: "control-secret",
		MemoryURL:     backendURL,
		MemorySecret:  "memory-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	edge := httptest.NewServer(handler)
	defer edge.Close()

	response := doJSON(t, edge.Client(), http.MethodPost, edge.URL+"/v1/control/internal/execution/requests", "edge-secret", `{}`)
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadGateway {
		t.Fatalf("unavailable backend status = %d, want %d", response.StatusCode, http.StatusBadGateway)
	}
}
