package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type providerConfigCompatibilityRequest struct {
	BaseURL    string `json:"base_url"`
	Dimensions int    `json:"dimensions"`
	Model      string `json:"model"`
	Provider   string `json:"provider"`
	Role       string `json:"role"`
	TimeoutMS  int    `json:"timeout_ms"`
	Transport  string `json:"transport"`
}

func (s *Server) handleProviderConfigCompatibility(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var candidate providerConfigCompatibilityRequest
	if err := json.Unmarshal(body, &candidate); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Provider config compatibility request is invalid.", false)
		return
	}
	snapshot := providerConfigSnapshot{
		APIKey:     "compatibility-check-redacted",
		BaseURL:    strings.TrimRight(strings.TrimSpace(candidate.BaseURL), "/"),
		Dimensions: candidate.Dimensions,
		Model:      strings.TrimSpace(candidate.Model),
		ProfileID:  "provider_profile_candidate",
		Provider:   strings.TrimSpace(candidate.Provider),
		Revision:   1,
		Role:       strings.TrimSpace(candidate.Role),
		TimeoutMS:  candidate.TimeoutMS,
		Transport:  strings.TrimSpace(candidate.Transport),
	}
	role := providerConfigRole(snapshot.Role)
	if !isEmbeddingProviderConfigRole(role) {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Embedding provider role is required.", false)
		return
	}
	if err := validateProviderConfigSnapshot(snapshot, role); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), time.Duration(snapshot.TimeoutMS)*time.Millisecond)
	defer cancel()
	result := s.checkProviderConfigCompatibility(ctx, role, snapshot)
	setOutcome(response, "provider_config_compatibility")
	writeJSON(response, http.StatusOK, map[string]any{
		"ok":     result.ok,
		"reason": result.reason,
	})
}

type providerConfigCompatibilityResult struct {
	ok     bool
	reason string
}

func (s *Server) checkProviderConfigCompatibility(
	ctx context.Context,
	role providerConfigRole,
	snapshot providerConfigSnapshot,
) providerConfigCompatibilityResult {
	switch role {
	case providerConfigRoleRAGQueryEmbedding:
		if err := s.checkKnowledgeSearchEmbeddingCompatibility(ctx, snapshot); err != nil {
			return providerConfigCompatibilityResult{ok: false, reason: err.Error()}
		}
		return providerConfigCompatibilityResult{ok: true}
	default:
		return providerConfigCompatibilityResult{
			ok:     false,
			reason: fmt.Sprintf("provider config role %q is not supported for compatibility checks", role),
		}
	}
}

func (s *Server) checkKnowledgeSearchEmbeddingCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) error {
	if s.knowledgeSearchErr != nil {
		return s.knowledgeSearchErr
	}
	executor, ok := s.knowledgeSearchExecutor.(interface {
		CheckEmbeddingCompatibility(context.Context, providerConfigSnapshot) error
	})
	if !ok {
		return fmt.Errorf("knowledge search executor does not support provider compatibility checks")
	}
	return executor.CheckEmbeddingCompatibility(ctx, snapshot)
}
