package modelconfig

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestGeminiValidationAndDiscovery(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "secret" || r.Header.Get("Authorization") != "" {
			t.Error("native Gemini authentication missing or mixed with Bearer")
		}
		switch r.URL.Path {
		case "/v1beta/models/gemini-test:generateContent":
			if r.Method != http.MethodPost {
				t.Error("expected POST")
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body["contents"] == nil {
				t.Error("missing native contents")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]string{"text": "OK"}}}}}})
		case "/v1beta/models":
			if r.URL.Query().Get("pageToken") == "next" {
				_ = json.NewEncoder(w).Encode(map[string]any{"models": []any{map[string]string{"name": "models/gemini-b"}}})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"models": []any{map[string]string{"name": "models/gemini-a"}}, "nextPageToken": "next"})
			}
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()
	previous := http.DefaultTransport
	http.DefaultTransport = server.Client().Transport
	defer func() { http.DefaultTransport = previous }()
	target := Target{Name: ConfigPrimaryAgent, Provider: "google", APIProtocol: "google.generate_content", BaseURL: server.URL + "/v1beta", Model: "gemini-test"}
	if result := Validate(context.Background(), target, "secret"); result.Status != "passed" {
		t.Fatalf("validation: %#v", result)
	}
	models, result := discoverGeminiModels(context.Background(), target.BaseURL, "secret")
	if result.Status != "passed" || !reflect.DeepEqual(models, []string{"gemini-a", "gemini-b"}) {
		t.Fatalf("discovery: %v %#v", models, result)
	}
	for _, name := range []ConfigName{ConfigCampusDocsEmbedding, ConfigCampusDocsReranker, ConfigNoticeClassification} {
		target.Name = name
		if validateShape(target, "secret") == nil || discoveryProviderAllowed(name, "google") {
			t.Fatalf("Gemini unexpectedly accepted for %s", name)
		}
	}
}
