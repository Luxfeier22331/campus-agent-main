package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

type providerConfigCompatibilityRequest struct {
	BaseURL    string `json:"base_url"`
	Dimensions int    `json:"dimensions"`
	Kind       string `json:"kind"`
	Model      string `json:"model"`
	Provider   string `json:"provider"`
	Transport  string `json:"transport"`
}

func (s *Server) handleProviderConfigCompatibility(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var candidate providerConfigCompatibilityRequest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&candidate); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "Provider config compatibility request is invalid.", false)
		return
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(response, http.StatusBadRequest, "invalid_request", "Provider config compatibility request is invalid.", false)
		return
	}
	snapshot := providerConfigSnapshot{
		APIKey:     "compatibility-check-redacted",
		BaseURL:    strings.TrimRight(strings.TrimSpace(candidate.BaseURL), "/"),
		Dimensions: candidate.Dimensions,
		Kind:       providerConfigKind(strings.TrimSpace(candidate.Kind)),
		Model:      strings.TrimSpace(candidate.Model),
		Provider:   strings.TrimSpace(candidate.Provider),
		Transport:  strings.TrimSpace(candidate.Transport),
	}
	if snapshot.Kind != providerConfigKindEmbedding {
		writeError(response, http.StatusBadRequest, "invalid_request", "Embedding model setting is required.", false)
		return
	}
	if err := validateProviderConfigSnapshot(snapshot, providerConfigKindEmbedding); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	ctx, cancel := context.WithTimeout(request.Context(), providerconfig.ValidationTimeout)
	defer cancel()
	result := s.checkProviderConfigCompatibility(ctx, snapshot)
	writeJSON(response, http.StatusOK, map[string]any{"ok": result.ok, "reason": result.reason})
}

type providerConfigCompatibilityResult struct {
	ok     bool
	reason string
}

const providerConfigCompatibilityFailureReason = "Embedding configuration is incompatible with the active document evidence."

func (s *Server) checkProviderConfigCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) providerConfigCompatibilityResult {
	if err := s.checkDocumentEvidenceEmbeddingCompatibility(ctx, snapshot); err != nil {
		return providerConfigCompatibilityResult{ok: false, reason: providerConfigCompatibilityFailureReason}
	}
	return providerConfigCompatibilityResult{ok: true}
}

func (s *Server) checkDocumentEvidenceEmbeddingCompatibility(
	ctx context.Context,
	snapshot providerConfigSnapshot,
) error {
	if s.documentEvidenceErr != nil {
		return s.documentEvidenceErr
	}
	if s.documentEvidenceExecutor == nil {
		return fmt.Errorf("document evidence executor does not support provider compatibility checks")
	}
	return s.documentEvidenceExecutor.CheckEmbeddingCompatibility(ctx, snapshot)
}
