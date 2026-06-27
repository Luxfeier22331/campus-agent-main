package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func setRuntimeConfigProfile(t *testing.T, content string) {
	t.Helper()
	content = mergeRuntimeConfigProfileForTest(t, content)
	profilePath := filepath.Join(t.TempDir(), "runtime-profile.json")
	if err := os.WriteFile(profilePath, []byte(content), 0o600); err != nil {
		t.Fatalf("write runtime profile: %v", err)
	}
	t.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", profilePath)
}

func setRawRuntimeConfigProfile(t *testing.T, content string) {
	t.Helper()
	profilePath := filepath.Join(t.TempDir(), "runtime-profile.json")
	if err := os.WriteFile(profilePath, []byte(content), 0o600); err != nil {
		t.Fatalf("write runtime profile: %v", err)
	}
	t.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", profilePath)
}

func mergeRuntimeConfigProfileForTest(t *testing.T, override string) string {
	t.Helper()
	base := map[string]any{}
	if err := json.Unmarshal(readDefaultRuntimeConfigProfileForTest(t), &base); err != nil {
		t.Fatalf("decode base runtime profile: %v", err)
	}
	overlay := map[string]any{}
	if err := json.Unmarshal([]byte(override), &overlay); err != nil {
		t.Fatalf("decode runtime profile override: %v", err)
	}
	mergeJSONObjects(base, overlay)
	merged, err := json.MarshalIndent(base, "", "  ")
	if err != nil {
		t.Fatalf("encode merged runtime profile: %v", err)
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

func TestLoadFromEnvReadsRAGBudgetsAndWorkerProfiles(t *testing.T) {
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "rag": {
    "top_k_max": 6,
    "selected_evidence_max": 5,
    "retrieval_max_concurrent": 3,
    "synthesis_max_concurrent": 1,
    "embedding_timeout_ms": 7000,
    "qdrant_timeout_ms": 8000,
    "provider_timeout_ms": 45000,
    "synthesis_generation": {
      "max_output_tokens": 720,
      "reasoning_effort": "minimal",
      "store_provider_output": false,
      "text_verbosity": "low"
    }
  },
  "worker_profiles": {
    "activity-knowledge": {"activity_slots": 3, "activity_task_pollers": 2}
  }
}`)

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv returned error: %v", err)
	}
	if cfg.RAGTopKMax != 6 ||
		cfg.RAGSelectedEvidenceMax != 5 ||
		cfg.RAGRetrievalMaxConcurrent != 3 ||
		cfg.RAGSynthesisMaxConcurrent != 1 ||
		cfg.RAGEmbeddingTimeoutMS != 7000 ||
		cfg.RAGQdrantTimeoutMS != 8000 ||
		cfg.RAGProviderTimeoutMS != 45000 ||
		cfg.RAGSynthesisMaxOutputTokens != 720 ||
		cfg.RAGSynthesisReasoningEffort != "minimal" ||
		cfg.RAGSynthesisStoreProviderOutput ||
		cfg.RAGSynthesisTextVerbosity != "low" {
		t.Fatalf("unexpected rag budgets: %#v", cfg)
	}
	if cfg.WorkerProfiles["activity-knowledge"].ActivitySlots != 3 ||
		cfg.WorkerProfiles["activity-knowledge"].ActivityTaskPollers != 2 {
		t.Fatalf("unexpected worker profiles: %#v", cfg.WorkerProfiles)
	}
}

func TestLoadFromEnvReadsRuntimeConfigProfile(t *testing.T) {
	setRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "max_concurrent_answers": 5,
  "queue_capacity": 13,
  "queue_timeout_ms": 2600,
  "request_timeout_ms": 31000,
  "request_body_limit_bytes": 2097152,
  "shutdown_grace_ms": 21000,
  "intent_policy_path": "/etc/campus-agent/intent-policy.v1.json",
  "open_tools": ["transport_schedule_lookup", "campus_notice_discover"],
  "multi_step_workflow_enabled": true,
  "otel": {
    "enabled": true,
    "endpoint": "http://collector:4318/v1/traces",
    "metrics_enabled": true,
    "metrics_endpoint": "http://collector:4318/v1/metrics",
    "headers": "authorization=Bearer test",
    "service_name": "custom-execution-control",
    "export_timeout_ms": 800,
    "export_interval_ms": 16000,
    "sample_ratio": 0.5,
    "allowed_attributes_version": "custom-attrs-v1",
    "temporal_tracing_enabled": true
  },
  "execution_audit": {
    "enabled": true,
    "url": "http://app-api:27031/api/internal/execution/audit-events",
    "shared_secret": "audit-secret",
    "timeout_ms": 300
  },
  "rag": {
    "top_k_max": 7,
    "selected_evidence_max": 6,
    "retrieval_max_concurrent": 3,
    "synthesis_max_concurrent": 1,
    "embedding_timeout_ms": 7000,
    "qdrant_timeout_ms": 8000,
    "provider_timeout_ms": 45000,
    "synthesis_generation": {
      "max_output_tokens": 960,
      "reasoning_effort": "low",
      "store_provider_output": false,
      "text_verbosity": "medium"
    }
  },
  "personal_memory": {
    "runtime": "hindsight",
    "timeout_seconds": 7,
    "recall_limit": 4,
    "recall_max_chars": 900
  },
  "worker_profiles": {
    "activity-knowledge": {
      "activity_slots": 3,
      "activity_task_pollers": 2
    }
  }
}`)
	t.Setenv("EXECUTION_CONTROL_RUNTIME_RELEASE", "execution-control@runtime-profile-test")

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
		cfg.IntentPolicyPath != "/etc/campus-agent/intent-policy.v1.json" ||
		len(cfg.OpenTools) != 2 ||
		cfg.OpenTools[0] != "transport_schedule_lookup" ||
		cfg.OpenTools[1] != "campus_notice_discover" ||
		!cfg.MultiStepWorkflowEnabled ||
		!cfg.OTelEnabled ||
		cfg.OTelEndpoint != "http://collector:4318/v1/traces" ||
		!cfg.OTelMetricsEnabled ||
		cfg.OTelMetricsEndpoint != "http://collector:4318/v1/metrics" ||
		cfg.OTelHeaders != "authorization=Bearer test" ||
		cfg.OTelServiceName != "custom-execution-control" ||
		cfg.OTelExportTimeoutMS != 800 ||
		cfg.OTelExportIntervalMS != 16000 ||
		cfg.OTelSampleRatio != 0.5 ||
		cfg.OTelAllowedAttributesVersion != "custom-attrs-v1" ||
		!cfg.TemporalTracingEnabled ||
		!cfg.ExecutionAuditEnabled ||
		cfg.ExecutionAuditURL != "http://app-api:27031/api/internal/execution/audit-events" ||
		cfg.ExecutionAuditSharedSecret != "audit-secret" ||
		cfg.ExecutionAuditTimeoutMS != 300 ||
		cfg.RAGTopKMax != 7 ||
		cfg.RAGSelectedEvidenceMax != 6 ||
		cfg.RAGRetrievalMaxConcurrent != 3 ||
		cfg.RAGSynthesisMaxConcurrent != 1 ||
		cfg.RAGEmbeddingTimeoutMS != 7000 ||
		cfg.RAGQdrantTimeoutMS != 8000 ||
		cfg.RAGProviderTimeoutMS != 45000 ||
		cfg.RAGSynthesisMaxOutputTokens != 960 ||
		cfg.RAGSynthesisReasoningEffort != "low" ||
		cfg.RAGSynthesisStoreProviderOutput ||
		cfg.RAGSynthesisTextVerbosity != "medium" ||
		cfg.PersonalMemoryRuntime != "hindsight" ||
		cfg.PersonalMemoryTimeoutSeconds != 7 ||
		cfg.PersonalMemoryRecallLimit != 4 ||
		cfg.PersonalMemoryRecallMaxChars != 900 ||
		cfg.WorkerProfiles["activity-knowledge"].ActivitySlots != 3 {
		t.Fatalf("unexpected config from runtime profile: %#v", cfg)
	}
}

