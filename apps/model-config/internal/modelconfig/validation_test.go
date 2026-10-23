package modelconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestValidateResponsesLimitsOutput(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Input           string `json:"input"`
			MaxOutputTokens int    `json:"max_output_tokens"`
			Model           string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode validation request: %v", err)
		}
		if body.Model != "reasoning-model" || body.Input != "model-config validation" || body.MaxOutputTokens != 1 {
			t.Fatalf("validation request = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "resp_model_config_validation", "status": "incomplete"})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	validation := Validate(context.Background(), Target{
		Name:        ConfigPrimaryAgent,
		Provider:    "openai-compatible",
		APIProtocol: "openai.responses",
		BaseURL:     server.URL + "/v1",
		Model:       "reasoning-model",
	}, "secret")
	if validation.Status != "passed" {
		t.Fatalf("Validate() = %#v", validation)
	}
}

func TestValidateNoticeClassificationUsesStructuredOutput(t *testing.T) {
	tests := []struct {
		name       string
		protocol   string
		path       string
		provider   string
		response   map[string]any
		assertBody func(*testing.T, map[string]any)
	}{
		{
			name:     "responses",
			protocol: "openai.responses",
			path:     "/v1/responses",
			response: map[string]any{"output_text": `{"category":"examination","intent":"event"}`},
			assertBody: func(t *testing.T, body map[string]any) {
				t.Helper()
				if _, ok := body["max_output_tokens"]; ok {
					t.Fatalf("responses validation request must not set max_output_tokens: %#v", body)
				}
				text := body["text"].(map[string]any)
				format := text["format"].(map[string]any)
				if format["type"] != "json_schema" || format["strict"] != true {
					t.Fatalf("responses format = %#v", format)
				}
				assertNoticeClassificationSchema(t, format["schema"])
			},
		},
		{
			name:     "chat completions",
			protocol: "openai.chat_completions",
			path:     "/v1/chat/completions",
			response: map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": `{"category":"examination","intent":"event"}`}}}},
			assertBody: func(t *testing.T, body map[string]any) {
				t.Helper()
				if _, ok := body["max_tokens"]; ok {
					t.Fatalf("chat completions validation request must not set max_tokens: %#v", body)
				}
				responseFormat := body["response_format"].(map[string]any)
				jsonSchema := responseFormat["json_schema"].(map[string]any)
				if responseFormat["type"] != "json_schema" || jsonSchema["strict"] != true {
					t.Fatalf("chat response_format = %#v", responseFormat)
				}
				assertNoticeClassificationSchema(t, jsonSchema["schema"])
			},
		},
		{
			name:     "system one",
			provider: "typesafe",
			protocol: "typesafe.systemone",
			path:     "/v1/systemone",
			response: map[string]any{"answers": map[string]any{
				"category": map[string]any{"choice": "examination", "confidence": 0.9, "type": "choice"},
				"intent":   map[string]any{"choice": "event", "confidence": 0.9, "type": "choice"},
			}},
			assertBody: func(t *testing.T, body map[string]any) {
				t.Helper()
				for _, name := range []string{"category", "intent"} {
					question := body["questions"].(map[string]any)[name].(map[string]any)
					if question["type"] != "choice" {
						t.Fatalf("system one %s question type = %#v", name, question)
					}
					criteria := question["criteria"].(map[string]any)
					if len(criteria) < 2 {
						t.Fatalf("system one %s criteria must offer at least two options: %#v", name, criteria)
					}
				}
				if _, ok := body["state"]; !ok {
					t.Fatalf("system one validation request must set state: %#v", body)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != test.path || r.Header.Get("Authorization") != "Bearer secret" {
					t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatalf("decode validation request: %v", err)
				}
				if body["model"] != "classifier-model" {
					t.Fatalf("validation request = %#v", body)
				}
				if test.protocol != "typesafe.systemone" && body["temperature"] != float64(0) {
					t.Fatalf("validation request = %#v", body)
				}
				test.assertBody(t, body)
				_ = json.NewEncoder(w).Encode(test.response)
			}))
			defer server.Close()
			previous := http.DefaultTransport
			http.DefaultTransport = server.Client().Transport
			defer func() { http.DefaultTransport = previous }()

			provider, name := test.provider, ConfigNoticeClassificationDecision
			if provider == "" {
				provider, name = "openai-compatible", ConfigNoticeClassificationLLM
			}
			validation := Validate(context.Background(), Target{
				Name:        name,
				Provider:    provider,
				APIProtocol: test.protocol,
				BaseURL:     server.URL + "/v1",
				Model:       "classifier-model",
			}, "secret")
			if validation.Status != "passed" {
				t.Fatalf("Validate() = %#v", validation)
			}
		})
	}
}

