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
			configs, _, missing, err := localSeedConfigs([]modelconfig.ConfigName{test.name}, func(key string) (string, bool) {
				value, ok := test.environment[key]
				return value, ok
			})
			if err != nil || len(missing) != 0 {
				t.Fatalf("missing = %v, err = %v", missing, err)
			}
			if !reflect.DeepEqual(configs, []modelconfig.LocalSeedConfig{test.want}) {
				t.Fatalf("configs = %#v, want %#v", configs, []modelconfig.LocalSeedConfig{test.want})
			}
		})
	}
}

func TestLocalSeedConfigsSeedsNoticeClassificationBackendsAndSelection(t *testing.T) {
	decision := modelconfig.LocalSeedConfig{
		APIKey: "decision-key", Name: modelconfig.ConfigNoticeClassificationDecision, Provider: "nace",
		APIProtocol: "typesafe.systemone", BaseURL: "https://decision.example/v1", Model: "drex-max",
	}
	jev := decision
	jev.Provider, jev.Model = "typesafe", "jev-latest"
	llm := modelconfig.LocalSeedConfig{
		APIKey: "llm-key", Name: modelconfig.ConfigNoticeClassificationLLM, Provider: "openai-compatible",
		APIProtocol: "openai.chat_completions", BaseURL: "https://llm.example/v1", Model: "llm-model",
	}
	decisionEnvironment := map[string]string{
		"NOTICE_CLASSIFICATION_DECISION_API_KEY":  "decision-key",
		"NOTICE_CLASSIFICATION_DECISION_BASE_URL": "https://decision.example/v1",
	}
	llmEnvironment := map[string]string{
		"NOTICE_CLASSIFICATION_LLM_API_KEY":  "llm-key",
		"NOTICE_CLASSIFICATION_LLM_BASE_URL": "https://llm.example/v1",
		"NOTICE_CLASSIFICATION_LLM_MODEL":    "llm-model",
	}
	merge := func(values ...map[string]string) map[string]string {
		result := map[string]string{}
		for _, value := range values {
			for key, item := range value {
				result[key] = item
			}
		}
		return result
	}
	tests := []struct {
		name        string
		environment map[string]string
		wantConfigs []modelconfig.LocalSeedConfig
		wantBackend modelconfig.ConfigName
		wantMissing []string
		wantErr     string
	}{
		{name: "decision only", environment: decisionEnvironment, wantConfigs: []modelconfig.LocalSeedConfig{decision}, wantBackend: modelconfig.ConfigNoticeClassificationDecision},
		{
			name: "decision provider and model override",
			environment: merge(decisionEnvironment, map[string]string{
				"NOTICE_CLASSIFICATION_DECISION_PROVIDER": "typesafe",
				"NOTICE_CLASSIFICATION_DECISION_MODEL":    "jev-latest",
			}),
			wantConfigs: []modelconfig.LocalSeedConfig{jev},
			wantBackend: modelconfig.ConfigNoticeClassificationDecision,
		},
		{name: "llm only", environment: llmEnvironment, wantConfigs: []modelconfig.LocalSeedConfig{llm}, wantBackend: modelconfig.ConfigNoticeClassificationLLM},
		{name: "both default to decision", environment: merge(decisionEnvironment, llmEnvironment), wantConfigs: []modelconfig.LocalSeedConfig{decision, llm}, wantBackend: modelconfig.ConfigNoticeClassificationDecision},
		{
			name:        "explicit llm",
			environment: merge(decisionEnvironment, llmEnvironment, map[string]string{"NOTICE_CLASSIFICATION_BACKEND": "llm"}),
			wantConfigs: []modelconfig.LocalSeedConfig{decision, llm},
			wantBackend: modelconfig.ConfigNoticeClassificationLLM,
		},
		{
			name:        "selected backend incomplete",
			environment: merge(decisionEnvironment, map[string]string{"NOTICE_CLASSIFICATION_BACKEND": "llm"}),
			wantMissing: []string{"NOTICE_CLASSIFICATION_LLM_API_KEY", "NOTICE_CLASSIFICATION_LLM_BASE_URL", "NOTICE_CLASSIFICATION_LLM_MODEL"},
		},
		{
			name:        "unknown backend",
			environment: merge(decisionEnvironment, map[string]string{"NOTICE_CLASSIFICATION_BACKEND": "both"}),
			wantErr:     "must be decision or llm",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configs, selections, missing, err := localSeedConfigs([]modelconfig.ConfigName{modelconfig.ConfigNoticeClassification}, func(key string) (string, bool) {
				value, ok := test.environment[key]
				return value, ok
			})
			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("error = %v, want %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if test.wantMissing != nil {
				if !reflect.DeepEqual(missing, test.wantMissing) {
					t.Fatalf("missing = %v, want %v", missing, test.wantMissing)
				}
				return
			}
			if len(missing) != 0 || !reflect.DeepEqual(configs, test.wantConfigs) {
				t.Fatalf("configs = %#v missing = %v", configs, missing)
			}
			want := []modelconfig.LocalSeedSelection{{Alias: modelconfig.ConfigNoticeClassification, ConfigName: test.wantBackend}}
			if !reflect.DeepEqual(selections, want) {
				t.Fatalf("selections = %#v, want %#v", selections, want)
			}
		})
	}
}

