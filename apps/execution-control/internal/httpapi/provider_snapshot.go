package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

const (
	embeddingProviderSnapshotPath        = "/internal/provider-snapshots/embedding"
	noticeClassifierProviderSnapshotPath = "/internal/provider-snapshots/notice-classifier"
)

type providerSnapshotResolver interface {
	Resolve(context.Context, providerconfig.Kind) (providerconfig.RuntimeSetting, error)
}

type ProviderSnapshotServer struct {
	resolver providerSnapshotResolver
}

func (s *ProviderConfigAdminServer) ProviderSnapshotHandler() http.Handler {
	return &ProviderSnapshotServer{resolver: s.store}
}

func (s *ProviderSnapshotServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	response.Header().Set("Cache-Control", "no-store")
	if request.Method != http.MethodGet {
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		return
	}
	switch request.URL.Path {
	case embeddingProviderSnapshotPath:
		s.writeEmbeddingSnapshot(response, request)
	case noticeClassifierProviderSnapshotPath:
		s.writeNoticeClassifierSnapshot(response, request)
	default:
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
	}
}

func (s *ProviderSnapshotServer) writeEmbeddingSnapshot(
	response http.ResponseWriter,
	request *http.Request,
) {
	if s == nil || s.resolver == nil {
		writeError(response, http.StatusServiceUnavailable, "embedding_provider_unavailable", "Embedding provider setting is unavailable.", true)
		return
	}
	setting, err := s.resolver.Resolve(request.Context(), providerconfig.KindEmbedding)
	if err != nil || providerconfig.ValidateRuntimeSetting(setting, providerconfig.KindEmbedding) != nil ||
		strings.TrimSpace(setting.BaseURL) == "" || strings.TrimSpace(setting.APIKey) == "" {
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

func (s *ProviderSnapshotServer) writeNoticeClassifierSnapshot(
	response http.ResponseWriter,
	request *http.Request,
) {
	if s == nil || s.resolver == nil {
		writeError(response, http.StatusServiceUnavailable, "notice_classifier_provider_unavailable", "Notice classifier provider setting is unavailable.", true)
		return
	}
	setting, err := s.resolver.Resolve(request.Context(), providerconfig.KindNoticeClassifier)
	if err != nil || providerconfig.ValidateRuntimeSetting(setting, providerconfig.KindNoticeClassifier) != nil ||
		strings.TrimSpace(setting.BaseURL) == "" || strings.TrimSpace(setting.APIKey) == "" {
		writeError(response, http.StatusServiceUnavailable, "notice_classifier_provider_unavailable", "Notice classifier provider setting is unavailable.", true)
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{
		"api_key":        setting.APIKey,
		"base_url":       setting.BaseURL,
		"model":          setting.Model,
		"provider":       setting.Provider,
		"schema_version": "notice_classifier_provider_snapshot.v1",
		"transport":      setting.Transport,
	})
}