func TestValidateNoticeClassificationRejectsInvalidOutputWithRawDetails(t *testing.T) {
	tests := []struct {
		name       string
		output     string
		wantBody   string
		wantReason string
	}{
		{name: "unknown category", output: `{"category":"not-a-category","intent":"event"}`, wantBody: "not-a-category", wantReason: "is not allowed"},
		{name: "old category", output: `{"category":"campus_operations","intent":"event"}`, wantBody: "campus_operations", wantReason: "is not allowed"},
		{name: "missing intent", output: `{"category":"examination"}`, wantBody: "examination", wantReason: "intent \"\" is not allowed"},
		{name: "extra property", output: `{"category":"examination","intent":"event","reason":"guess"}`, wantBody: "reason", wantReason: "unknown field"},
		{name: "invalid JSON", output: `{"category":`, wantBody: "output_text", wantReason: "decode notice classification output"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(map[string]any{"output_text": test.output})
			}))
			defer server.Close()
			previous := http.DefaultTransport
			http.DefaultTransport = server.Client().Transport
			defer func() { http.DefaultTransport = previous }()

			validation := Validate(context.Background(), Target{
				Name:        ConfigNoticeClassificationLLM,
				Provider:    "openai-compatible",
				APIProtocol: "openai.responses",
				BaseURL:     server.URL,
				Model:       "classifier-model",
			}, "secret")
			if validation.Status != "failed" || validation.ErrorCode != "invalid_provider_response" {
				t.Fatalf("Validate() = %#v", validation)
			}
			if !strings.Contains(validation.Message, "HTTP 200 OK") ||
				!strings.Contains(validation.Message, test.wantReason) ||
				!strings.Contains(validation.Message, "response body:") ||
				!strings.Contains(validation.Message, test.wantBody) {
				t.Fatalf("validation message = %q", validation.Message)
			}
		})
	}
}

