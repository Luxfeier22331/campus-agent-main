package modelconfig

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

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
		if r.Method != http.MethodPost || r.URL.Path != "/v1/rerank" || r.Header.Get("Authorization") != "Bearer secret" {
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
