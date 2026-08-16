package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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
	index := campusDocsIndexForTest()
	embeddingRequirement := &embeddingSettingRequirement{
		Dimensions:       index.EmbeddingDimensions,
		EmbeddingSpaceID: index.EmbeddingSpaceID,
		Model:            index.EmbeddingModel,
		Provider:         index.EmbeddingProvider,
		Transport:        "embeddings",
	}
	llm := providerconfig.SettingInput{
		BaseURL:   "https://provider.example/v1",
		Kind:      providerconfig.KindLLM,
		Model:     "model-1",
		Provider:  "openai-compatible",
		Transport: "responses",
	}
	if err := validateModelSettingInput(llm, embeddingRequirement); err != nil {
		t.Fatalf("validate llm setting: %v", err)
	}
	embedding := providerconfig.SettingInput{
		BaseURL:          "https://embedding.example/v1",
		Dimensions:       embeddingRequirement.Dimensions,
		EmbeddingSpaceID: embeddingRequirement.EmbeddingSpaceID,
		Kind:             providerconfig.KindEmbedding,
		Model:            embeddingRequirement.Model,
		Provider:         embeddingRequirement.Provider,
		Transport:        "embeddings",
	}
	if err := validateModelSettingInput(embedding, embeddingRequirement); err != nil {
		t.Fatalf("validate embedding setting: %v", err)
	}
	embedding.Model = "operator-selected-model"
	if err := validateModelSettingInput(embedding, embeddingRequirement); err == nil {
		t.Fatal("embedding model must remain fixed by the Campus docs current index")
	}
}

func TestModelSettingsStatusIncludesCampusDocsEmbeddingRequirement(t *testing.T) {
	index := campusDocsIndexForTest()
	requirement := &embeddingSettingRequirement{
		Dimensions:       index.EmbeddingDimensions,
		EmbeddingSpaceID: index.EmbeddingSpaceID,
		Model:            index.EmbeddingModel,
		Provider:         index.EmbeddingProvider,
		Transport:        "embeddings",
	}
	response := httptest.NewRecorder()
	writeModelSettingsStatusResponse(response, providerconfig.Status{
		ETag:      "etag-test",
		SampledAt: time.Date(2026, time.August, 15, 0, 0, 0, 0, time.UTC),
		Settings:  map[providerconfig.Kind]*providerconfig.SettingView{},
	}, requirement)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	body := decodeBody(t, response)
	requirementBody, ok := body["embeddingRequirement"].(map[string]any)
	if !ok {
		t.Fatalf("embeddingRequirement = %#v", body["embeddingRequirement"])
	}
	if requirementBody["model"] != index.EmbeddingModel ||
		requirementBody["provider"] != index.EmbeddingProvider ||
		requirementBody["embeddingSpaceId"] != index.EmbeddingSpaceID ||
		requirementBody["dimensions"] != float64(index.EmbeddingDimensions) ||
		requirementBody["transport"] != "embeddings" {
		t.Fatalf("embeddingRequirement = %#v", requirementBody)
	}
}

func TestModelSettingsStatusAllowsMissingCampusDocsIndex(t *testing.T) {
	response := httptest.NewRecorder()
	writeModelSettingsStatusResponse(response, providerconfig.Status{
		ETag:      "etag-test",
		SampledAt: time.Date(2026, time.August, 15, 0, 0, 0, 0, time.UTC),
		Settings:  map[providerconfig.Kind]*providerconfig.SettingView{},
	}, nil)

	body := decodeBody(t, response)
	if body["embeddingRequirement"] != nil {
		t.Fatalf("embeddingRequirement = %#v, want null", body["embeddingRequirement"])
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
