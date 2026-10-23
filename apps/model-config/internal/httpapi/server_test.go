package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

type fakeStore struct {
	reads               int
	resolveErr          error
	recordValidationErr error
	currentAPIKey       string
	putInput            *modelconfig.ConfigInput
	recordedValidation  *modelconfig.Validation
	recordedActor       string
	currentTarget       *modelconfig.Target
	selectErr           error
	selected            *[3]string
}

func (s *fakeStore) Readiness(context.Context) error {
	s.reads++
	return nil
}

func targetForName(name modelconfig.ConfigName) modelconfig.Target {
	// The store resolves the read alias to its selected credential row.
	if name == modelconfig.ConfigNoticeClassification {
		name = modelconfig.ConfigNoticeClassificationLLM
	}
	target := modelconfig.Target{
		Name:        name,
		Provider:    "openai",
		APIProtocol: "openai.responses",
		BaseURL:     "https://api.openai.com/v1",
		Model:       "gpt-5-mini",
	}
	if name == modelconfig.ConfigCampusDocsEmbedding {
		target.Provider = "openai-compatible"
		target.APIProtocol = "openai.embeddings"
		target.Model = "Qwen3-Embedding-4B"
	}
	if name == modelconfig.ConfigCampusDocsReranker {
		target.Provider = "cohere"
		target.APIProtocol = "cohere.rerank"
		target.Model = "rerank-v4"
	}
	return target
}

func fakeDescriptor(name modelconfig.ConfigName) modelconfig.Descriptor {
	target := targetForName(name)
	return modelconfig.Descriptor{
		SchemaVersion: "model_target.v1",
		Target:        target,
		Capabilities:  modelconfig.CapabilitiesForTarget(target),
		TargetSHA256:  modelconfig.TargetHash(target),
	}
}

func (s *fakeStore) Descriptor(_ context.Context, name modelconfig.ConfigName) (modelconfig.Descriptor, error) {
	s.reads++
	return fakeDescriptor(name), nil
}

func (s *fakeStore) Resolve(_ context.Context, name modelconfig.ConfigName, expected string) (modelconfig.RuntimeConfig, error) {
	s.reads++
	if s.resolveErr != nil {
		return modelconfig.RuntimeConfig{}, s.resolveErr
	}
	descriptor := fakeDescriptor(name)
	if s.currentTarget != nil {
		descriptor.Target = *s.currentTarget
		descriptor.TargetSHA256 = modelconfig.TargetHash(*s.currentTarget)
	}
	if expected != "" && expected != descriptor.TargetSHA256 {
		return modelconfig.RuntimeConfig{}, modelconfig.ErrTargetMismatch
	}
	apiKey := s.currentAPIKey
	if apiKey == "" {
		apiKey = "secret"
	}
	return modelconfig.RuntimeConfig{
		SchemaVersion: "model_runtime_config.v1",
		Target:        descriptor.Target,
		Capabilities:  modelconfig.CapabilitiesForTarget(descriptor.Target),
		TargetSHA256:  descriptor.TargetSHA256,
		APIKey:        apiKey,
	}, nil
}

func (s *fakeStore) Status(context.Context) (modelconfig.Status, error) {
	s.reads++
	return modelconfig.Status{SchemaVersion: "model_config_status.v1"}, nil
}

func (s *fakeStore) Put(_ context.Context, _ string, input modelconfig.ConfigInput, _ modelconfig.Validation) (modelconfig.ConfigView, error) {
	s.reads++
	s.putInput = &input
	return modelconfig.ConfigView{}, nil
}

func (s *fakeStore) RecordValidation(_ context.Context, name modelconfig.ConfigName, actor string, validation modelconfig.Validation) (modelconfig.ConfigView, error) {
	s.reads++
	if s.recordValidationErr != nil {
		return modelconfig.ConfigView{}, s.recordValidationErr
	}
	s.recordedActor = actor
	s.recordedValidation = &validation
	return modelconfig.ConfigView{Descriptor: fakeDescriptor(name), Validation: &validation}, nil
}

