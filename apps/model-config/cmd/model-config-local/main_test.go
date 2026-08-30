package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/model-config/internal/modelconfig"
)

func TestLocalSeedConfigsMapEachNameToItsEnvironmentContract(t *testing.T) {
	tests := []struct {
		name        modelconfig.ConfigName
		environment map[string]string
		want        modelconfig.LocalSeedConfig
	}{
		{
			name: modelconfig.ConfigPrimaryAgent,
			environment: map[string]string{
				"LLM_API_KEY":  "primary-key",
				"LLM_BASE_URL": "https://primary.example/v1/",
				"LLM_MODEL":    "primary-model",
			},
			want: modelconfig.LocalSeedConfig{
				APIKey: "primary-key", Name: modelconfig.ConfigPrimaryAgent, Provider: "openai-compatible",
				APIProtocol: "openai.responses", BaseURL: "https://primary.example/v1/", Model: "primary-model",
			},
		},
		{
			name: modelconfig.ConfigNoticeClassification,
			environment: map[string]string{
				"LLM_API_KEY":                    "must-not-be-used",
				"LLM_BASE_URL":                   "https://primary.example/v1",
				"NOTICE_CLASSIFICATION_API_KEY":  "classifier-key",
				"NOTICE_CLASSIFICATION_BASE_URL": "https://classifier.example/v1",
				"NOTICE_CLASSIFICATION_MODEL":    "classifier-model",
			},
			want: modelconfig.LocalSeedConfig{
				APIKey: "classifier-key", Name: modelconfig.ConfigNoticeClassification, Provider: "openai-compatible",
				APIProtocol: "openai.responses", BaseURL: "https://classifier.example/v1", Model: "classifier-model",
			},
		},
		{
			name: modelconfig.ConfigCampusDocsEmbedding,
			environment: map[string]string{
				"EMBEDDING_API_KEY":  "embedding-key",
				"EMBEDDING_BASE_URL": "https://embedding.example/v1",
			},
			want: modelconfig.LocalSeedConfig{
				APIKey: "embedding-key", Name: modelconfig.ConfigCampusDocsEmbedding, Provider: "openai-compatible",
				APIProtocol: "openai.embeddings", BaseURL: "https://embedding.example/v1", Model: "Qwen3-Embedding-4B",
			},
		},
		{
			name: modelconfig.ConfigCampusDocsReranker,
			environment: map[string]string{
				"RERANK_API_KEY":  "rerank-key",
				"RERANK_BASE_URL": "https://rerank.example/v1",
				"RERANK_MODEL":    "rerank-model",
			},
			want: modelconfig.LocalSeedConfig{
				APIKey: "rerank-key", Name: modelconfig.ConfigCampusDocsReranker, Provider: "cohere-compatible",
				APIProtocol: "cohere.rerank", BaseURL: "https://rerank.example/v1", Model: "rerank-model",
			},
		},
	}

	for _, test := range tests {
		t.Run(string(test.name), func(t *testing.T) {
			configs, missing := localSeedConfigs([]modelconfig.ConfigName{test.name}, func(key string) (string, bool) {
				value, ok := test.environment[key]
				return value, ok
			})
			if len(missing) != 0 {
				t.Fatalf("missing = %v", missing)
			}
			if !reflect.DeepEqual(configs, []modelconfig.LocalSeedConfig{test.want}) {
				t.Fatalf("configs = %#v, want %#v", configs, []modelconfig.LocalSeedConfig{test.want})
			}
		})
	}
}

func TestLocalSeedConfigsReportsSortedMissingVariables(t *testing.T) {
	_, missing := localSeedConfigs([]modelconfig.ConfigName{modelconfig.ConfigNoticeClassification}, func(string) (string, bool) {
		return "", false
	})
	if want := []string{
		"NOTICE_CLASSIFICATION_API_KEY",
		"NOTICE_CLASSIFICATION_BASE_URL",
		"NOTICE_CLASSIFICATION_MODEL",
	}; !reflect.DeepEqual(missing, want) {
		t.Fatalf("missing = %v, want %v", missing, want)
	}
}

func TestLocalSeedConfigsDoesNotModifyNames(t *testing.T) {
	names := []modelconfig.ConfigName{modelconfig.ConfigPrimaryAgent, modelconfig.ConfigCampusDocsEmbedding}
	want := append([]modelconfig.ConfigName(nil), names...)
	localSeedConfigs(names, func(key string) (string, bool) {
		return map[string]string{
			"LLM_API_KEY":        "key",
			"LLM_BASE_URL":       "https://provider.example/v1",
			"LLM_MODEL":          "model",
			"EMBEDDING_API_KEY":  "embedding-key",
			"EMBEDDING_BASE_URL": "https://embedding.example/v1",
		}[key], true
	})
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("names changed from %v to %v", want, names)
	}
}

