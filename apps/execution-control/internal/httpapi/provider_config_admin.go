package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

const providerConfigAdminPrefix = "/internal/admin/provider-config"

type ProviderConfigAdminServer struct {
	config config.Config
	store  *providerconfig.Store
}

func NewProviderConfigAdminServer(cfg config.Config) (*ProviderConfigAdminServer, error) {
	keyring, err := providerconfig.LoadKeyring(cfg.ProviderConfigKeyringPath)
	if err != nil {
		return nil, err
	}
	store, err := providerconfig.NewStore(
		context.Background(),
		cfg.ProviderConfigAdminDatabaseURL,
		keyring,
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
		if _, err := s.store.Status(request.Context()); err != nil {
			writeError(response, http.StatusServiceUnavailable, "provider_config_not_ready", "Provider config store is unavailable.", true)
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{"status": "ready"})
	case strings.HasPrefix(request.URL.Path, providerConfigAdminPrefix):
		handleProviderConfigAdmin(response, request, s.config, s.store)
	default:
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
	}
}

func handleProviderConfigAdmin(response http.ResponseWriter, request *http.Request, cfg config.Config, store *providerconfig.Store) {
	command := request.Method != http.MethodGet
	if !providerConfigAdminAuthorized(request, cfg, command) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid provider config admin credential.", false)
		return
	}
	path := request.URL.Path
	switch {
	case request.Method == http.MethodGet && path == providerConfigAdminPrefix:
		status, err := store.Status(request.Context())
		if err != nil {
			writeError(response, http.StatusServiceUnavailable, "provider_config_unavailable", "Provider config status is unavailable.", true)
			return
		}
		writeJSON(response, http.StatusOK, status)
	case request.Method == http.MethodPost && path == providerConfigAdminPrefix+"/connections":
		var input providerconfig.ConnectionInput
		if !decodeProviderAdminJSON(response, request, &input) {
			return
		}
		if err := validateProviderConnectionInput(input); err != nil {
			writeError(response, http.StatusUnprocessableEntity, "validation_failed", err.Error(), false)
			return
		}
		view, status, err := store.CreateConnection(
			request.Context(),
			providerConfigActor(request),
			strings.TrimSpace(request.Header.Get("Idempotency-Key")),
			providerAdminRequestHash("create_connection", input),
			input,
		)
		if err != nil {
			writeProviderCommandError(response, status, "provider_connection_create_failed", err)
			return
		}
		writeJSON(response, status, map[string]any{"connection": view})
	case request.Method == http.MethodPost && path == providerConfigAdminPrefix+"/profiles":
		var input providerconfig.ProfileInput
		if !decodeProviderAdminJSON(response, request, &input) {
			return
		}
		if err := validateProviderProfileInput(input); err != nil {
			writeError(response, http.StatusUnprocessableEntity, "validation_failed", err.Error(), false)
			return
		}
		view, status, err := store.CreateProfile(
			request.Context(),
			providerConfigActor(request),
			strings.TrimSpace(request.Header.Get("Idempotency-Key")),
			providerAdminRequestHash("create_profile", input),
			input,
		)
		if err != nil {
			writeProviderCommandError(response, status, "provider_profile_create_failed", err)
			return
		}
		writeJSON(response, status, map[string]any{"profile": view})
	case request.Method == http.MethodPost && strings.HasPrefix(path, providerConfigAdminPrefix+"/profiles/") && strings.HasSuffix(path, "/validate"):
		profileID := strings.TrimSuffix(strings.TrimPrefix(path, providerConfigAdminPrefix+"/profiles/"), "/validate")
		if profileID == "" || strings.Contains(profileID, "/") {
			writeError(response, http.StatusNotFound, "not_found", "Provider profile was not found.", false)
			return
		}
		result, status, err := store.ValidateProfile(
			request.Context(),
			providerConfigActor(request),
			strings.TrimSpace(request.Header.Get("Idempotency-Key")),
			providerAdminRequestHash("validate_profile", map[string]string{"profileId": profileID}),
			profileID,
		)
		if err != nil {
			writeProviderCommandError(response, status, "provider_validation_failed", err)
			return
		}
		writeJSON(response, status, map[string]any{"profileId": profileID, "validation": result})
	case request.Method == http.MethodPost && path == providerConfigAdminPrefix+"/activation":
		body, ok := readProviderAdminBody(response, request)
		if !ok {
			return
		}
		var input providerconfig.ActivationInput
		if err := json.Unmarshal(body, &input); err != nil {
			writeError(response, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", false)
			return
		}
		result, status, err := store.Activate(request.Context(), providerConfigActor(request), strings.TrimSpace(request.Header.Get("Idempotency-Key")), providerAdminRequestHash("activate_bundle", input), input)
		if err != nil {
			code := "provider_activation_failed"
			if errors.Is(err, providerconfig.ErrConflict) {
				code = "provider_activation_conflict"
			}
			writeError(response, status, code, err.Error(), false)
			return
		}
		writeJSON(response, status, result)
	default:
		writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
	}
}