func (s *fakeStore) Select(_ context.Context, actor string, alias, name modelconfig.ConfigName) (modelconfig.Selection, error) {
	s.reads++
	if s.selectErr != nil {
		return modelconfig.Selection{}, s.selectErr
	}
	s.selected = &[3]string{actor, string(alias), string(name)}
	return modelconfig.Selection{ConfigName: name, UpdatedBy: actor}, nil
}

func TestRuntimeReadsNeedNoCredentialAndAreNotConsumerScoped(t *testing.T) {
	store := &fakeStore{}
	tests := []struct {
		path       string
		wantName   modelconfig.ConfigName
		wantAPIKey bool
	}{
		{path: "/internal/model-targets/primary_agent", wantName: modelconfig.ConfigPrimaryAgent},
		{path: "/internal/model-configs/notice_classification", wantName: modelconfig.ConfigNoticeClassificationLLM, wantAPIKey: true},
		{path: "/internal/model-configs/campus_docs_reranker", wantName: modelconfig.ConfigCampusDocsReranker, wantAPIKey: true},
	}
	for _, test := range tests {
		request := httptest.NewRequest(http.MethodGet, test.path, nil)
		response := httptest.NewRecorder()
		New(store).ServeHTTP(response, request)
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d: %s", test.path, response.Code, response.Body.String())
		}
		var payload map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload["name"] != string(test.wantName) {
			t.Fatalf("%s payload = %#v", test.path, payload)
		}
		_, hasAPIKey := payload["api_key"]
		if hasAPIKey != test.wantAPIKey {
			t.Fatalf("%s api_key present = %t", test.path, hasAPIKey)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s is cacheable", test.path)
		}
	}
}

