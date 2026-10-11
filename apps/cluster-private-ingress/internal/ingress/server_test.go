package ingress

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, handler http.HandlerFunc) *Server {
	t.Helper()
	backend := httptest.NewServer(handler)
	t.Cleanup(backend.Close)
	s, err := New(Config{"edge", backend.URL, "control", backend.URL, "memory"})
	if err != nil {
		t.Fatal(err)
	}
	return s
}
func request(s *Server, method, path, secret string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(`{"value":"中文"}`))
	r.Header.Set("x-edge-ingress-auth", secret)
	r.Header.Set("x-worker-origin-auth", "spoofed")
	r.Header.Set("x-memory-origin-auth", "spoofed")
	r.Header.Set("Authorization", "Bearer spoofed")
	r.Header.Set("Cookie", "session=private")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestProxyContract(t *testing.T) {
	for _, service := range []string{"control", "memory"} {
		t.Run(service, func(t *testing.T) {
			path := "/internal/execution/requests"
			credential := "x-worker-origin-auth"
			if service == "memory" {
				path = "/internal/memory/commands"
				credential = "x-memory-origin-auth"
			}
			calls := 0
			s := fixture(t, func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.RequestURI() != path+"?after=2&wait_ms=20000" || r.Method != "POST" {
					t.Errorf("wrong request: %s %s", r.Method, r.URL.RequestURI())
				}
				for _, h := range []string{"x-edge-ingress-auth", "Authorization", "Cookie"} {
					if r.Header.Get(h) != "" {
						t.Errorf("leaked %s", h)
					}
				}
				if r.Header.Get(credential) != service {
					t.Errorf("wrong backend credential")
				}
				other := "x-memory-origin-auth"
				if service == "memory" {
					other = "x-worker-origin-auth"
				}
				if r.Header.Get(other) != "" {
					t.Errorf("leaked other backend credential")
				}
				body, _ := io.ReadAll(r.Body)
				if string(body) != `{"value":"中文"}` {
					t.Errorf("body changed: %s", body)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(409)
				_, _ = w.Write([]byte(`{"error":{"code":"conflict"}}`))
			})
			w := request(s, "POST", "/v1/"+service+path+"?after=2&wait_ms=20000", "edge")
			if w.Code != 409 || w.Body.String() != `{"error":{"code":"conflict"}}` || calls != 1 {
				t.Fatalf("response: %d %s calls=%d", w.Code, w.Body, calls)
			}
		})
	}
}
func TestBoundary(t *testing.T) {
	calls := 0
	s := fixture(t, func(w http.ResponseWriter, _ *http.Request) { calls++; w.WriteHeader(202) })
	for _, tc := range []struct {
		method, path, secret string
		status               int
	}{
		{"GET", "/healthz", "", 200}, {"GET", "/readyz", "", 200},
		{"POST", "/v1/control/internal/execution/requests", "", 401},
		{"POST", "/v1/control/internal/execution/requests", "bad", 401},
		{"GET", "/v1/control/internal/execution/requests", "edge", 405},
		{"POST", "/v1/memory/internal/memory/recall", "edge", 404},
		{"POST", "/v1/memory/internal/memory/appends", "edge", 404},
		{"POST", "/v1/control/internal/execution/projections", "edge", 404},
		{"GET", "/v1/control/readyz", "edge", 404},
		{"GET", "/v1/control/internal/execution/requests/..", "edge", 404},
		{"GET", "/v1/control/internal/execution/requests/a%2fb", "edge", 404},
		{"POST", "/v1/memory/internal/memory/commands/../recall", "edge", 404},
	} {
		if w := request(s, tc.method, tc.path, tc.secret); w.Code != tc.status {
			t.Errorf("%s %s got %d want %d", tc.method, tc.path, w.Code, tc.status)
		}
	}
	if calls != 0 {
		t.Fatalf("blocked calls reached backend: %d", calls)
	}
	for _, tc := range []struct{ method, path string }{
		{"POST", "/v1/control/internal/execution/requests"},
		{"GET", "/v1/control/internal/execution/requests/run-1"},
		{"GET", "/v1/control/internal/execution/requests/run-1/events"},
		{"POST", "/v1/control/internal/execution/requests/run-1/cancel"},
		{"POST", "/v1/control/internal/owners/user-1/deletion/begin"},
		{"POST", "/v1/control/internal/owners/user-1/deletion/finalize"},
		{"POST", "/v1/memory/internal/memory/profile"},
		{"POST", "/v1/memory/internal/memory/commands"},
		{"POST", "/v1/memory/internal/memory/commands/status"},
		{"POST", "/v1/memory/internal/memory/owners/finalize"},
	} {
		if w := request(s, tc.method, tc.path, "edge"); w.Code != 202 {
			t.Errorf("route %s got %d", tc.path, w.Code)
		}
	}
}
func TestStreamingAndCancellation(t *testing.T) {
	cancelled := make(chan struct{})
	s := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(cancelled)
	})
	server := httptest.NewServer(s)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	r, _ := http.NewRequestWithContext(ctx, "GET", server.URL+"/v1/control/internal/execution/requests/run/events", nil)
	r.Header.Set("x-edge-ingress-auth", "edge")
	response, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	data := make([]byte, len("data: first\n\n"))
	_, err = io.ReadFull(response.Body, data)
	if err != nil {
		t.Fatal(err)
	}
	cancel()
	_ = response.Body.Close()
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("cancellation did not reach upstream")
	}
}
func TestTimeoutAndNoRetry(t *testing.T) {
	calls := 0
	s := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		_, _ = io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
	})
	for _, route := range s.routes {
		route.proxy.Transport.(*http.Transport).ResponseHeaderTimeout = 10 * time.Millisecond
	}
	w := request(s, "POST", "/v1/memory/internal/memory/commands", "edge")
	if w.Code != 504 || calls != 1 {
		t.Fatalf("status=%d calls=%d", w.Code, calls)
	}
}
func TestInvalidConfiguration(t *testing.T) {
	for _, cfg := range []Config{{}, {"edge", "file:///tmp", "control", "http://memory", "memory"}, {"edge", "http://control/path", "control", "http://memory", "memory"}, {"edge", "http://control", "", "http://memory", "memory"}} {
		if _, err := New(cfg); err == nil {
			t.Fatal("accepted invalid config")
		}
	}
}