func TestValidatePreservesProviderRejection(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"schema unsupported"}`, http.StatusUnprocessableEntity)
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	validation := Validate(context.Background(), Target{
		Name:        ConfigNoticeClassificationLLM,
		Provider:    "openai-compatible",
		APIProtocol: "openai.responses",
		BaseURL:     server.URL,
		Model:       "classifier-model",
	}, "secret")
	if validation.Status != "failed" || validation.ErrorCode != "provider_http_422" {
		t.Fatalf("Validate() = %#v", validation)
	}
	if !strings.Contains(validation.Message, "HTTP 422 Unprocessable Entity") || !strings.Contains(validation.Message, "schema unsupported") {
		t.Fatalf("validation message = %q", validation.Message)
	}
}

func TestValidateDoesNotTruncateProviderRejection(t *testing.T) {
	body := strings.Repeat("x", 1<<20) + "provider-tail-marker"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = fmt.Fprint(w, body)
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	validation := Validate(context.Background(), Target{
		Name:        ConfigNoticeClassificationLLM,
		Provider:    "openai-compatible",
		APIProtocol: "openai.responses",
		BaseURL:     server.URL,
		Model:       "classifier-model",
	}, "secret")
	if validation.Status != "failed" || validation.ErrorCode != "provider_http_422" {
		t.Fatalf("Validate() = %#v", validation)
	}
	if !strings.Contains(validation.Message, "provider-tail-marker") {
		t.Fatalf("validation message omitted provider response tail")
	}
}

func TestValidateSystemOneRejectsInvalidAnswers(t *testing.T) {
	tests := []struct {
		name       string
		response   map[string]any
		wantReason string
	}{
		{name: "missing category answer", response: map[string]any{"answers": map[string]any{}}, wantReason: "missing the category answer"},
		{name: "unknown category", response: map[string]any{"answers": map[string]any{"category": map[string]any{"choice": "not-a-category"}}}, wantReason: "is not allowed"},
		{name: "no choice", response: map[string]any{"answers": map[string]any{"category": map[string]any{"type": "choice"}}}, wantReason: "is not allowed"},
		{name: "missing intent answer", response: map[string]any{"answers": map[string]any{"category": map[string]any{"choice": "examination"}}}, wantReason: "missing the intent answer"},
		{name: "unknown intent", response: map[string]any{"answers": map[string]any{"category": map[string]any{"choice": "examination"}, "intent": map[string]any{"choice": "upcoming"}}}, wantReason: "intent \"upcoming\" is not allowed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(test.response)
			}))
			defer server.Close()
			previous := http.DefaultTransport
			http.DefaultTransport = server.Client().Transport
			defer func() { http.DefaultTransport = previous }()

			validation := Validate(context.Background(), Target{
				Name:        ConfigNoticeClassificationDecision,
				Provider:    "typesafe",
				APIProtocol: "typesafe.systemone",
				BaseURL:     server.URL,
				Model:       "jev-latest",
			}, "secret")
			if validation.Status != "failed" || validation.ErrorCode != "invalid_provider_response" {
				t.Fatalf("Validate() = %#v", validation)
			}
			if !strings.Contains(validation.Message, test.wantReason) {
				t.Fatalf("validation message = %q", validation.Message)
			}
		})
	}
}

func TestValidateShapeBindsEachNoticeClassificationBackendToItsProtocol(t *testing.T) {
	jev := Target{Name: ConfigNoticeClassificationDecision, Provider: "typesafe", APIProtocol: "typesafe.systemone", BaseURL: "https://gateway.example/v1", Model: "jev-latest"}
	drex := Target{Name: ConfigNoticeClassificationDecision, Provider: "nace", APIProtocol: "typesafe.systemone", BaseURL: "https://console.nace.ai/v1", Model: "drex-max"}
	llm := Target{Name: ConfigNoticeClassificationLLM, Provider: "openai-compatible", APIProtocol: "openai.chat_completions", BaseURL: "https://llm.example/v1", Model: "llm-model"}
	for _, target := range []Target{jev, drex, llm} {
		if err := validateShape(target, "secret"); err != nil {
			t.Fatalf("validateShape(%s) = %v", target.Name, err)
		}
	}
	responses := llm
	responses.Provider, responses.APIProtocol = "openai", "openai.responses"
	if err := validateShape(responses, "secret"); err != nil {
		t.Fatalf("validateShape(responses) = %v", err)
	}
	for _, invalid := range []Target{
		{Name: jev.Name, Provider: "openai-compatible", APIProtocol: "typesafe.systemone", BaseURL: jev.BaseURL, Model: jev.Model},
		{Name: jev.Name, Provider: "openai-compatible", APIProtocol: "openai.chat_completions", BaseURL: jev.BaseURL, Model: jev.Model},
		{Name: drex.Name, Provider: "nace", APIProtocol: "openai.chat_completions", BaseURL: drex.BaseURL, Model: drex.Model},
		{Name: llm.Name, Provider: "typesafe", APIProtocol: "typesafe.systemone", BaseURL: llm.BaseURL, Model: llm.Model},
		{Name: llm.Name, Provider: "nace", APIProtocol: "typesafe.systemone", BaseURL: llm.BaseURL, Model: llm.Model},
		{Name: ConfigNoticeClassification, Provider: "typesafe", APIProtocol: "typesafe.systemone", BaseURL: jev.BaseURL, Model: jev.Model},
	} {
		if err := validateShape(invalid, "secret"); err == nil {
			t.Fatalf("validateShape() accepted %#v", invalid)
		}
	}
	if !discoveryProviderAllowed(ConfigNoticeClassificationDecision, "typesafe") || !discoveryProviderAllowed(ConfigNoticeClassificationDecision, "nace") ||
		discoveryProviderAllowed(ConfigNoticeClassificationDecision, "openai") ||
		!discoveryProviderAllowed(ConfigNoticeClassificationLLM, "openai-compatible") || discoveryProviderAllowed(ConfigNoticeClassificationLLM, "typesafe") ||
		discoveryProviderAllowed(ConfigNoticeClassification, "openai") {
		t.Fatal("discovery providers are not bound to the notice classification backends")
	}
}

func assertNoticeClassificationSchema(t *testing.T, value any) {
	t.Helper()
	schema := value.(map[string]any)
	properties := schema["properties"].(map[string]any)
	category := properties["category"].(map[string]any)
	if intent := properties["intent"].(map[string]any); len(intent["enum"].([]any)) != len(noticeClassificationIntents) {
		t.Fatalf("intent enum = %#v", intent)
	}
	if required := schema["required"].([]any); len(required) != 2 {
		t.Fatalf("required = %#v", required)
	}
	got := category["enum"].([]any)
	if len(got) != len(noticeClassificationCategories) {
		t.Fatalf("category enum length = %d, want %d", len(got), len(noticeClassificationCategories))
	}
	for index, want := range noticeClassificationCategories {
		if got[index] != want {
			t.Fatalf("category enum[%d] = %#v, want %q", index, got[index], want)
		}
	}
}

func TestValidateEmbeddingRequestsCanonicalDimensions(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/embeddings" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Model      string   `json:"model"`
			Input      []string `json:"input"`
			Dimensions int      `json:"dimensions"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode validation request: %v", err)
		}
		if body.Model != embeddingModel || !reflect.DeepEqual(body.Input, []string{"model-config validation"}) || body.Dimensions != embeddingDimensions {
			t.Fatalf("validation request = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"embedding": make([]float64, embeddingDimensions)}}})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	validation := Validate(context.Background(), Target{
		Name:        ConfigCampusDocsEmbedding,
		Provider:    "openai-compatible",
		APIProtocol: "openai.embeddings",
		BaseURL:     server.URL + "/v1",
		Model:       embeddingModel,
	}, "secret")
	if validation.Status != "passed" || validation.ObservedDimensions != embeddingDimensions {
		t.Fatalf("Validate() = %#v", validation)
	}
}

