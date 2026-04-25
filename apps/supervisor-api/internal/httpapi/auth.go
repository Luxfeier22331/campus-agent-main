package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

func (s *Server) internalWorkerAuthorized(request *http.Request) bool {
	secret := strings.TrimSpace(s.config.WorkerSharedSecret)
	if secret == "" {
		return false
	}
	presented := strings.TrimSpace(request.Header.Get("x-worker-origin-auth"))
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}

func (s *Server) structuredQueryAuthorized(request *http.Request) bool {
	secret := strings.TrimSpace(s.config.StructuredQuerySharedSecret)
	if secret == "" {
		return false
	}
	presented := strings.TrimSpace(request.Header.Get("x-supervisor-query-auth"))
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}

func (s *Server) metricsAuthorized(request *http.Request) bool {
	token := strings.TrimSpace(s.config.MetricsBearerToken)
	if token == "" {
		return true
	}
	presented := extractBearerToken(request.Header.Get("authorization"))
	return presented != "" && subtle.ConstantTimeCompare([]byte(presented), []byte(token)) == 1
}

func extractBearerToken(headerValue string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(headerValue, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(headerValue, prefix))
}