func TestLoadFromEnvRejectsRuntimeProfileOwnedEnvOverrides(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RAG_TOP_K_MAX", "6")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected runtime profile owned env override to fail")
	}
	if !strings.Contains(err.Error(), "EXECUTION_CONTROL_RAG_TOP_K_MAX is retired") {
		t.Fatalf("error = %q, want retired runtime profile env diagnostic", err.Error())
	}
}

func TestLoadFromEnvRejectsRuntimeProfileOwnedPersonalMemoryEnv(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value string
	}{
		{"PERSONAL_MEMORY_RUNTIME", "zep_ce"},
		{"PERSONAL_MEMORY_TIMEOUT_SECONDS", "10"},
		{"PERSONAL_MEMORY_RECALL_LIMIT", "8"},
		{"PERSONAL_MEMORY_RECALL_MAX_CHARS", "2500"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv(tc.name, tc.value)

			_, err := LoadFromEnv()
			if err == nil {
				t.Fatal("expected runtime profile owned personal memory env override to fail")
			}
			if !strings.Contains(err.Error(), tc.name+" is retired") {
				t.Fatalf("error = %q, want retired runtime profile env diagnostic", err.Error())
			}
		})
	}
}

func TestLoadFromEnvRequiresRuntimeConfigProfilePath(t *testing.T) {
	t.Setenv("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", " ")

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected missing runtime config path to fail")
	}
	if !strings.Contains(err.Error(), "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH is required") {
		t.Fatalf("error = %q, want runtime config path diagnostic", err.Error())
	}
}

func TestLoadFromEnvRejectsIncompleteRuntimeConfigProfile(t *testing.T) {
	setRawRuntimeConfigProfile(t, `{
  "schema_version": "campus_execution_control_runtime_profile.v1",
  "queue_capacity": 24
}`)

	_, err := LoadFromEnv()
	if err == nil {
		t.Fatal("expected incomplete runtime profile to fail")
	}
	if !strings.Contains(err.Error(), "missing required field max_concurrent_answers") {
		t.Fatalf("error = %q, want missing profile field diagnostic", err.Error())
	}
}