func TestValidateRerankerRequestsAndChecksResponse(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/rerank" || r.Header.Get("Authorization") != "Bearer secret" || r.Header.Get("X-Failover-Enabled") != "true" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Documents []string `json:"documents"`
			Model     string   `json:"model"`
			Query     string   `json:"query"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode validation request: %v", err)
		}
		if body.Model != "rerank-v4" || body.Query != "model-config validation" || !reflect.DeepEqual(body.Documents, []string{"model-config validation document"}) {
			t.Fatalf("validation request = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []any{map[string]any{"index": 0, "relevance_score": 0.9}}})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	validation := Validate(context.Background(), Target{
		Name:        ConfigCampusDocsReranker,
		Provider:    "cohere-compatible",
		APIProtocol: rerankAPIProtocol,
		BaseURL:     server.URL + "/v1",
		Model:       "rerank-v4",
	}, "secret")
	if validation.Status != "passed" {
		t.Fatalf("Validate() = %#v", validation)
	}
}

func TestValidateRerankerRejectsIncompleteResponse(t *testing.T) {
	for _, response := range []map[string]any{
		{"results": []any{map[string]any{"index": 1, "relevance_score": 0.9}}},
		{"results": []any{map[string]any{"relevance_score": 0.9}}},
		{"results": []any{map[string]any{"index": 0}}},
	} {
		t.Run(fmt.Sprint(response), func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			previous := http.DefaultTransport
			http.DefaultTransport = server.Client().Transport
			defer func() { http.DefaultTransport = previous }()

			validation := Validate(context.Background(), Target{
				Name:        ConfigCampusDocsReranker,
				Provider:    "cohere",
				APIProtocol: rerankAPIProtocol,
				BaseURL:     server.URL + "/v1",
				Model:       "rerank-v4",
			}, "secret")
			if validation.Status != "failed" || validation.ErrorCode != "invalid_provider_response" {
				t.Fatalf("Validate() = %#v", validation)
			}
		})
	}
}

func TestValidateTextProviderResponses(t *testing.T) {
	tests := []struct {
		name     string
		protocol string
		body     string
		wantPass bool
	}{
		{name: "responses valid", protocol: "openai.responses", body: `{"id":"resp_123","output":[]}`, wantPass: true},
		{name: "responses missing id", protocol: "openai.responses", body: `{"output":[]}`},
		{name: "responses malformed", protocol: "openai.responses", body: `{"id":`},
		{name: "chat valid", protocol: "openai.chat_completions", body: `{"choices":[{"message":{"role":"assistant","content":"ok"}}]}`, wantPass: true},
		{name: "chat missing choices", protocol: "openai.chat_completions", body: `{"id":"chatcmpl_123"}`},
		{name: "chat null message", protocol: "openai.chat_completions", body: `{"choices":[{"message":null}]}`},
		{name: "chat non-object message", protocol: "openai.chat_completions", body: `{"choices":[{"message":"ok"}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateTextProviderResponse(test.protocol, []byte(test.body)); (err == nil) != test.wantPass {
				t.Fatalf("validateTextProviderResponse() error = %v, want pass = %t", err, test.wantPass)
			}
		})
	}
}

