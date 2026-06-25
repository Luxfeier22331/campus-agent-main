package runtimepolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAllowedToolsForCapabilityPayloadKindIsScopedToCapability(t *testing.T) {
	allowed := AllowedToolsForCapabilityPayloadKind("notice", "campus_notice_get")
	if allowed != nil {
		t.Fatalf("allowed = %#v, want nil for closed campus_notice_get", allowed)
	}
	if AllowedToolsForCapabilityPayloadKind("campus_services", "service_guide_lookup") != nil {
		t.Fatal("campus_services must not allow service_guide_lookup")
	}
	if AllowedToolsForCapabilityPayloadKind("campus_services", "contact_directory_lookup") != nil {
		t.Fatal("campus_services must not allow contact_directory_lookup")
	}
	if AllowedToolsForCapabilityPayloadKind("campus_services", "academic_calendar_lookup") != nil {
		t.Fatal("campus_services must not allow academic_calendar_lookup")
	}
	if AllowedToolsForCapabilityPayloadKind("navigation", "place_lookup") != nil {
		t.Fatal("navigation must not allow place_lookup before map rollout")
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

func TestInferKnowledgeQueryScopeSelectsUniqueAdmittedScope(t *testing.T) {
	tests := []struct {
		name           string
		queryText      string
		wantCorpus     string
		wantCollection string
	}{
		{
			name:           "student scholarship rule",
			queryText:      "中央民族大学本科学生国家奖学金评审办法",
			wantCorpus:     "regulations",
			wantCollection: "student_rules",
		},
		{
			name:           "student leave procedure",
			queryText:      "学生请假手续怎么办",
			wantCorpus:     "regulations",
			wantCollection: "student_rules",
		},
		{
			name:           "curriculum plan",
			queryText:      "汉语言文学专业大二上学期培养方案和学分要求",
			wantCorpus:     "curriculum",
			wantCollection: "curriculum_plan",
		},
		{
			name:           "official stable reference",
			queryText:      "学校官网招生办公室联系方式在哪里",
			wantCorpus:     "official_web",
			wantCollection: "stable_reference",
		},
		{
			name:           "institutional rule",
			queryText:      "学校章程和党委常委会会议制度",
			wantCorpus:     "regulations",
			wantCollection: "institutional_rules",
		},
		{
			name:           "campus network password regulation",
			queryText:      "校园网密码怎么改？",
			wantCorpus:     "regulations",
			wantCollection: "institutional_rules",
		},
		{
			name:           "unified auth password regulation",
			queryText:      "统一身份认证密码怎么改？",
			wantCorpus:     "regulations",
			wantCollection: "institutional_rules",
		},
		{
			name:           "information portal password regulation",
			queryText:      "信息门户密码怎么改？",
			wantCorpus:     "regulations",
			wantCollection: "institutional_rules",
		},
		{
			name:           "network account application regulation",
			queryText:      "上网账号申请去哪里办？",
			wantCorpus:     "regulations",
			wantCollection: "institutional_rules",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			scope, err := InferKnowledgeQueryScope(tt.queryText, "")
			if err != nil {
				t.Fatalf("infer scope: %v", err)
			}
			if scope.Corpus != tt.wantCorpus || scope.Collection != tt.wantCollection {
				t.Fatalf("scope = %#v, want %s/%s", scope, tt.wantCorpus, tt.wantCollection)
			}
		})
	}
}

func TestInferKnowledgeQueryScopeFailsClosedWhenNoUniqueScopeSignal(t *testing.T) {
	scope, err := InferKnowledgeQueryScope("这个问题怎么处理", "")
	if err == nil {
		t.Fatal("ambiguous query must fail closed")
	}
	if scope.Corpus != "" || scope.Collection != "" {
		t.Fatalf("scope = %#v, want empty scope on failure", scope)
	}
	if !strings.Contains(err.Error(), "could not select") {
		t.Fatalf("error = %v, want selection failure", err)
	}
}

func cloneSignalGroups(source map[string][]string) map[string][]string {
	cloned := make(map[string][]string, len(source))
	for key, values := range source {
		cloned[key] = append([]string(nil), values...)
	}
	return cloned
}
