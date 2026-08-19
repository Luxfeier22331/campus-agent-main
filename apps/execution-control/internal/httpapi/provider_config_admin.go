package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

const modelSettingsAdminPrefix = "/internal/admin/model-settings"

type ProviderConfigAdminServer struct {
	config config.Config
	store  *providerconfig.Store
}

func NewProviderConfigAdminServer(cfg config.Config) (*ProviderConfigAdminServer, error) {
	cipher, err := providerconfig.LoadSecretCipher(cfg.ProviderConfigEncryptionKeyPath)
	if err != nil {
		return nil, err
	}
	store, err := providerconfig.NewStore(
		context.Background(),
		cfg.DatabaseURL,
		cipher,
	)
	if err != nil {
		return nil, err
	}
	return &ProviderConfigAdminServer{config: cfg, store: store}, nil
}

func (s *ProviderConfigAdminServer) Close() {
	if s != nil && s.store != nil {
		s.store.Close()
	}
}

func (s *ProviderConfigAdminServer) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	switch {
	case request.Method == http.MethodGet && request.URL.Path == "/healthz":
		writeJSON(response, http.StatusOK, map[string]any{"status": "ok"})
	case request.Method == http.MethodGet && request.URL.Path == "/readyz":
		if err := s.store.AdminReadinessCheck(request.Context()); err != nil {
			writeError(response, http.StatusServiceUnavailable, "model_settings_not_ready", "Model settings store is unavailable.", true)
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{"status": "ready"})
	case strings.HasPrefix(request.URL.Path, modelSettingsAdminPrefix):
		handleModelSettingsAdmin(response, request, s.config, s.store)
	default:
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
	}
}

func handleModelSettingsAdmin(
	response http.ResponseWriter,
	request *http.Request,
	cfg config.Config,
	store *providerconfig.Store,
) {
	if !providerConfigAdminAuthorized(request, cfg) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid model settings admin credential.", false)
		return
	}
	path := request.URL.Path
	switch {
	case request.Method == http.MethodGet && path == modelSettingsAdminPrefix:
		writeModelSettingsStatus(response, request, store)
	case request.Method == http.MethodPost && strings.HasSuffix(path, "/models"):
		kind, ok := modelSettingKindFromPath(strings.TrimSuffix(path, "/models"))
		if !ok || kind == providerconfig.KindEmbedding {
			writeError(response, http.StatusNotFound, "not_found", "Model setting was not found.", false)
			return
		}
		discoverTextModels(response, request, store, kind)
	case request.Method == http.MethodPut:
		kind, ok := modelSettingKindFromPath(path)
		if !ok {
			writeError(response, http.StatusNotFound, "not_found", "Model setting was not found.", false)
			return
		}
		putModelSetting(response, request, store, kind)
	default:
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
	}
}

type modelDiscoveryInput struct {
	APIKey   string `json:"apiKey"`
	BaseURL  string `json:"baseUrl"`
	Provider string `json:"provider"`
}

type llmSettingUpdateInput struct {
	APIKey    string `json:"apiKey"`
	BaseURL   string `json:"baseUrl"`
	Model     string `json:"model"`
	Provider  string `json:"provider"`
	Transport string `json:"transport"`
}

type embeddingSettingUpdateInput struct {
	APIKey  *string `json:"apiKey"`
	BaseURL string  `json:"baseUrl"`
}

func discoverTextModels(
	response http.ResponseWriter,
	request *http.Request,
	store *providerconfig.Store,
	kind providerconfig.Kind,
) {
	var input modelDiscoveryInput
	if !decodeProviderAdminJSON(response, request, &input) {
		return
	}
	candidate, err := store.Candidate(request.Context(), providerconfig.SettingInput{
		APIKey:    input.APIKey,
		BaseURL:   input.BaseURL,
		Kind:      kind,
		Model:     "model-discovery",
		Provider:  input.Provider,
		Transport: "responses",
	})
	if err != nil {
		writeProviderSettingError(response, err)
		return
	}
	models, validation := providerconfig.DiscoverModels(request.Context(), candidate)
	if validation.Status != "passed" {
		writeError(response, http.StatusUnprocessableEntity, validation.ErrorCode, validation.Message, false)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"models":    models,
		"sampledAt": time.Now().UTC(),
	})
}

func writeModelSettingsStatus(
	response http.ResponseWriter,
	request *http.Request,
	store *providerconfig.Store,
) {
	status, err := store.Status(request.Context())
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "model_settings_unavailable", "Model settings status is unavailable.", true)
		return
	}
	writeJSON(response, http.StatusOK, status)
}

