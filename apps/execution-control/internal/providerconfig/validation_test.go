package providerconfig

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestValidateSnapshotUsesConfiguredPromptTransport(t *testing.T) {
	tests := []struct {
		name          string
		transport     string
		wantPath      string
		wantBodyField string
		response      map[string]any
	}{
		{
			name:          "responses",
			transport:     "responses",
			wantPath:      "/responses",
			wantBodyField: "input",
			response:      map[string]any{"id": "resp_validation"},
		},
		{
			name:          "chat completions",
			transport:     "chat_completions",
			wantPath:      "/chat/completions",
			wantBodyField: "messages",
			response:      map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "OK"}}}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
				if request.URL.Path != test.wantPath {
					t.Fatalf("request path = %q, want %q", request.URL.Path, test.wantPath)
				}
				if request.Header.Get("authorization") != "Bearer secret" {
					t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
				}
				var payload map[string]any
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Fatalf("decode request body: %v", err)
				}
				if payload[test.wantBodyField] == nil {
					t.Fatalf("request body missing %q: %#v", test.wantBodyField, payload)
				}
				if payload["model"] != "model-1" {
					t.Fatalf("request model = %#v", payload["model"])
				}
				response.Header().Set("content-type", "application/json")
				_ = json.NewEncoder(response).Encode(test.response)
			}))
			defer server.Close()

			result := Validate(context.Background(), RuntimeSetting{
				APIKey:    "secret",
				BaseURL:   server.URL,
				Kind:      KindLLM,
				Model:     "model-1",
				Provider:  "openai-compatible",
				Transport: test.transport,
			})

			if result.Status != "passed" {
				t.Fatalf("validation result = %#v", result)
			}
		})
	}
}

func TestValidateSnapshotUsesEmbeddingsTransportAndObservesDimensions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/embeddings" {
			t.Fatalf("request path = %q, want /embeddings", request.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if _, configured := payload["dimensions"]; configured {
			t.Fatalf("validation request must not configure dimensions: %#v", payload)
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}]}`))
	}))
	defer server.Close()

	result := Validate(context.Background(), RuntimeSetting{
		APIKey:    "secret",
		BaseURL:   server.URL,
		Kind:      KindEmbedding,
		Model:     "embedding-1",
		Provider:  "openai-compatible",
		Transport: "embeddings",
	})

	if result.Status != "passed" || result.ObservedDimensions != 3 {
		t.Fatalf("validation result = %#v", result)
	}
}

func TestValidateSnapshotRejectsUnsupportedTransportBeforeCallingProvider(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		called = true
	}))
	defer server.Close()

	tests := []RuntimeSetting{
		{
			APIKey: "secret", BaseURL: server.URL, Kind: KindLLM, Model: "model-1",
			Provider: "openai-compatible", Transport: "legacy_prompt",
		},
		{
			APIKey: "secret", BaseURL: server.URL, Kind: KindEmbedding, Model: "embedding-1",
			Provider: "openai-compatible", Transport: "responses",
		},
	}

	for _, snapshot := range tests {
		result := Validate(context.Background(), snapshot)
		if result.Status != "failed" || result.ErrorCode != "invalid_setting" {
			t.Fatalf("validation result = %#v", result)
		}
	}
	if called {
		t.Fatal("provider must not be called for an unsupported transport")
	}
}

func TestDiscoverModelsUsesProviderCatalogAndReturnsBoundedUniqueIDs(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || request.URL.Path != "/models" {
			t.Fatalf("request = %s %s, want GET /models", request.Method, request.URL.Path)
		}
		if request.Header.Get("authorization") != "Bearer secret" {
			t.Fatalf("authorization header = %q", request.Header.Get("authorization"))
		}
		response.Header().Set("content-type", "application/json")
		_, _ = response.Write([]byte(`{"data":[{"id":"model-z"},{"id":"model-a"},{"id":"model-z"}]}`))
	}))
	defer server.Close()

	models, result := DiscoverModels(context.Background(), RuntimeSetting{
		APIKey:   "secret",
		BaseURL:  server.URL,
		Kind:     KindLLM,
		Provider: "openai-compatible",
	})

	if result.Status != "passed" {
		t.Fatalf("discovery result = %#v", result)
	}
	if !slices.Equal(models, []string{"model-a", "model-z"}) {
		t.Fatalf("models = %#v", models)
	}
}

func TestDiscoverModelsRejectsInvalidProviderResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{"data":[{"object":"model"}]}`))
	}))
	defer server.Close()

	models, result := DiscoverModels(context.Background(), RuntimeSetting{
		APIKey:   "secret",
		BaseURL:  server.URL,
		Kind:     KindLLM,
		Provider: "openai",
	})

	if models != nil || result.Status != "failed" || result.ErrorCode != "invalid_response" {
		t.Fatalf("models = %#v, result = %#v", models, result)
	}
}
