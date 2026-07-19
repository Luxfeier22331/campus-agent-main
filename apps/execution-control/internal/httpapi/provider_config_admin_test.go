package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
)

func TestProviderConfigAdminAuthorizationUsesOpsWebInternalToken(t *testing.T) {
	cfg := config.Config{OpsWebInternalToken: "ops-web-token"}

	readRequest := newTestRequest(http.MethodGet, providerConfigAdminPrefix, nil)
	readRequest.Header.Set("Authorization", "Bearer ops-web-token")
	if !providerConfigAdminAuthorized(readRequest, cfg) {
		t.Fatal("Ops Web token should authorize reads")
	}
	commandRequest := newTestRequest(http.MethodPost, providerConfigAdminPrefix+"/activation", nil)
	commandRequest.Header.Set("Authorization", "Bearer ops-web-token")
	if !providerConfigAdminAuthorized(commandRequest, cfg) {
		t.Fatal("Ops Web token should authorize commands")
	}
	wrongRequest := newTestRequest(http.MethodGet, providerConfigAdminPrefix, nil)
	wrongRequest.Header.Set("Authorization", "Bearer wrong-token")
	if providerConfigAdminAuthorized(wrongRequest, cfg) {
		t.Fatal("unknown token must not authorize requests")
	}
}

func TestProviderConfigConnectionValidationRejectsUnknownCapabilities(t *testing.T) {
	err := validateProviderConnectionInput(providerconfig.ConnectionInput{
		APIKey:   "secret",
		BaseURL:  "https://provider.example/v1",
		Features: []string{"prompt", "unknown"},
		Provider: "openai-compatible",
	})
	if err == nil {
		t.Fatal("unknown provider capability should be rejected")
	}
}

func TestProviderAdminRequestHashIncludesOperationAndSemanticPayload(t *testing.T) {
	first := providerAdminRequestHash("create_profile", map[string]string{"profileId": "profile-1"})
	replay := providerAdminRequestHash("create_profile", map[string]string{"profileId": "profile-1"})
	differentOperation := providerAdminRequestHash("validate_profile", map[string]string{"profileId": "profile-1"})
	differentPayload := providerAdminRequestHash("create_profile", map[string]string{"profileId": "profile-2"})
	if first != replay {
		t.Fatal("same operation and payload must produce the same request hash")
	}
	if first == differentOperation || first == differentPayload {
		t.Fatal("operation and semantic payload must both participate in the request hash")
	}
}

func TestOnlineExecutionControlDoesNotExposeProviderConfigAdmin(t *testing.T) {
	server := newServerForTest()
	response := httptest.NewRecorder()

	server.ServeHTTP(
		response,
		newTestRequest(http.MethodGet, providerConfigAdminPrefix, nil),
	)

	assertError(t, response, http.StatusNotFound, "not_found")
}