func TestDiscoverModels(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		_, _ = fmt.Fprint(w, "{\"data\":[{\"id\":\"z-model\"},{\"id\":\"a-model\"},{\"id\":\"z-model\"}]}")
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	models, validation := DiscoverModels(context.Background(), ConfigPrimaryAgent, "openai-compatible", server.URL+"/v1", "secret")
	if validation.Status != "passed" {
		t.Fatalf("DiscoverModels() validation = %#v", validation)
	}
	if !reflect.DeepEqual(models, []string{"a-model", "z-model"}) {
		t.Fatalf("DiscoverModels() = %#v", models)
	}
}

func TestDiscoverModelsReadsNaceModelNames(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		_, _ = fmt.Fprint(w, "{\"models\":[{\"name\":\"drex-max\",\"alias_for\":null},{\"name\":\"drex-latest\",\"alias_for\":\"drex-v2.0\"}],\"request_id\":\"r\"}")
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	models, validation := DiscoverModels(context.Background(), ConfigNoticeClassificationDecision, "nace", server.URL+"/v1", "secret")
	if validation.Status != "passed" || !reflect.DeepEqual(models, []string{"drex-latest", "drex-max"}) {
		t.Fatalf("DiscoverModels() = %#v %#v", models, validation)
	}
}

func TestDiscoverModelsReturnsCompleteProviderCatalog(t *testing.T) {
	const modelCount = 501
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		models := make([]map[string]string, 0, modelCount)
		for index := range modelCount {
			models = append(models, map[string]string{"id": fmt.Sprintf("model-%03d", index)})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": models})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	models, validation := DiscoverModels(context.Background(), ConfigPrimaryAgent, "openai-compatible", server.URL+"/v1", "secret")
	if validation.Status != "passed" {
		t.Fatalf("DiscoverModels() validation = %#v", validation)
	}
	if len(models) != modelCount || models[0] != "model-000" || models[modelCount-1] != "model-500" {
		t.Fatalf("DiscoverModels() returned %d models: first = %q, last = %q", len(models), models[0], models[len(models)-1])
	}
}

func TestDiscoverModelsAcceptsResponseLargerThanOneMiB(t *testing.T) {
	const modelCount = 5_000
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		models := make([]map[string]string, 0, modelCount)
		for index := range modelCount {
			models = append(models, map[string]string{
				"id": fmt.Sprintf("model-%04d-%s", index, strings.Repeat("x", 240)),
			})
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": models})
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	models, validation := DiscoverModels(context.Background(), ConfigPrimaryAgent, "openai-compatible", server.URL+"/v1", "secret")
	if validation.Status != "passed" {
		t.Fatalf("DiscoverModels() validation = %#v", validation)
	}
	if len(models) != modelCount || !strings.HasPrefix(models[0], "model-0000-") || !strings.HasPrefix(models[modelCount-1], "model-4999-") {
		t.Fatalf("DiscoverModels() returned %d models with unexpected boundaries", len(models))
	}
}

func TestDiscoverModelsReturnsInvalidResponseWhenProviderBodyReadFails(t *testing.T) {
	previous := http.DefaultTransport
	http.DefaultTransport = roundTripperFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Status:     "200 OK",
			Header:     make(http.Header),
			Body:       failingReadCloser{},
		}, nil
	})
	defer func() { http.DefaultTransport = previous }()

	_, validation := DiscoverModels(context.Background(), ConfigPrimaryAgent, "openai-compatible", "https://provider.example/v1", "secret")
	if validation.Status != "failed" || validation.ErrorCode != "invalid_response" {
		t.Fatalf("DiscoverModels() validation = %#v", validation)
	}
}

