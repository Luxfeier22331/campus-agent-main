package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setRuntimeConfig(t *testing.T, content string) {
	t.Helper()
	content = mergeRuntimeConfigForTest(t, content)
	profilePath := filepath.Join(t.TempDir(), "runtime-config.json")
	if err := os.WriteFile(profilePath, []byte(content), 0o600); err != nil {
		t.Fatalf("write runtime config: %v", err)
	}
	t.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", profilePath)
}

func setRawRuntimeConfig(t *testing.T, content string) {
	t.Helper()
	profilePath := filepath.Join(t.TempDir(), "runtime-config.json")
	if err := os.WriteFile(profilePath, []byte(content), 0o600); err != nil {
		t.Fatalf("write runtime config: %v", err)
	}
	t.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", profilePath)
}

func mergeRuntimeConfigForTest(t *testing.T, override string) string {
	t.Helper()
	base := map[string]any{}
	if err := json.Unmarshal(readDefaultRuntimeConfigForTest(t), &base); err != nil {
		t.Fatalf("decode base runtime config: %v", err)
	}
	overlay := map[string]any{}
	if err := json.Unmarshal([]byte(override), &overlay); err != nil {
		t.Fatalf("decode runtime config override: %v", err)
	}
	mergeJSONObjects(base, overlay)
	merged, err := json.MarshalIndent(base, "", "  ")
	if err != nil {
		t.Fatalf("encode merged runtime config: %v", err)
	}
	return string(merged)
}

func mergeJSONObjects(base map[string]any, overlay map[string]any) {
	for key, value := range overlay {
		baseChild, baseOK := base[key].(map[string]any)
		overlayChild, overlayOK := value.(map[string]any)
		if baseOK && overlayOK {
			mergeJSONObjects(baseChild, overlayChild)
			continue
		}
		base[key] = value
	}
}

func TestLoadFromEnvReadsKnowledgeSearchAndWorkerProfiles(t *testing.T) {
	setRuntimeConfig(t, `{
  "schema_version": "campus_execution_control_runtime_config.v1",
  "knowledge_search": {
    "top_k_max": 6,
    "embedding_timeout_ms": 7000,
    "qdrant_timeout_ms": 8000
  },
  "worker_profiles": {
    "activity-agent": {"activity_slots": 3, "activity_task_pollers": 2}
  }
}`)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.RAGTopKMax != 6 ||
		cfg.RAGEmbeddingTimeoutMS != 7000 ||
		cfg.RAGQdrantTimeoutMS != 8000 {
		t.Fatalf("unexpected knowledge search config: %#v", cfg)
	}
	if len(cfg.WorkerProfiles) != 3 ||
		cfg.WorkerProfiles["activity-agent"].ActivitySlots != 3 ||
		cfg.WorkerProfiles["activity-agent"].ActivityTaskPollers != 2 {
		t.Fatalf("unexpected worker profiles: %#v", cfg.WorkerProfiles)
	}
}

func TestLoadFromEnvReadsRuntimeConfig(t *testing.T) {
	setRuntimeConfig(t, `{
  "schema_version": "campus_execution_control_runtime_config.v1",
  "max_concurrent_answers": 5,
  "queue_capacity": 13,
  "queue_timeout_ms": 2600,
  "request_timeout_ms": 31000,
  "request_body_limit_bytes": 2097152,
  "shutdown_grace_ms": 21000,
  "otel": {
    "enabled": true,
    "endpoint": "http://collector:4318/v1/traces",
    "metrics_enabled": true,
    "metrics_endpoint": "http://collector:4318/v1/metrics",
    "service_name": "custom-execution-control",
    "export_timeout_ms": 800,
    "export_interval_ms": 16000,
    "sample_ratio": 0.5,
    "allowed_attributes_version": "custom-attrs-v1",
    "temporal_tracing_enabled": true
	},
  "knowledge_search": {
    "top_k_max": 7,
    "embedding_timeout_ms": 7000,
    "qdrant_timeout_ms": 8000
  },
  "personal_memory": {
    "runtime": "hindsight",
    "timeout_seconds": 7,
    "recall_limit": 4,
    "recall_max_tokens": 900,
    "context_char_budget": 900
  },
  "worker_profiles": {
    "activity-agent": {
      "activity_slots": 3,
      "activity_task_pollers": 2
    }
  }
}`)
	t.Setenv("EXECUTION_CONTROL_RUNTIME_RELEASE", "execution-control@runtime-config-test")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}

	if cfg.MaxConcurrentAnswers != 5 ||
		cfg.QueueCapacity != 13 ||
		cfg.QueueTimeoutMS != 2600 ||
		cfg.RequestTimeoutMS != 31000 ||
		cfg.RequestBodyLimitBytes != 2_097_152 ||
		cfg.ShutdownGraceMS != 21000 ||
		!cfg.OTelEnabled ||
		cfg.OTelEndpoint != "http://collector:4318/v1/traces" ||
		!cfg.OTelMetricsEnabled ||
		cfg.OTelMetricsEndpoint != "http://collector:4318/v1/metrics" ||
		cfg.OTelServiceName != "custom-execution-control" ||
		cfg.OTelExportTimeoutMS != 800 ||
		cfg.OTelExportIntervalMS != 16000 ||
		cfg.OTelSampleRatio != 0.5 ||
		cfg.OTelAllowedAttributesVersion != "custom-attrs-v1" ||
		!cfg.TemporalTracingEnabled ||
		cfg.RAGTopKMax != 7 ||
		cfg.RAGEmbeddingTimeoutMS != 7000 ||
		cfg.RAGQdrantTimeoutMS != 8000 ||
		cfg.PersonalMemoryRuntime != "hindsight" ||
		cfg.PersonalMemoryTimeoutSeconds != 7 ||
		cfg.PersonalMemoryRecallLimit != 4 ||
		cfg.PersonalMemoryRecallMaxTokens != 900 ||
		cfg.PersonalMemoryContextCharBudget != 900 ||
		cfg.WorkerProfiles["activity-agent"].ActivitySlots != 3 {
		t.Fatalf("unexpected config from runtime config: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsRuntimeModeOwnedPersonalMemoryEnv(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"PERSONAL_MEMORY_RUNTIME", "zep_ce"},
		{"PERSONAL_MEMORY_TIMEOUT_SECONDS", "10"},
		{"PERSONAL_MEMORY_RECALL_LIMIT", "8"},
		{"PERSONAL_MEMORY_RECALL_MAX_CHARS", "2500"},
		{"PERSONAL_MEMORY_RECALL_MAX_TOKENS", "2500"},
		{"PERSONAL_MEMORY_CONTEXT_CHAR_BUDGET", "2500"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatal("expected runtime config owned personal memory env override to fail")
			}
			if !strings.Contains(err.Error(), tc.name+" is retired") {
				t.Fatalf("error = %q, want retired runtime config env diagnostic", err.Error())
			}
		})
	}
}

func TestLoadFromEnvRequiresRuntimeConfigPath(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", " ")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected missing runtime config path to fail")
	}
	if !strings.Contains(err.Error(), "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH is required") {
		t.Fatalf("error = %q, want runtime config path diagnostic", err.Error())
	}
}

func TestLoadFromEnvRejectsIncompleteRuntimeConfig(t *testing.T) {
	setRawRuntimeConfig(t, `{
  "schema_version": "campus_execution_control_runtime_config.v1",
  "queue_capacity": 24
}`)

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected incomplete runtime config to fail")
	}
	if !strings.Contains(err.Error(), "missing required field max_concurrent_answers") {
		t.Fatalf("error = %q, want missing config field diagnostic", err.Error())
	}
}