func TestRuntimeConfigAcceptsOptionalExpectedHash(t *testing.T) {
	expected := fakeDescriptor(modelconfig.ConfigPrimaryAgent).TargetSHA256
	for _, path := range []string{
		"/internal/model-configs/primary_agent",
		"/internal/model-configs/primary_agent?expected_target_sha256=" + expected,
	} {
		response := httptest.NewRecorder()
		New(&fakeStore{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d: %s", path, response.Code, response.Body.String())
		}
	}
}

func TestRuntimeConfigRejectsInvalidExpectedHashBeforeStoreRead(t *testing.T) {
	for _, expected := range []string{"", "stale", strings.Repeat("A", 64), "sha256:" + strings.Repeat("a", 64)} {
		store := &fakeStore{}
		request := httptest.NewRequest(http.MethodGet, "/internal/model-configs/primary_agent?expected_target_sha256="+expected, nil)
		response := httptest.NewRecorder()
		New(store).ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest || store.reads != 0 {
			t.Fatalf("expected=%q status=%d reads=%d body=%s", expected, response.Code, store.reads, response.Body.String())
		}
	}
}

func TestRuntimeConfigReturnsConflictForTargetMismatch(t *testing.T) {
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/internal/model-configs/primary_agent?expected_target_sha256="+strings.Repeat("0", 64), nil)
	New(&fakeStore{}).ServeHTTP(response, request)
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
}

func TestAdminStatusUsesTheSameListenerWithoutCredential(t *testing.T) {
	response := httptest.NewRecorder()
	New(&fakeStore{}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/internal/admin/model-configs", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
}

func TestAdminPutPersistsTheNormalizedConfigAndCredentialItValidated(t *testing.T) {
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer existing-secret" {
			t.Errorf("provider request = %s %s authorization=%q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"id": "response"})
	}))
	defer provider.Close()
	previousTransport := http.DefaultTransport
	http.DefaultTransport = provider.Client().Transport
	defer func() { http.DefaultTransport = previousTransport }()

	store := &fakeStore{currentAPIKey: "existing-secret"}
	body := fmt.Sprintf(`{"provider":" openai-compatible ","api_protocol":" openai.responses ","base_url":%q,"model":" test-model "}`, provider.URL+"/v1/")
	request := httptest.NewRequest(http.MethodPut, "/internal/admin/model-configs/primary_agent", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Model-Config-Actor", "ops-user")
	response := httptest.NewRecorder()
	New(store).ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
	if store.putInput == nil || store.putInput.APIKey == nil {
		t.Fatal("validated input was not persisted")
	}
	if *store.putInput.APIKey != "existing-secret" || store.putInput.Name != modelconfig.ConfigPrimaryAgent || store.putInput.BaseURL != provider.URL+"/v1" || store.putInput.Provider != "openai-compatible" || store.putInput.APIProtocol != "openai.responses" || store.putInput.Model != "test-model" {
		t.Fatalf("persisted input = %#v api_key=%q", *store.putInput, *store.putInput.APIKey)
	}
}

func TestAdminPutReturnsFailedValidationWithoutRecordingIt(t *testing.T) {
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer existing-secret" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		http.Error(w, `{"error":"structured output unsupported"}`, http.StatusUnprocessableEntity)
	}))
	defer provider.Close()
	previousTransport := http.DefaultTransport
	http.DefaultTransport = provider.Client().Transport
	defer func() { http.DefaultTransport = previousTransport }()

	store := &fakeStore{currentAPIKey: "existing-secret"}
	body := fmt.Sprintf(`{"provider":"openai-compatible","api_protocol":"openai.responses","base_url":%q,"model":"candidate-model"}`, provider.URL)
	request := httptest.NewRequest(http.MethodPut, "/internal/admin/model-configs/notice_classification_llm", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Model-Config-Actor", "ops-user")
	response := httptest.NewRecorder()
	New(store).ServeHTTP(response, request)

	if response.Code != http.StatusUnprocessableEntity || store.putInput != nil {
		t.Fatalf("status=%d body=%s put=%#v", response.Code, response.Body.String(), store.putInput)
	}
	if store.recordedValidation != nil || store.recordedActor != "" {
		t.Fatalf("candidate validation was recorded: actor=%q validation=%#v", store.recordedActor, store.recordedValidation)
	}
	var validation modelconfig.Validation
	if err := json.Unmarshal(response.Body.Bytes(), &validation); err != nil {
		t.Fatal(err)
	}
	if validation.ErrorCode != "provider_http_422" || !strings.Contains(validation.Message, "structured output unsupported") {
		t.Fatalf("response validation = %#v", validation)
	}
}

func TestAdminRevalidatesCurrentConfigAndRecordsTheOutcome(t *testing.T) {
	tests := []struct {
		name       string
		output     string
		wantStatus int
		wantResult string
	}{
		{name: "passed", output: `{"category":"examination","intent":"event"}`, wantStatus: http.StatusOK, wantResult: "passed"},
		{name: "failed", output: `{"category":"invalid","intent":"event"}`, wantStatus: http.StatusUnprocessableEntity, wantResult: "failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer current-secret" {
					t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
				}
				writeJSON(w, http.StatusOK, map[string]any{"output_text": test.output})
			}))
			defer provider.Close()
			previousTransport := http.DefaultTransport
			http.DefaultTransport = provider.Client().Transport
			defer func() { http.DefaultTransport = previousTransport }()

			target := modelconfig.Target{
				Name:        modelconfig.ConfigNoticeClassificationLLM,
				Provider:    "openai-compatible",
				APIProtocol: "openai.responses",
				BaseURL:     provider.URL,
				Model:       "classifier-model",
			}
			store := &fakeStore{currentAPIKey: "current-secret", currentTarget: &target}
			request := httptest.NewRequest(http.MethodPost, "/internal/admin/model-configs/notice_classification_llm/validate", nil)
			request.Header.Set("X-Model-Config-Actor", "ops-user")
			response := httptest.NewRecorder()
			New(store).ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if store.putInput != nil || store.recordedValidation == nil || store.recordedValidation.Status != test.wantResult {
				t.Fatalf("put=%#v recorded=%#v", store.putInput, store.recordedValidation)
			}
			if store.recordedActor != "ops-user" {
				t.Fatalf("actor = %q", store.recordedActor)
			}
		})
	}
}