func TestDiscoverCohereModels(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		_, _ = fmt.Fprint(w, `{"models":[{"name":"rerank-v4"},{"name":"rerank-v4"},{"name":"embed-v4"}]}`)
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	models, validation := DiscoverModels(context.Background(), ConfigCampusDocsReranker, "cohere", server.URL+"/v2", "secret")
	if validation.Status != "passed" {
		t.Fatalf("DiscoverModels() validation = %#v", validation)
	}
	if !reflect.DeepEqual(models, []string{"embed-v4", "rerank-v4"}) {
		t.Fatalf("DiscoverModels() = %#v", models)
	}
}

func TestDiscoverCohereCompatibleModelsAcceptsOpenAIModelList(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" || r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		_, _ = fmt.Fprint(w, `{"object":"list","data":[{"id":"Qwen3-Reranker-4B"},{"id":"Qwen3-Embedding-4B"}]}`)
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()

	models, validation := DiscoverModels(context.Background(), ConfigCampusDocsReranker, "cohere-compatible", server.URL+"/v1", "secret")
	if validation.Status != "passed" {
		t.Fatalf("DiscoverModels() validation = %#v", validation)
	}
	if !reflect.DeepEqual(models, []string{"Qwen3-Embedding-4B", "Qwen3-Reranker-4B"}) {
		t.Fatalf("DiscoverModels() = %#v", models)
	}
}

func TestDiscoverModelsEnforcesUsageConnectorAndResponseShape(t *testing.T) {
	tests := []struct {
		name       string
		configName ConfigName
		provider   string
		body       string
		wantError  string
	}{
		{
			name:       "reranker rejects openai connector",
			configName: ConfigCampusDocsReranker,
			provider:   "openai-compatible",
			body:       `{"data":[{"id":"model"}]}`,
			wantError:  "invalid_setting",
		},
		{
			name:       "chat rejects cohere connector",
			configName: ConfigPrimaryAgent,
			provider:   "cohere",
			body:       `{"models":[{"name":"model"}]}`,
			wantError:  "invalid_setting",
		},
		{
			name:       "openai rejects cohere response shape",
			configName: ConfigPrimaryAgent,
			provider:   "openai",
			body:       `{"models":[{"name":"model"}]}`,
			wantError:  "invalid_response",
		},
		{
			name:       "cohere rejects openai response shape",
			configName: ConfigCampusDocsReranker,
			provider:   "cohere",
			body:       `{"data":[{"id":"model"}]}`,
			wantError:  "invalid_response",
		},
		{
			name:       "rejects trailing JSON value",
			configName: ConfigPrimaryAgent,
			provider:   "openai",
			body:       `{"data":[]} {"data":[]}`,
			wantError:  "invalid_response",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = fmt.Fprint(w, test.body)
			}))
			defer server.Close()
			previous := http.DefaultTransport
			http.DefaultTransport = server.Client().Transport
			defer func() { http.DefaultTransport = previous }()

			_, validation := DiscoverModels(context.Background(), test.configName, test.provider, server.URL, "secret")
			if validation.Status != "failed" || validation.ErrorCode != test.wantError {
				t.Fatalf("DiscoverModels() validation = %#v, want %q", validation, test.wantError)
			}
		})
	}
}

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (f roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

type failingReadCloser struct{}

func (failingReadCloser) Read(p []byte) (int, error) {
	const body = `{"data":[`
	n := copy(p, body)
	return n, errors.New("provider response read failed")
}

func (failingReadCloser) Close() error { return nil }
