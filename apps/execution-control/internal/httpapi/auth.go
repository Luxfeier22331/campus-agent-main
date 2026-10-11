package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

func (s *Server) internalWorkerAuthorized(request *http.Request) bool {
	secret := strings.TrimSpace(s.config.IngressSharedSecret)
	if secret == "" {
		return false
	}
	presented := strings.TrimSpace(request.Header.Get("x-worker-origin-auth"))
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}

func (s *Server) executionQueryAuthorized(request *http.Request) bool {
	secret := strings.TrimSpace(s.config.AgentRuntimeSharedSecret)
	if secret == "" {
		return false
	}
	presented := strings.TrimSpace(request.Header.Get("x-execution-query-auth"))
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}

func (s *Server) opsWebAuthorized(request *http.Request) bool {
	token := strings.TrimSpace(s.config.OpsWebInternalToken)
	if token == "" {
		return s.localRuntimeMode()
	}
	presented := extractBearerToken(request.Header.Get("authorization"))
	return presented != "" && subtle.ConstantTimeCompare([]byte(presented), []byte(token)) == 1
}

func (s *Server) readinessAuthorized(request *http.Request) bool {
	if s.localRuntimeMode() {
		return true
	}
	return s.internalWorkerAuthorized(request) || s.opsWebAuthorized(request)
}

func (s *Server) localRuntimeMode() bool {
	environment := strings.ToLower(strings.TrimSpace(s.config.DeploymentEnvironment))
	return environment == "" || environment == "local" || environment == "development" || environment == "test"
}

func extractBearerToken(headerValue string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(headerValue, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(headerValue, prefix))
}