func TestAdminWritesToAReadAliasAreNotRoutes(t *testing.T) {
	for _, test := range []struct{ method, path string }{
		{http.MethodPut, "/internal/admin/model-configs/notice_classification"},
		{http.MethodPost, "/internal/admin/model-configs/notice_classification/validate"},
		{http.MethodPost, "/internal/admin/model-configs/notice_classification/models"},
	} {
		store := &fakeStore{}
		request := httptest.NewRequest(test.method, test.path, strings.NewReader(`{}`))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		New(store).ServeHTTP(response, request)
		if response.Code != http.StatusNotFound || store.reads != 0 {
			t.Fatalf("%s %s status=%d reads=%d", test.method, test.path, response.Code, store.reads)
		}
	}
}

func TestAdminSelectionPointsAnAliasAtAStoredCredential(t *testing.T) {
	store := &fakeStore{}
	request := httptest.NewRequest(http.MethodPut, "/internal/admin/config-selections/notice_classification", strings.NewReader(`{"config_name":"notice_classification_decision"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Model-Config-Actor", "ops-user")
	response := httptest.NewRecorder()
	New(store).ServeHTTP(response, request)
	if response.Code != http.StatusOK || store.selected == nil || *store.selected != [3]string{"ops-user", "notice_classification", "notice_classification_decision"} {
		t.Fatalf("status=%d body=%s selected=%v", response.Code, response.Body.String(), store.selected)
	}

	for _, test := range []struct {
		name, path string
		store      *fakeStore
		wantStatus int
		wantCode   string
	}{
		{name: "stored name is not an alias", path: "/internal/admin/config-selections/notice_classification_decision", store: &fakeStore{}, wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "credential not ready", path: "/internal/admin/config-selections/notice_classification", store: &fakeStore{selectErr: modelconfig.ErrSelectionNotReady}, wantStatus: http.StatusUnprocessableEntity, wantCode: "selection_not_ready"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPut, test.path, strings.NewReader(`{"config_name":"notice_classification_decision"}`))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			New(test.store).ServeHTTP(response, request)
			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			_ = json.Unmarshal(response.Body.Bytes(), &payload)
			if response.Code != test.wantStatus || payload.Error.Code != test.wantCode {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
}

func TestAdminPutRequiresCredentialForInitialConfig(t *testing.T) {
	store := &fakeStore{resolveErr: modelconfig.ErrNotFound}
	request := httptest.NewRequest(http.MethodPut, "/internal/admin/model-configs/primary_agent", strings.NewReader(`{"provider":"openai","api_protocol":"openai.responses","base_url":"https://api.openai.com/v1","model":"gpt-5-mini"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	New(store).ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || store.putInput != nil {
		t.Fatalf("status=%d body=%s put=%#v", response.Code, response.Body.String(), store.putInput)
	}
}

func TestAdminModelsPropagatesResolveFailure(t *testing.T) {
	store := &fakeStore{resolveErr: errors.New("database connection lost")}
	request := httptest.NewRequest(http.MethodPost, "/internal/admin/model-configs/primary_agent/models", strings.NewReader(`{"provider":"openai-compatible","base_url":"https://provider.example/v1"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	New(store).ServeHTTP(response, request)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "model_config_unavailable" {
		t.Fatalf("error code = %q, want model_config_unavailable", payload.Error.Code)
	}
}

func TestAdminPutRejectsTrailingJSONValue(t *testing.T) {
	request := httptest.NewRequest(http.MethodPut, "/internal/admin/model-configs/primary_agent", strings.NewReader(`{"provider":"openai"} {}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	New(&fakeStore{}).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
}

func TestReadinessFailureIsUnavailable(t *testing.T) {
	store := failingReadyStore{fakeStore: fakeStore{}}
	response := httptest.NewRecorder()
	New(&store).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", response.Code)
	}
}

type failingReadyStore struct{ fakeStore }

func (*failingReadyStore) Readiness(context.Context) error {
	return errors.New("decrypt failed")
}
