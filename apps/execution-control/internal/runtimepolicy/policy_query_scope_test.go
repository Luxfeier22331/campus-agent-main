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

func TestKnowledgeScopeRegistryAdmitsPublishedScopes(t *testing.T) {
	tests := []struct {
		name    string
		scope   string
		mode    string
		allowed bool
		reason  string
	}{
		{name: "student rules", scope: "student_rules", mode: "current", allowed: true},
		{name: "institutional rules", scope: "institutional_rules", mode: "historical", allowed: true},
		{name: "curriculum", scope: "curriculum", mode: "compare", allowed: true},
		{name: "official web closed", scope: "official_web", mode: "current", reason: "scope_not_admitted"},
		{name: "campus services closed", scope: "campus_services", mode: "current", reason: "scope_not_admitted"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			admission, err := AdmitKnowledgeScope(KnowledgeScopeAdmissionRequest{
				Scope:     test.scope,
				QueryMode: test.mode,
			}, "")
			if err != nil {
				t.Fatalf("admit knowledge scope: %v", err)
			}
			if admission.Allowed != test.allowed {
				t.Fatalf("allowed = %v, want %v; reason=%s", admission.Allowed, test.allowed, admission.Reason)
			}
			if test.reason != "" && admission.Reason != test.reason {
				t.Fatalf("reason = %q, want %q", admission.Reason, test.reason)
			}
		})
	}
}

func TestKnowledgeScopeRegistryExposesModelAndInternalScopes(t *testing.T) {
	policies, err := AllowedKnowledgeScopes("")
	if err != nil {
		t.Fatalf("allowed knowledge scopes: %v", err)
	}
	got := map[string]KnowledgeScopePolicy{}
	for _, policy := range policies {
		got[policy.Scope] = policy
	}
	for _, scopeID := range []string{"curriculum", "student_rules", "institutional_rules"} {
		if got[scopeID].Scope == "" || got[scopeID].Description == "" {
			t.Fatalf("model-facing scope %s missing: %#v", scopeID, got)
		}
	}
	curriculum, err := ResolveKnowledgeScope("curriculum", "")
	if err != nil {
		t.Fatalf("resolve curriculum scope: %v", err)
	}
	if curriculum.Corpus != "curriculum" || curriculum.Collection != "curriculum_plan" {
		t.Fatalf("curriculum resolved to %#v, want curriculum/curriculum_plan", curriculum)
	}
	internal, err := InternalScopesForAllowedKnowledgeScopes("")
	if err != nil {
		t.Fatalf("internal scopes: %v", err)
	}
	if len(internal) != 3 {
		t.Fatalf("internal scopes = %#v, want three published scopes", internal)
	}
}

func TestKnowledgeScopeRegistryRejectsUnpublishedVersionMode(t *testing.T) {
	path := writeScopeRegistry(t, `{
		"schema_version":"query-serving-scopes-v3",
		"scopes":[{
			"scope":"student_rules",
			"description":"学生规则",
			"corpus":"regulations",
			"collection":"student_rules",
			"allowed_version_modes":["current"]
		}]
	}`)
	admission, err := AdmitKnowledgeScope(KnowledgeScopeAdmissionRequest{
		Scope:     "student_rules",
		QueryMode: "historical",
	}, path)
	if err != nil {
		t.Fatalf("admit knowledge scope: %v", err)
	}
	if admission.Allowed || admission.Reason != "version_mode_not_admitted" {
		t.Fatalf("admission = %#v, want version_mode_not_admitted", admission)
	}
}

func TestKnowledgeScopeRegistryFailsClosedWhenDefaultRegistryIsMissing(t *testing.T) {
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
	if _, err := AllowedKnowledgeScopes(""); err == nil {
		t.Fatal("expected missing query-serving scope registry to fail")
	}
}

func TestKnowledgeScopeRegistryRejectsInvalidSchemaVersion(t *testing.T) {
	path := writeScopeRegistry(t, `{
		"schema_version":"unsupported-query-serving-scopes",
		"scopes":[{
			"scope":"student_rules",
			"description":"学生规则",
			"corpus":"regulations",
			"collection":"student_rules",
			"allowed_version_modes":["current"]
		}]
	}`)
	_, err := AllowedKnowledgeScopes(path)
	if err == nil || !strings.Contains(err.Error(), "schema_version") {
		t.Fatalf("error = %v, want schema_version failure", err)
	}
}

func TestKnowledgeScopeRegistryRejectsDuplicateMappings(t *testing.T) {
	path := writeScopeRegistry(t, `{
		"schema_version":"query-serving-scopes-v3",
		"scopes":[
			{"scope":"student_rules","description":"A","corpus":"regulations","collection":"student_rules","allowed_version_modes":["current"]},
			{"scope":"student_rules","description":"B","corpus":"regulations","collection":"institutional_rules","allowed_version_modes":["current"]}
		]
	}`)
	_, err := AllowedKnowledgeScopes(path)
	if err == nil || !strings.Contains(err.Error(), "duplicates scope") {
		t.Fatalf("error = %v, want duplicate scope failure", err)
	}
}

func writeScopeRegistry(t *testing.T, value string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "query-serving-scopes.v3.json")
	if err := os.WriteFile(path, []byte(value), 0o600); err != nil {
		t.Fatalf("write scope registry: %v", err)
	}
	return path
}