func putModelSetting(
	response http.ResponseWriter,
	request *http.Request,
	store *providerconfig.Store,
	kind providerconfig.Kind,
) {
	var input providerconfig.SettingInput
	if kind == providerconfig.KindEmbedding {
		var update embeddingSettingUpdateInput
		if !decodeProviderAdminJSON(response, request, &update) {
			return
		}
		apiKey := ""
		if update.APIKey != nil {
			if strings.TrimSpace(*update.APIKey) == "" {
				writeError(response, http.StatusUnprocessableEntity, "model_setting_invalid", "apiKey cannot be empty when provided.", false)
				return
			}
			apiKey = *update.APIKey
		}
		input = providerconfig.SettingInput{
			APIKey: apiKey, BaseURL: update.BaseURL, Kind: kind,
			Model: providerconfig.CanonicalEmbeddingModel, Provider: providerconfig.CanonicalEmbeddingProvider,
			Transport: providerconfig.CanonicalEmbeddingTransport,
		}
	} else {
		var update llmSettingUpdateInput
		if !decodeProviderAdminJSON(response, request, &update) {
			return
		}
		input = providerconfig.SettingInput{
			APIKey: update.APIKey, BaseURL: update.BaseURL, Kind: kind,
			Model: update.Model, Provider: update.Provider, Transport: update.Transport,
		}
	}
	if err := validateModelSettingInput(input); err != nil {
		writeError(response, http.StatusUnprocessableEntity, "model_setting_invalid", err.Error(), false)
		return
	}
	candidate, err := store.Candidate(request.Context(), input)
	if err != nil {
		writeProviderSettingError(response, err)
		return
	}
	validation := providerconfig.Validate(request.Context(), candidate)
	if validation.Status != "passed" {
		writeError(response, http.StatusUnprocessableEntity, validation.ErrorCode, validation.Message, false)
		return
	}
	status, err := store.Put(
		request.Context(),
		providerConfigActor(request),
		candidate,
		validation,
	)
	if err != nil {
		writeProviderSettingError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, status)
}

func modelSettingKindFromPath(path string) (providerconfig.Kind, bool) {
	value := strings.TrimPrefix(path, modelSettingsAdminPrefix+"/")
	if value == string(providerconfig.KindLLM) {
		return providerconfig.KindLLM, true
	}
	if value == string(providerconfig.KindEmbedding) {
		return providerconfig.KindEmbedding, true
	}
	if value == string(providerconfig.KindNoticeClassifier) {
		return providerconfig.KindNoticeClassifier, true
	}
	return "", false
}

func validateModelSettingInput(input providerconfig.SettingInput) error {
	if input.Kind != providerconfig.KindLLM && input.Kind != providerconfig.KindEmbedding && input.Kind != providerconfig.KindNoticeClassifier {
		return errors.New("kind must be llm, embedding, or notice_classifier")
	}
	if strings.TrimSpace(input.BaseURL) == "" || strings.TrimSpace(input.Model) == "" {
		return errors.New("baseUrl and model are required")
	}
	if input.Provider != "openai" && input.Provider != "openai-compatible" {
		return errors.New("provider must be openai or openai-compatible")
	}
	parsed, err := url.Parse(input.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("baseUrl must be an absolute HTTP(S) URL")
	}
	if input.Kind != providerconfig.KindEmbedding && input.Transport != "responses" && input.Transport != "chat_completions" {
		return errors.New("text model transport must be responses or chat_completions")
	}
	if input.Kind == providerconfig.KindEmbedding && input.Transport != providerconfig.CanonicalEmbeddingTransport {
		return fmt.Errorf("embedding transport must be %s", providerconfig.CanonicalEmbeddingTransport)
	}
	if input.Kind == providerconfig.KindEmbedding && (input.Provider != providerconfig.CanonicalEmbeddingProvider || input.Model != providerconfig.CanonicalEmbeddingModel) {
		return errors.New("embedding provider and model are fixed by the Campus Docs index contract")
	}
	return nil
}

func writeProviderSettingError(response http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, providerconfig.ErrInitialAPIKeyRequired):
		writeError(response, http.StatusUnprocessableEntity, "api_key_required", "API key is required for the initial model setting.", false)
	case errors.Is(err, providerconfig.ErrNotFound):
		writeError(response, http.StatusNotFound, "model_setting_not_found", "Model setting was not found.", false)
	default:
		writeError(response, http.StatusServiceUnavailable, "model_settings_unavailable", "Model settings are unavailable.", true)
	}
}

func providerConfigAdminAuthorized(request *http.Request, cfg config.Config) bool {
	want := cfg.OpsWebInternalToken
	got := strings.TrimPrefix(strings.TrimSpace(request.Header.Get("Authorization")), "Bearer ")
	return want != "" && len(got) == len(want) && subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func providerConfigActor(request *http.Request) string {
	actor := strings.TrimSpace(request.Header.Get("X-Ops-Actor-Id"))
	if actor == "" {
		return "execution-control-admin"
	}
	if len(actor) > 256 {
		return actor[:256]
	}
	return actor
}

func decodeProviderAdminJSON(response http.ResponseWriter, request *http.Request, target any) bool {
	if !strings.HasPrefix(strings.ToLower(request.Header.Get("Content-Type")), "application/json") {
		writeError(response, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.", false)
		return false
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, 1<<20))
	if err != nil || len(body) == 0 {
		writeError(response, http.StatusBadRequest, "invalid_body", "Request body is required.", false)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", false)
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		writeError(response, http.StatusBadRequest, "invalid_json", "Request body must contain one JSON object.", false)
		return false
	}
	return true
}
