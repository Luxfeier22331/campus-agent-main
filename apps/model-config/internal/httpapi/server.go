package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

type Server struct {
	store store
}

type store interface {
	Readiness(context.Context) error
	Descriptor(context.Context, modelconfig.ConfigName) (modelconfig.Descriptor, error)
	Resolve(context.Context, modelconfig.ConfigName, string) (modelconfig.RuntimeConfig, error)
	Status(context.Context) (modelconfig.Status, error)
	Put(context.Context, string, modelconfig.ConfigInput, modelconfig.Validation) (modelconfig.ConfigView, error)
	RecordValidation(context.Context, modelconfig.ConfigName, string, modelconfig.Validation) (modelconfig.ConfigView, error)
}

func New(store store) *Server {
	return &Server{store: store}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == "/healthz" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/readyz" {
		if s.store == nil || s.store.Readiness(r.Context()) != nil {
			writeError(w, http.StatusServiceUnavailable, "model_config_unavailable", "Model Config is unavailable.")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
		return
	}
	if s.store == nil {
		writeError(w, http.StatusServiceUnavailable, "model_config_unavailable", "Model Config is unavailable.")
		return
	}
	if r.URL.Path == "/internal/admin/model-configs/document_ocr/validation-result" && r.Method == http.MethodPost {
		s.serveOCRValidationResult(w, r)
		return
	}
	if name, ok := routeName(r.URL.Path, "/internal/model-targets/", ""); ok && r.Method == http.MethodGet {
		s.serveTarget(w, r, name)
		return
	}
	if name, ok := routeName(r.URL.Path, "/internal/model-configs/", ""); ok && r.Method == http.MethodGet {
		s.serveRuntimeConfig(w, r, name)
		return
	}
	if r.URL.Path == "/internal/admin/model-configs" && r.Method == http.MethodGet {
		s.serveStatus(w, r)
		return
	}
	if name, ok := routeName(r.URL.Path, "/internal/admin/model-configs/", ""); ok && r.Method == http.MethodPut {
		s.servePut(w, r, name)
		return
	}
	if name, ok := routeName(r.URL.Path, "/internal/admin/model-configs/", "/models"); ok && r.Method == http.MethodPost {
		s.serveModels(w, r, name)
		return
	}
	if name, ok := routeName(r.URL.Path, "/internal/admin/model-configs/", "/validate"); ok && r.Method == http.MethodPost {
		s.serveValidate(w, r, name)
		return
	}
	writeError(w, http.StatusNotFound, "not_found", "Route not found.")
}

func (s *Server) serveTarget(w http.ResponseWriter, r *http.Request, name modelconfig.ConfigName) {
	if r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "invalid_query", "This endpoint does not accept query parameters.")
		return
	}
	descriptor, err := s.store.Descriptor(r.Context(), name)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	noStore(w)
	writeJSON(w, http.StatusOK, descriptor)
}

func (s *Server) serveRuntimeConfig(w http.ResponseWriter, r *http.Request, name modelconfig.ConfigName) {
	query := r.URL.Query()
	for key := range query {
		if key != "expected_target_sha256" {
			writeError(w, http.StatusBadRequest, "invalid_query", "Only expected_target_sha256 is supported.")
			return
		}
	}
	expectedValues := query["expected_target_sha256"]
	if len(expectedValues) > 1 {
		writeError(w, http.StatusBadRequest, "invalid_expected_target_sha256", "expected_target_sha256 must be supplied once.")
		return
	}
	expected := ""
	if len(expectedValues) == 1 {
		expected = expectedValues[0]
		if !validSHA256(expected) {
			writeError(w, http.StatusBadRequest, "invalid_expected_target_sha256", "expected_target_sha256 must be a lowercase SHA-256 value.")
			return
		}
	}
	config, err := s.store.Resolve(r.Context(), name, expected)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	noStore(w)
	writeJSON(w, http.StatusOK, config)
}

func (s *Server) serveStatus(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "invalid_query", "This endpoint does not accept query parameters.")
		return
	}
	status, err := s.store.Status(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	noStore(w)
	writeJSON(w, http.StatusOK, status)
}