func TestRunSeedRejectsMissingProviderInputBeforeOpeningStore(t *testing.T) {
	var stdout bytes.Buffer
	err := run(context.Background(), []string{"seed", "--name", string(modelconfig.ConfigPrimaryAgent)}, &stdout, nil, func(key string) (string, bool) {
		if key == "LLM_BASE_URL" || key == "LLM_MODEL" {
			return "configured", true
		}
		if key == "MODEL_CONFIG_DATABASE_URL" || key == "MODEL_CONFIG_ENCRYPTION_KEY_FILE" {
			t.Fatalf("store lookup %s occurred before provider validation", key)
		}
		return "", false
	})
	if err == nil || !strings.Contains(err.Error(), "LLM_API_KEY") {
		t.Fatalf("error = %v, want missing LLM_API_KEY", err)
	}
	if stdout.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", stdout.String())
	}
}

func TestRunRejectsMissingOrDuplicateNamesAndCredentialFlags(t *testing.T) {
	lookup := func(string) (string, bool) { return "", false }
	for _, test := range []struct {
		name string
		args []string
		want string
	}{
		{name: "missing name", args: []string{"check"}, want: "at least one --name is required"},
		{name: "duplicate name", args: []string{"check", "--name", "primary_agent", "--name", "primary_agent"}, want: "duplicate model config name"},
		{name: "api key flag", args: []string{"seed", "--name", "primary_agent", "--api-key", "secret"}, want: "flag provided but not defined"},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := run(context.Background(), test.args, &bytes.Buffer{}, nil, lookup)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestRunCheckReportsUnknownWithoutExposingStoreDetails(t *testing.T) {
	const databaseURL = "postgres://model_config:secret@127.0.0.1:1/model_config"
	var stdout bytes.Buffer
	err := run(context.Background(), []string{"check", "--name", string(modelconfig.ConfigPrimaryAgent)}, &stdout, nil, func(key string) (string, bool) {
		switch key {
		case "MODEL_CONFIG_DATABASE_URL":
			return databaseURL, true
		case "MODEL_CONFIG_ENCRYPTION_KEY_FILE":
			return "/missing/model-config.key", true
		default:
			return "provider-secret", true
		}
	})
	if !errors.Is(err, errLocalCheckNotReady) {
		t.Fatalf("error = %v, want errLocalCheckNotReady", err)
	}
	var output checkOutput
	if decodeErr := json.Unmarshal(stdout.Bytes(), &output); decodeErr != nil {
		t.Fatalf("decode output: %v", decodeErr)
	}
	if len(output.Checks) != 1 || output.Checks[0].State != modelconfig.LocalConfigCheckUnknown {
		t.Fatalf("checks = %#v", output.Checks)
	}
	if strings.Contains(stdout.String(), databaseURL) || strings.Contains(stdout.String(), "provider-secret") {
		t.Fatalf("output contains sensitive store detail: %q", stdout.String())
	}
}

func TestRunCheckReportsUnknownWhenDatabaseCannotBeReached(t *testing.T) {
	keyPath := filepath.Join(t.TempDir(), "model-config.key")
	key := base64.StdEncoding.EncodeToString([]byte("01234567890123456789012345678901")) + "\n"
	if err := os.WriteFile(keyPath, []byte(key), 0o600); err != nil {
		t.Fatal(err)
	}
	var stdout bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	err := run(ctx, []string{"check", "--name", string(modelconfig.ConfigPrimaryAgent)}, &stdout, nil, func(key string) (string, bool) {
		if key == "MODEL_CONFIG_DATABASE_URL" {
			return "postgres://model_config:secret@127.0.0.1:1/model_config", true
		}
		if key == "MODEL_CONFIG_ENCRYPTION_KEY_FILE" {
			return keyPath, true
		}
		return "", false
	})
	if !errors.Is(err, errLocalCheckNotReady) {
		t.Fatalf("error = %v, want errLocalCheckNotReady", err)
	}
	var output checkOutput
	if decodeErr := json.Unmarshal(stdout.Bytes(), &output); decodeErr != nil {
		t.Fatalf("decode output: %v", decodeErr)
	}
	if len(output.Checks) != 1 || output.Checks[0].State != modelconfig.LocalConfigCheckUnknown {
		t.Fatalf("checks = %#v", output.Checks)
	}
}
