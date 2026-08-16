package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

const embeddingProviderSnapshotPath = "/internal/provider-snapshots/embedding"

type embeddingProviderSnapshotResolver interface {
	Resolve(context.Context, providerconfig.Kind) (providerconfig.RuntimeSetting, error)
}

type EmbeddingProviderSnapshotServer struct {
	resolver embeddingProviderSnapshotResolver
}

func (s *ProviderConfigAdminServer) EmbeddingProviderSnapshotHandler() http.Handler {
	return &EmbeddingProviderSnapshotServer{resolver: s.store}
}

func (s *EmbeddingProviderSnapshotServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	if request.Method != http.MethodGet || request.URL.Path != embeddingProviderSnapshotPath {
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		return
	}
	if s == nil || s.resolver == nil {
		writeError(response, http.StatusServiceUnavailable, "embedding_provider_unavailable", "Embedding provider setting is unavailable.", true)
		return
	}
	setting, err := s.resolver.Resolve(request.Context(), providerconfig.KindEmbedding)
	if err != nil || setting.Kind != providerconfig.KindEmbedding || setting.Transport != "embeddings" ||
		strings.TrimSpace(setting.Provider) == "" || strings.TrimSpace(setting.BaseURL) == "" ||
		strings.TrimSpace(setting.Model) == "" || strings.TrimSpace(setting.APIKey) == "" {
		writeError(response, http.StatusServiceUnavailable, "embedding_provider_unavailable", "Embedding provider setting is unavailable.", true)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{
		"api_key":        setting.APIKey,
		"base_url":       setting.BaseURL,
		"model":          setting.Model,
		"provider":       setting.Provider,
		"schema_version": "embedding_provider_snapshot.v1",
	})
}