func providerAdminRequestHash(operation string, input any) string {
	body, err := json.Marshal(input)
	if err != nil {
		panic(err)
	}
	sum := sha256.Sum256(append([]byte(strings.TrimSpace(operation)+"\x00"), body...))
	return hex.EncodeToString(sum[:])
}

func writeProviderCommandError(response http.ResponseWriter, status int, defaultCode string, err error) {
	if status < 400 || status > 599 {
		status = http.StatusInternalServerError
	}
	code := defaultCode
	if errors.Is(err, providerconfig.ErrConflict) {
		code = "provider_command_conflict"
	}
	writeError(response, status, code, err.Error(), status >= 500)
}

func providerConfigAdminAuthorized(request *http.Request, cfg config.Config, command bool) bool {
	want := cfg.ProviderConfigAdminReadToken
	if command {
		want = cfg.ProviderConfigAdminCommandToken
	}
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
	body, ok := readProviderAdminBody(response, request)
	if !ok {
		return false
	}
	if err := json.Unmarshal(body, target); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON.", false)
		return false
	}
	return true
}

func readProviderAdminBody(response http.ResponseWriter, request *http.Request) ([]byte, bool) {
	if !strings.HasPrefix(strings.ToLower(request.Header.Get("Content-Type")), "application/json") {
		writeError(response, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json.", false)
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, 1<<20))
	if err != nil || len(body) == 0 {
		writeError(response, http.StatusBadRequest, "invalid_body", "Request body is required.", false)
		return nil, false
	}
	return body, true
}

func validateProviderProfileInput(input providerconfig.ProfileInput) error {
	if input.ConnectionID == "" || input.Model == "" || input.TimeoutMS <= 0 || input.Transport == "" {
		return errors.New("connectionId, model, transport, and positive timeoutMs are required")
	}
	switch input.Role {
	case providerconfig.RolePrimaryAgent:
		if input.Kind != "prompt" {
			return errors.New("primary_agent kind must be prompt")
		}
	case providerconfig.RoleRAGQueryEmbedding:
		if input.Kind != "embedding" || input.Dimensions <= 0 {
			return errors.New("rag_query_embedding requires embedding kind and positive dimensions")
		}
	case providerconfig.RoleRAGReranker:
		if input.Kind != "rerank" {
			return errors.New("rag_reranker kind must be rerank")
		}
	default:
		return errors.New("role must be primary_agent, rag_query_embedding, or rag_reranker")
	}
	return nil
}

func validateProviderConnectionInput(input providerconfig.ConnectionInput) error {
	if strings.TrimSpace(input.APIKey) == "" || strings.TrimSpace(input.BaseURL) == "" || strings.TrimSpace(input.Provider) == "" || len(input.Features) == 0 {
		return errors.New("apiKey, baseUrl, provider, and features are required")
	}
	parsed, err := url.Parse(input.BaseURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return errors.New("baseUrl must be an absolute HTTP(S) URL")
	}
	seen := map[string]bool{}
	for _, feature := range input.Features {
		if feature != "prompt" && feature != "embedding" && feature != "rerank" {
			return errors.New("features may contain only prompt, embedding, or rerank")
		}
		if seen[feature] {
			return errors.New("features must not contain duplicates")
		}
		seen[feature] = true
	}
	return nil
}
