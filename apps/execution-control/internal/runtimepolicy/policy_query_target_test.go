package runtimepolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolRegistryKeepsUnregisteredToolsOutOfModelVisibleSet(t *testing.T) {
	if _, ok := ModelVisibleToolByName("retrieval.query"); ok {
		t.Fatal("retrieval.query must not be model-visible")
	}
	registry, err := LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load tool registry: %v", err)
	}
	if _, ok := registry.ToolByName("retrieval.query"); ok {
		t.Fatal("retrieval.query must not be registered as a tool")
	}
}

func TestQueryServingTargetsExposePublishedTargets(t *testing.T) {
	targets, err := QueryServingTargets("")
	if err != nil {
		t.Fatalf("query serving targets: %v", err)
	}
	got := map[string]QueryTarget{}
	for _, target := range targets {
		got[target.Target] = target
	}
	for _, targetID := range []string{"curriculum", "student_rules", "institutional_rules"} {
		if got[targetID].Target == "" || got[targetID].Description == "" {
			t.Fatalf("query target %s missing: %#v", targetID, got)
		}
	}
	curriculum, err := ResolveQueryTarget("curriculum", "")
	if err != nil {
		t.Fatalf("resolve curriculum target: %v", err)
	}
	if curriculum.ServingConfigPath != "curriculum/curriculum_plan/serving-config.json" ||
		curriculum.Collection != "curriculum_plan" || curriculum.RetrievalTopK != 8 {
		t.Fatalf("curriculum target = %#v", curriculum)
	}
}

func TestQueryServingTargetsRejectClosedTargets(t *testing.T) {
	for _, target := range []string{"official_web", "campus_services"} {
		if _, err := ResolveQueryTarget(target, ""); err == nil {
			t.Fatalf("target %s must remain closed", target)
		}
	}
}

func TestQueryServingTargetsFailWhenDefaultRegistryIsMissing(t *testing.T) {
	originalWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(originalWorkingDir); err != nil {
			t.Fatalf("restore working dir: %v", err)
		}
	})
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}
	if _, err := QueryServingTargets(""); err == nil {
		t.Fatal("expected missing query-serving target registry to fail")
	}
}

func TestQueryServingTargetsRejectInvalidSchemaVersion(t *testing.T) {
	path := writeTargetRegistry(t, `{
		"schema_version":"unsupported-query-serving-targets",
			"targets":[{
				"target":"student_rules",
				"collection":"student_rules",
				"description":"学生规则",
			"serving_config_path":"regulations/student_rules/serving-config.json",
			"retrieval_top_k":8
		}]
	}`)
	_, err := QueryServingTargets(path)
	if err == nil || !strings.Contains(err.Error(), "schema_version") {
		t.Fatalf("error = %v, want schema_version failure", err)
	}
}

func TestQueryServingTargetsRejectDuplicateTargets(t *testing.T) {
	path := writeTargetRegistry(t, `{
		"schema_version":"query-serving-targets-v1",
		"targets":[
				{"target":"student_rules","collection":"student_rules","description":"A","serving_config_path":"regulations/student_rules/serving-config.json","retrieval_top_k":8},
				{"target":"student_rules","collection":"institutional_rules","description":"B","serving_config_path":"regulations/institutional_rules/serving-config.json","retrieval_top_k":8}
		]
	}`)
	_, err := QueryServingTargets(path)
	if err == nil || !strings.Contains(err.Error(), "duplicates target") {
		t.Fatalf("error = %v, want duplicate target failure", err)
	}
}

func TestQueryServingTargetsRejectInvalidServingConfigPath(t *testing.T) {
	path := writeTargetRegistry(t, `{
		"schema_version":"query-serving-targets-v1",
			"targets":[{
				"target":"student_rules",
				"collection":"student_rules",
				"description":"学生规则",
			"serving_config_path":"../student_rules/serving-config.json",
			"retrieval_top_k":8
		}]
	}`)
	_, err := QueryServingTargets(path)
	if err == nil || !strings.Contains(err.Error(), "serving_config_path") {
		t.Fatalf("error = %v, want serving_config_path failure", err)
	}
}

func writeTargetRegistry(t *testing.T, value string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "query-serving-targets.v1.json")
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatalf("write target registry: %v", err)
	}
	return path
}
