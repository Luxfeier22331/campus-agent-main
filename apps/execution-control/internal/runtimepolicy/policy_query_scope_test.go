package runtimepolicy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestToolRegistryKeepsInternalAndClosedToolsOutOfModelVisibleSet(t *testing.T) {
	if _, ok := ModelVisibleToolByName("campus_notice_get"); ok {
		t.Fatal("campus_notice_get must not be model-visible")
	}
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
	if _, ok := ModelVisibleToolByName("place_lookup"); ok {
		t.Fatal("place_lookup must not be model-visible before map rollout")
	}
}

func TestQueryServingScopePolicyMatchesDefaultServingConfig(t *testing.T) {
	tests := []struct {
		name      string
		request   QueryScopeAdmissionRequest
		want      bool
		wantClass string
	}{
		{
			name: "student rules default open",
			request: QueryScopeAdmissionRequest{
				Corpus:     "regulations",
				Collection: "student_rules",
				QueryMode:  "current",
			},
			want:      true,
			wantClass: "default_open",
		},
		{
			name: "institutional rules default open",
			request: QueryScopeAdmissionRequest{
				Corpus:     "regulations",
				Collection: "institutional_rules",
				QueryMode:  "current",
			},
			want:      true,
			wantClass: "default_open",
		},
		{
			name: "scoped rules not admitted",
			request: QueryScopeAdmissionRequest{
				Corpus:     "regulations",
				Collection: "scoped_rules",
				QueryMode:  "current",
			},
			want: false,
		},
		{
			name: "curriculum plan default open",
			request: QueryScopeAdmissionRequest{
				Corpus:     "curriculum",
				Collection: "curriculum_plan",
				QueryMode:  "current",
			},
			want:      true,
			wantClass: "default_open",
		},
		{
			name: "official web stable reference default open",
			request: QueryScopeAdmissionRequest{
				Corpus:     "official_web",
				Collection: "stable_reference",
				QueryMode:  "current",
			},
			want:      true,
			wantClass: "default_open",
		},
		{
			name: "official web fresh news requires explicit freshness intent",
			request: QueryScopeAdmissionRequest{
				Corpus:     "official_web",
				Collection: "fresh_news",
				QueryMode:  "freshness_sensitive",
			},
			want: false,
		},
		{
			name: "official web fresh news admitted for latest intent",
			request: QueryScopeAdmissionRequest{
				Corpus:          "official_web",
				Collection:      "fresh_news",
				FreshnessIntent: "latest",
				QueryMode:       "freshness_sensitive",
			},
			want:      true,
			wantClass: "intent_scoped",
		},
		{
			name: "official web news archive admitted for historical query mode",
			request: QueryScopeAdmissionRequest{
				Corpus:     "official_web",
				Collection: "news_archive",
				QueryMode:  "as_of",
			},
			want:      true,
			wantClass: "intent_scoped",
		},
		{
			name: "campus service catalog rejected",
			request: QueryScopeAdmissionRequest{
				Corpus:     "campus_services",
				Collection: "service_catalog",
				QueryMode:  "current",
			},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			admission, err := AdmitQueryScope(tt.request, "")
			if err != nil {
				t.Fatalf("admit query scope: %v", err)
			}
			if admission.Allowed != tt.want {
				t.Fatalf("allowed = %v, want %v; reason=%s", admission.Allowed, tt.want, admission.Reason)
			}
			if tt.wantClass != "" && admission.ScopeClass != tt.wantClass {
				t.Fatalf("scope class = %q, want %q", admission.ScopeClass, tt.wantClass)
			}
		})
	}
}

func TestQueryServingPolicyScopesListsDefaultAndIntentScopedAdmissions(t *testing.T) {
	scopes, err := QueryServingPolicyScopes("")
	if err != nil {
		t.Fatalf("query serving policy scopes: %v", err)
	}
	got := map[string]bool{}
	for _, scope := range scopes {
		got[scope.Corpus+"/"+scope.Collection] = true
	}
	for _, scope := range []string{
		"regulations/student_rules",
		"regulations/institutional_rules",
		"curriculum/curriculum_plan",
		"official_web/stable_reference",
		"official_web/fresh_news",
		"official_web/news_archive",
	} {
		if !got[scope] {
			t.Fatalf("query-serving policy scope %s missing: %#v", scope, got)
		}
	}
	if got["regulations/scoped_rules"] {
		t.Fatal("policy-closed scoped_rules must not be returned as query-serving policy scope")
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
	policyPath := filepath.Join(t.TempDir(), "query-serving-scopes.v2.json")
	if err := os.WriteFile(
		policyPath,
		[]byte(`{"policy_version":"query-serving-scopes-v2","default_open":[{"corpus":"regulations","collection":"student_rules","allowed_query_modes":["current"]}],"intent_scoped":[]}`),
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
	policyPath := filepath.Join(t.TempDir(), "query-serving-scopes.v2.json")
	if err := os.WriteFile(
		policyPath,
		[]byte(`{"default_open":[{"corpus":"regulations","collection":"student_rules","allowed_query_modes":["current"]}],"intent_scoped":[]}`),
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
	policyPath := filepath.Join(t.TempDir(), "query-serving-scopes.v2.json")
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
