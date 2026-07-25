package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

func TestModelSettingsAdminAuthorizationUsesOpsWebInternalToken(t *testing.T) {
	cfg := config.Config{OpsWebInternalToken: "ops-web-token"}
	request := newTestRequest(http.MethodGet, modelSettingsAdminPrefix, nil)
	request.Header.Set("Authorization", "Bearer ops-web-token")
	if !providerConfigAdminAuthorized(request, cfg) {
		t.Fatal("Ops Web token should authorize model settings")
	}
	request.Header.Set("Authorization", "Bearer wrong-token")
	if providerConfigAdminAuthorized(request, cfg) {
		t.Fatal("unknown token must not authorize model settings")
	}
}

func TestModelSettingValidationUsesCapabilitiesInsteadOfRoles(t *testing.T) {
	llm := providerconfig.SettingInput{
		BaseURL:   "https://provider.example/v1",
		Kind:      providerconfig.KindLLM,
		Model:     "model-1",
		Provider:  "openai-compatible",
		Transport: "responses",
	}
	if err := validateModelSettingInput(llm); err != nil {
		t.Fatalf("validate llm setting: %v", err)
	}
	embedding := providerconfig.SettingInput{
		BaseURL:    "https://embedding.example/v1",
		Dimensions: fixedQueryEmbeddingDimensions,
		Kind:       providerconfig.KindEmbedding,
		Model:      fixedQueryEmbeddingModel,
		Provider:   "openai-compatible",
		Transport:  "embeddings",
	}
	if err := validateModelSettingInput(embedding); err != nil {
		t.Fatalf("validate embedding setting: %v", err)
	}
	embedding.Model = "operator-selected-model"
	if err := validateModelSettingInput(embedding); err == nil {
		t.Fatal("embedding model must remain fixed by serving config")
	}
}

func TestModelSettingAdminRejectsRetiredTimeoutField(t *testing.T) {
	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPut,
		modelSettingsAdminPrefix+"/llm",
		strings.NewReader(`{"baseUrl":"https://provider.example/v1","model":"model-1","provider":"openai","timeoutMs":30000,"transport":"responses"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	var input providerconfig.SettingInput

	if decodeProviderAdminJSON(response, request, &input) {
		t.Fatal("retired timeoutMs field was accepted")
	}
	assertError(t, response, http.StatusBadRequest, "invalid_json")
}

func TestOnlineExecutionControlDoesNotExposeModelSettingsAdmin(t *testing.T) {
	server := newServerForTest()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, modelSettingsAdminPrefix, nil))
	assertError(t, response, http.StatusNotFound, "not_found")
}
