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

func TestModelSettingValidationUsesRuntimeCapabilities(t *testing.T) {
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
		BaseURL:   "https://embedding.example/v1",
		Kind:      providerconfig.KindEmbedding,
		Model:     "operator-selected-model",
		Provider:  "openai",
		Transport: "embeddings",
	}
	if err := validateModelSettingInput(embedding); err != nil {
		t.Fatalf("validate embedding setting: %v", err)
	}
	embedding.Transport = "responses"
	if err := validateModelSettingInput(embedding); err == nil {
		t.Fatal("embedding setting accepted a non-embedding transport")
	}
}

func TestLLMSettingUpdateInputRejectsServerOwnedAndUnknownFields(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "embedding space id", body: `{"baseUrl":"https://provider.example/v1","embeddingSpaceId":"client-space","model":"model-1","provider":"openai","transport":"responses"}`},
		{name: "dimensions", body: `{"baseUrl":"https://provider.example/v1","dimensions":2560,"model":"model-1","provider":"openai","transport":"responses"}`},
		{name: "kind", body: `{"baseUrl":"https://provider.example/v1","kind":"llm","model":"model-1","provider":"openai","transport":"responses"}`},
		{name: "retired timeout", body: `{"baseUrl":"https://provider.example/v1","model":"model-1","provider":"openai","timeoutMs":30000,"transport":"responses"}`},
		{name: "unknown field", body: `{"baseUrl":"https://provider.example/v1","model":"model-1","provider":"openai","transport":"responses","unexpected":true}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequestWithContext(
				t.Context(),
				http.MethodPut,
				modelSettingsAdminPrefix+"/llm",
				strings.NewReader(test.body),
			)
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			var input llmSettingUpdateInput

			if decodeProviderAdminJSON(response, request, &input) {
				t.Fatal("server-owned or unknown field was accepted")
			}
			assertError(t, response, http.StatusBadRequest, "invalid_json")
		})
	}
}

func TestEmbeddingSettingUpdateInputRejectsTransportAndVectorFields(t *testing.T) {
	for _, body := range []string{
		`{"baseUrl":"https://provider.example/v1","model":"model-1","provider":"openai","transport":"embeddings"}`,
		`{"baseUrl":"https://provider.example/v1","dimensions":2560,"model":"model-1","provider":"openai"}`,
		`{"baseUrl":"https://provider.example/v1","embeddingSpaceId":"space","model":"model-1","provider":"openai"}`,
	} {
		request := httptest.NewRequestWithContext(
			t.Context(),
			http.MethodPut,
			modelSettingsAdminPrefix+"/embedding",
			strings.NewReader(body),
		)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		var input embeddingSettingUpdateInput
		if decodeProviderAdminJSON(response, request, &input) {
			t.Fatalf("server-owned embedding field was accepted: %s", body)
		}
		assertError(t, response, http.StatusBadRequest, "invalid_json")
	}
}

func TestModelDiscoveryInputRejectsUnknownFields(t *testing.T) {
	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		modelSettingsAdminPrefix+"/llm/models",
		strings.NewReader(`{"apiKey":"secret","baseUrl":"https://provider.example/v1","provider":"openai","model":"unexpected"}`),
	)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	var input modelDiscoveryInput

	if decodeProviderAdminJSON(response, request, &input) {
		t.Fatal("unknown discovery field was accepted")
	}
	assertError(t, response, http.StatusBadRequest, "invalid_json")
}

func TestOnlineExecutionControlDoesNotExposeModelSettingsAdmin(t *testing.T) {
	server := newServerForTest()
	response := httptest.NewRecorder()
	server.ServeHTTP(response, newTestRequest(http.MethodGet, modelSettingsAdminPrefix, nil))
	assertError(t, response, http.StatusNotFound, "not_found")
}
