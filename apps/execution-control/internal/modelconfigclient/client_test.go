package modelconfigclient

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNewRejectsMissingURL(t *testing.T) {
	if _, err := New("   "); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("New() error = %v", err)
	}
}

func TestResolveModelTargetValidatesContract(t *testing.T) {
	const targetSHA256 = "4b20ab70a9ac22073110f59ea007f27de19d731319b62ed4bd60b11d057c6635"
	target := map[string]any{
		"api_protocol":   "openai.responses",
		"base_url":       "https://api.openai.com/v1",
		"model":          "gpt-5-mini",
		"name":           "primary_agent",
		"provider":       "openai",
		"schema_version": "model_target.v1",
		"target_sha256":  targetSHA256,
	}

	tests := []struct {
		name       string
		mutate     func(map[string]any)
		wantErr    string
		rawPayload string
	}{
		{name: "valid"},
		{name: "schema version", mutate: func(value map[string]any) { value["schema_version"] = "model_target.v2" }, wantErr: "schema version"},
		{name: "name", mutate: func(value map[string]any) { value["name"] = "notice_classification" }, wantErr: "name"},
		{name: "provider", mutate: func(value map[string]any) { value["provider"] = "unknown" }, wantErr: "provider"},
		{name: "protocol", mutate: func(value map[string]any) { value["api_protocol"] = "openai.embeddings" }, wantErr: "API protocol"},
		{name: "hash format", mutate: func(value map[string]any) { value["target_sha256"] = strings.Repeat("A", 64) }, wantErr: "hash"},
		{name: "unknown field", rawPayload: fmt.Sprintf(`{"api_protocol":"openai.responses","base_url":"https://api.openai.com/v1","model":"gpt-5-mini","name":"primary_agent","provider":"openai","schema_version":"model_target.v1","target_sha256":%q,"extra":true}`, targetSHA256), wantErr: "unknown field"},
		{name: "trailing JSON", rawPayload: fmt.Sprintf(`{"api_protocol":"openai.responses","base_url":"https://api.openai.com/v1","model":"gpt-5-mini","name":"primary_agent","provider":"openai","schema_version":"model_target.v1","target_sha256":%q} {}`, targetSHA256), wantErr: "one JSON value"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			value := make(map[string]any, len(target))
			for key, item := range target {
				value[key] = item
			}
			if test.mutate != nil {
				test.mutate(value)
			}
			payload := test.rawPayload
			if payload == "" {
				raw, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				payload = string(raw)
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/internal/model-targets/primary_agent" || r.Header.Get("Authorization") != "" {
					t.Errorf("request = %s %s authorization=%q", r.Method, r.URL.Path, r.Header.Get("Authorization"))
				}
				_, _ = w.Write([]byte(payload))
			}))
			defer server.Close()

			client, err := New(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			got, err := client.ResolveModelTarget(context.Background())
			if test.wantErr == "" {
				if err != nil {
					t.Fatal(err)
				}
				want := ModelTarget{TargetSHA256: targetSHA256}
				if got != want {
					t.Fatalf("setting = %#v, want %#v", got, want)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, test.wantErr)
			}
		})
	}
}

func TestResolveModelTargetRejectsNonSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()
	client, err := New(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.ResolveModelTarget(context.Background()); err == nil || !strings.Contains(err.Error(), "HTTP 403") {
		t.Fatalf("error = %v", err)
	}
}