func (s *Server) servePut(w http.ResponseWriter, r *http.Request, name modelconfig.ConfigName) {
	if r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "invalid_query", "This endpoint does not accept query parameters.")
		return
	}
	var input modelconfig.ConfigInput
	if !decode(w, r, &input) {
		return
	}
	input.Name = name
	if input.APIKey != nil && strings.TrimSpace(*input.APIKey) == "" {
		s.serveFailedValidation(w, modelconfig.Validation{
			Status: "failed", ErrorCode: "invalid_setting", Message: "api_key cannot be empty when provided",
		})
		return
	}
	baseURL, err := modelconfig.NormalizeBaseURL(input.BaseURL)
	if err != nil {
		s.serveFailedValidation(w, modelconfig.Validation{
			Status: "failed", ErrorCode: "invalid_setting", Message: err.Error(),
		})
		return
	}
	input.BaseURL = baseURL
	input.Provider = strings.TrimSpace(input.Provider)
	input.APIProtocol = strings.TrimSpace(input.APIProtocol)
	input.Model = strings.TrimSpace(input.Model)
	apiKey := ""
	if input.APIKey != nil {
		apiKey = strings.TrimSpace(*input.APIKey)
	} else {
		current, resolveErr := s.store.Resolve(r.Context(), name, "")
		if resolveErr != nil {
			if errors.Is(resolveErr, modelconfig.ErrNotFound) {
				resolveErr = modelconfig.ErrInitialAPIKeyRequired
			}
			writeStoreError(w, resolveErr)
			return
		}
		apiKey = current.APIKey
	}
	input.APIKey = &apiKey
	if name == modelconfig.ConfigDocumentOCR {
		if err := modelconfig.ValidateOCRInput(input, apiKey); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_setting", err.Error())
			return
		}
		view, err := s.store.Put(r.Context(), validationActor(r), input, modelconfig.Validation{})
		if err != nil {
			writeStoreError(w, err)
			return
		}
		noStore(w)
		writeJSON(w, http.StatusOK, view)
		return
	}
	target := modelconfig.Target{
		Name:        name,
		Provider:    input.Provider,
		APIProtocol: input.APIProtocol,
		BaseURL:     input.BaseURL,
		Model:       input.Model,
	}
	validation := modelconfig.Validate(r.Context(), target, apiKey)
	if validation.Status != "passed" {
		s.serveFailedValidation(w, validation)
		return
	}
	view, err := s.store.Put(r.Context(), validationActor(r), input, validation)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	noStore(w)
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) serveValidate(w http.ResponseWriter, r *http.Request, name modelconfig.ConfigName) {
	if name == modelconfig.ConfigDocumentOCR {
		writeError(w, http.StatusUnprocessableEntity, "async_validation_required", "Start OCR validation through Ops OCR tasks.")
		return
	}
	if r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "invalid_query", "This endpoint does not accept query parameters.")
		return
	}
	current, err := s.store.Resolve(r.Context(), name, "")
	if err != nil {
		writeStoreError(w, err)
		return
	}
	validation := modelconfig.Validate(r.Context(), current.Target, current.APIKey)
	view, err := s.store.RecordValidation(r.Context(), name, validationActor(r), validation)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	noStore(w)
	if validation.Status != "passed" {
		writeJSON(w, http.StatusUnprocessableEntity, validation)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) serveFailedValidation(w http.ResponseWriter, validation modelconfig.Validation) {
	noStore(w)
	writeJSON(w, http.StatusUnprocessableEntity, validation)
}

func validationActor(r *http.Request) string {
	return strings.TrimSpace(r.Header.Get("X-Model-Config-Actor"))
}

func (s *Server) serveModels(w http.ResponseWriter, r *http.Request, name modelconfig.ConfigName) {
	if r.URL.RawQuery != "" {
		writeError(w, http.StatusBadRequest, "invalid_query", "This endpoint does not accept query parameters.")
		return
	}
	var input struct {
		APIKey   *string `json:"api_key"`
		BaseURL  string  `json:"base_url"`
		Provider string  `json:"provider"`
	}
	if !decode(w, r, &input) {
		return
	}
	apiKey := ""
	if input.APIKey != nil {
		apiKey = strings.TrimSpace(*input.APIKey)
	} else {
		current, err := s.store.Resolve(r.Context(), name, "")
		if err != nil {
			if errors.Is(err, modelconfig.ErrNotFound) {
				apiKey = ""
			} else {
				writeStoreError(w, err)
				return
			}
		} else {
			apiKey = current.APIKey
		}
	}
	models, validation := modelconfig.DiscoverModels(r.Context(), name, input.Provider, input.BaseURL, apiKey)
	if validation.Status != "passed" {
		writeJSON(w, http.StatusUnprocessableEntity, validation)
		return
	}
	noStore(w)
	writeJSON(w, http.StatusOK, map[string]any{"models": models, "sampled_at": time.Now().UTC()})
}

func routeName(path, prefix, suffix string) (modelconfig.ConfigName, bool) {
	if !strings.HasPrefix(path, prefix) || (suffix != "" && !strings.HasSuffix(path, suffix)) {
		return "", false
	}
	value := strings.TrimPrefix(path, prefix)
	if suffix != "" {
		value = strings.TrimSuffix(value, suffix)
	}
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return modelconfig.ConfigName(value), true
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.")
		return false
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must contain one JSON value.")
		return false
	}
	return true
}

func validSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, character := range value {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": code, "message": message}})
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, modelconfig.ErrNotFound):
		writeError(w, http.StatusNotFound, "model_config_not_found", "Model config was not found.")
	case errors.Is(err, modelconfig.ErrTargetMismatch):
		writeError(w, http.StatusConflict, "model_target_mismatch", "Model target no longer matches the expected hash.")
	case errors.Is(err, modelconfig.ErrInitialAPIKeyRequired):
		writeError(w, http.StatusUnprocessableEntity, "api_key_required", "API key is required for the initial model config.")
	default:
		writeError(w, http.StatusServiceUnavailable, "model_config_unavailable", "Model Config is unavailable.")
	}
}
