package runtimepolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAllowedToolsForPayloadKindIsScopedToTarget(t *testing.T) {
	allowed := AllowedToolsForPayloadKind("notice-agent", "campus_notice_get")
	if allowed != nil {
		t.Fatalf("allowed = %#v, want nil for closed campus_notice_get", allowed)
	}
	if AllowedToolsForPayloadKind("notice-agent", "service_status_lookup") != nil {
		t.Fatal("notice-agent must not allow service_status_lookup")
	}
	serviceGuideAllowed := AllowedToolsForPayloadKind("campus-services-agent", "service_guide_lookup")
	if len(serviceGuideAllowed) != 1 || serviceGuideAllowed[0] != "service_guide_lookup" {
		t.Fatalf("service guide allowed = %#v, want service_guide_lookup", serviceGuideAllowed)
	}
	contactAllowed := AllowedToolsForPayloadKind("campus-services-agent", "contact_directory_lookup")
	if len(contactAllowed) != 1 || contactAllowed[0] != "contact_directory_lookup" {
		t.Fatalf("contact allowed = %#v, want contact_directory_lookup", contactAllowed)
	}
	if AllowedToolsForPayloadKind("navigation-agent", "place_lookup") != nil {
		t.Fatal("navigation-agent must not allow place_lookup before map rollout")
	}
}

func TestQueryServingScopePolicyMatchesDefaultRuntimeProfile(t *testing.T) {
	tests := []struct {
		name       string
		corpus     string
		collection string
		want       bool
	}{
		{
			name:       "student rules allowed",
			corpus:     "regulations",
			collection: "student_rules",
			want:       true,
		},
		{
			name:       "institutional rules allowed after serving admission",
			corpus:     "regulations",
			collection: "institutional_rules",
			want:       true,
		},
		{
			name:       "scoped rules rejected by default",
			corpus:     "regulations",
			collection: "scoped_rules",
			want:       false,
		},
		{
			name:       "curriculum plan allowed",
			corpus:     "curriculum",
			collection: "curriculum_plan",
			want:       true,
		},
		{
			name:       "official web stable reference allowed",
			corpus:     "official_web",
			collection: "stable_reference",
			want:       true,
		},
		{
			name:       "official web fresh news rejected",
			corpus:     "official_web",
			collection: "fresh_news",
			want:       false,
		},
		{
			name:       "official web news archive rejected",
			corpus:     "official_web",
			collection: "news_archive",
			want:       false,
		},
		{
			name:       "campus service catalog rejected",
			corpus:     "campus_services",
			collection: "service_catalog",
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			allowed, err := QueryScopeAllowed(tt.corpus, tt.collection, "")
			if err != nil {
				t.Fatalf("query scope allowed: %v", err)
			}
			if allowed != tt.want {
				t.Fatalf("allowed = %v, want %v", allowed, tt.want)
			}
		})
	}
}

func TestQueryServingScopePolicyFailsClosedWhenDefaultPolicyIsMissing(t *testing.T) {
	originalWorkingDir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	t.Cleanup(func() {
		if chdirErr := os.Chdir(originalWorkingDir); chdirErr != nil {
			t.Fatalf("restore working dir: %v", chdirErr)
		}
	})
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatalf("chdir temp dir: %v", err)
	}

	allowed, err := QueryScopeAllowed("regulations", "student_rules", "")
	if err == nil {
		t.Fatal("expected missing query-serving scope policy to fail")
	}
	if allowed {
		t.Fatal("scope must not be allowed when policy file is missing")
	}
}

func TestQueryServingScopePolicyReadsExplicitPolicyFile(t *testing.T) {
	policyPath := filepath.Join(t.TempDir(), "query-serving-scopes.v1.json")
	if err := os.WriteFile(
		policyPath,
		[]byte(`{"policy_version":"query-serving-scopes-v1","scopes":[{"corpus":"regulations","collection":"student_rules"}]}`),
		0o600,
	); err != nil {
		t.Fatalf("write policy fixture: %v", err)
	}

	allowed, err := QueryScopeAllowed("regulations", "student_rules", policyPath)
	if err != nil {
		t.Fatalf("query scope allowed: %v", err)
	}
	if !allowed {
		t.Fatal("expected explicit policy scope to be allowed")
	}
}

func TestQueryServingScopePolicyRejectsMissingPolicyVersion(t *testing.T) {
	policyPath := filepath.Join(t.TempDir(), "query-serving-scopes.v1.json")
	if err := os.WriteFile(
		policyPath,
		[]byte(`{"scopes":[{"corpus":"regulations","collection":"student_rules"}]}`),
		0o600,
	); err != nil {
		t.Fatalf("write policy fixture: %v", err)
	}

	allowed, err := QueryScopeAllowed("regulations", "student_rules", policyPath)
	if err == nil {
		t.Fatal("expected missing policy_version to fail")
	}
	if allowed {
		t.Fatal("scope must not be allowed when policy_version is missing")
	}
	if !strings.Contains(err.Error(), "policy_version") {
		t.Fatalf("error = %v, want policy_version failure", err)
	}
}

func TestQueryServingScopePolicyRejectsMismatchedPolicyVersion(t *testing.T) {
	policyPath := filepath.Join(t.TempDir(), "query-serving-scopes.v1.json")
	if err := os.WriteFile(
		policyPath,
		[]byte(`{"policy_version":"query-serving-scopes-v999","scopes":[{"corpus":"regulations","collection":"student_rules"}]}`),
		0o600,
	); err != nil {
		t.Fatalf("write policy fixture: %v", err)
	}

	allowed, err := QueryScopeAllowed("regulations", "student_rules", policyPath)
	if err == nil {
		t.Fatal("expected mismatched policy_version to fail")
	}
	if allowed {
		t.Fatal("scope must not be allowed when policy_version mismatches")
	}
	if !strings.Contains(err.Error(), "policy_version") {
		t.Fatalf("error = %v, want policy_version failure", err)
	}
}

func cloneSignalGroups(source map[string][]string) map[string][]string {
	cloned := make(map[string][]string, len(source))
	for key, values := range source {
		cloned[key] = append([]string(nil), values...)
	}
	return cloned
}