func TestLocalSeedConfigsReportsSortedMissingVariables(t *testing.T) {
	_, _, missing, err := localSeedConfigs([]modelconfig.ConfigName{modelconfig.ConfigNoticeClassification}, func(string) (string, bool) {
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{
		"NOTICE_CLASSIFICATION_DECISION_API_KEY",
		"NOTICE_CLASSIFICATION_DECISION_BASE_URL",
		"NOTICE_CLASSIFICATION_LLM_API_KEY",
		"NOTICE_CLASSIFICATION_LLM_BASE_URL",
		"NOTICE_CLASSIFICATION_LLM_MODEL",
	}; !reflect.DeepEqual(missing, want) {
		t.Fatalf("missing = %v, want %v", missing, want)
	}
}

func TestLocalSeedConfigsDoesNotModifyNames(t *testing.T) {
	names := []modelconfig.ConfigName{modelconfig.ConfigPrimaryAgent, modelconfig.ConfigCampusDocsEmbedding}
	want := append([]modelconfig.ConfigName(nil), names...)
	if _, _, _, err := localSeedConfigs(names, func(key string) (string, bool) {
		return map[string]string{
			"LLM_API_KEY":        "key",
			"LLM_BASE_URL":       "https://provider.example/v1",
			"LLM_MODEL":          "model",
			"EMBEDDING_API_KEY":  "embedding-key",
			"EMBEDDING_BASE_URL": "https://embedding.example/v1",
		}[key], true
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(names, want) {
		t.Fatalf("names changed from %v to %v", want, names)
	}
}

func TestMissingSeedNamesSelectsOnlyMissingConfigs(t *testing.T) {
	names, err := missingSeedNames([]modelconfig.LocalConfigCheck{
		{Name: modelconfig.ConfigPrimaryAgent, State: modelconfig.LocalConfigCheckReady},
		{Name: modelconfig.ConfigNoticeClassification, State: modelconfig.LocalConfigCheckMissing},
	})
	if err != nil {
		t.Fatalf("missingSeedNames() error = %v", err)
	}
	if want := []modelconfig.ConfigName{modelconfig.ConfigNoticeClassification}; !reflect.DeepEqual(names, want) {
		t.Fatalf("names = %v, want only missing config %v", names, want)
	}
}

func TestMissingSeedNamesRejectsUnknownConfigState(t *testing.T) {
	_, err := missingSeedNames([]modelconfig.LocalConfigCheck{{
		Name: modelconfig.ConfigPrimaryAgent, State: modelconfig.LocalConfigCheckUnknown,
	}})
	if err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("error = %v, want unknown state", err)
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
