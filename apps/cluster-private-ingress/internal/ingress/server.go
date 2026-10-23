package ingress

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Config struct {
	EdgeSecret    string
	ControlURL    string
	ControlSecret string
	MemoryURL     string
	MemorySecret  string
}

type route struct {
	method string
	path   *regexp.Regexp
	proxy  *httputil.ReverseProxy
}
type Server struct {
	secret string
	routes []route
}

func New(cfg Config) (*Server, error) {
	if strings.TrimSpace(cfg.EdgeSecret) == "" || strings.TrimSpace(cfg.ControlSecret) == "" || strings.TrimSpace(cfg.MemorySecret) == "" {
		return nil, errors.New("ingress and backend credentials are required")
	}
	control, err := newProxy(cfg.ControlURL, cfg.ControlSecret, "x-worker-origin-auth", "/v1/control")
	if err != nil {
		return nil, fmt.Errorf("control upstream: %w", err)
	}
	memory, err := newProxy(cfg.MemoryURL, cfg.MemorySecret, "x-memory-origin-auth", "/v1/memory")
	if err != nil {
		return nil, fmt.Errorf("memory upstream: %w", err)
	}
	s := &Server{secret: cfg.EdgeSecret}
	for _, r := range []struct {
		prefix, method, path string
		proxy                *httputil.ReverseProxy
	}{
		{"/v1/control", "POST", `/internal/agent/runs`, control},
		{"/v1/control", "GET", `/internal/agent/runs/[^/]+`, control},
		{"/v1/control", "GET", `/internal/agent/runs/[^/]+/events`, control},
		{"/v1/control", "POST", `/internal/agent/runs/[^/]+/cancel`, control},
		{"/v1/control", "POST", `/internal/owners/[^/]+/deletion/(begin|finalize)`, control},
		{"/v1/control", "POST", `/internal/memory/personal/(profile/get|commands|commands/status)`, control},
		{"/v1/memory", "POST", `/internal/memory/(profile|commands|commands/status|owners/finalize)`, memory},
	} {
		s.routes = append(s.routes, route{r.method, regexp.MustCompile("^" + r.prefix + r.path + "$"), r.proxy})
	}
	return s, nil
}

func fail(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": code, "message": "Cluster private request failed.", "retryable": status >= 500}})
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" && (r.URL.Path == "/healthz" || r.URL.Path == "/readyz") {
		w.WriteHeader(http.StatusOK)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get("x-edge-ingress-auth")), []byte(s.secret)) != 1 {
		fail(w, 401, "unauthorized")
		return
	}
	// Match the escaped path too: encoded separators and dot segments must not change routing at the backend.
	if r.URL.RawPath != "" || strings.Contains(r.URL.Path, "//") {
		fail(w, 404, "route_not_found")
		return
	}
	for _, part := range strings.Split(r.URL.Path, "/") {
		if part == "." || part == ".." {
			fail(w, 404, "route_not_found")
			return
		}
	}
	for _, route := range s.routes {
		if !route.path.MatchString(r.URL.Path) {
			continue
		}
		if r.Method != route.method {
			w.Header().Set("Allow", route.method)
			fail(w, 405, "method_not_allowed")
			return
		}
		route.proxy.ServeHTTP(w, r)
		return
	}
	fail(w, 404, "route_not_found")
}

func newProxy(rawURL, secret, header, prefix string) (*httputil.ReverseProxy, error) {
	target, err := url.Parse(rawURL)
	if err != nil || target == nil || (target.Scheme != "http" && target.Scheme != "https") || target.Host == "" || target.User != nil || (target.Path != "" && target.Path != "/") || target.RawQuery != "" || target.Fragment != "" {
		return nil, errors.New("expected an HTTP(S) origin")
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = 125 * time.Second
	return &httputil.ReverseProxy{
		Transport:     transport,
		FlushInterval: -1,
		Rewrite: func(p *httputil.ProxyRequest) {
			p.SetURL(target)
			p.Out.URL.Path = strings.TrimPrefix(p.In.URL.Path, prefix)
			p.Out.URL.RawPath = ""
			p.Out.Header = make(http.Header)
			for _, name := range []string{"Content-Type", "Accept", "Traceparent", "Tracestate", "X-Request-Id"} {
				if value := p.In.Header.Get(name); value != "" {
					p.Out.Header.Set(name, value)
				}
			}
			p.Out.Header.Set(header, secret)
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
			var timeout net.Error
			if errors.As(err, &timeout) && timeout.Timeout() {
				fail(w, 504, "cluster_upstream_timeout")
				return
			}
			fail(w, 502, "cluster_upstream_unavailable")
		},
	}, nil
}
