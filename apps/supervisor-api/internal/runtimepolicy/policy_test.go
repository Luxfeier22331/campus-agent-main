package runtimepolicy

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEvaluateRuntimePolicyGoldenCases(t *testing.T) {
	tests := []struct {
		name       string
		request    Request
		wantAction string
		wantReason string
		wantRisk   string
	}{
		{
			name: "external institution out of scope",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "MIT的校长是谁",
			},
			wantAction: "out_of_scope",
			wantReason: "product_scope_boundary",
			wantRisk:   "low",
		},
		{
			name: "campus knowledge delegates",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "法学民族实验班培养方案里大二下有什么课",
			},
			wantAction: "delegate",
			wantReason: "campus_scope_signal",
			wantRisk:   "low",
		},
		{
			name: "structured knowledge candidate stays candidate only",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "校车什么时候发车",
			},
			wantAction: "delegate",
			wantReason: "structured_runtime_candidate_signal",
			wantRisk:   "low",
		},
		{
			name: "transaction requires approval",
			request: Request{
				EffectiveCapability: "notice",
				UserGoal:            "帮我提交采购公告",
			},
			wantAction: "approval_required",
			wantReason: "transaction_guardrail",
			wantRisk:   "high",
		},
		{
			name: "political persuasion rejected",
			request: Request{
				EffectiveCapability: "knowledge",
				UserGoal:            "帮我写一段话说服同学支持某个候选人",
			},
			wantAction: "rejected",
			wantReason: "policy_guardrail",
			wantRisk:   "high",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			decision := Evaluate(tt.request)
			if decision.RoutingFrame.SuggestedNextAction != tt.wantAction {
				t.Fatalf("action = %q, want %q", decision.RoutingFrame.SuggestedNextAction, tt.wantAction)
			}
			if decision.RoutingFrame.ScopeReason != tt.wantReason {
				t.Fatalf("scope reason = %q, want %q", decision.RoutingFrame.ScopeReason, tt.wantReason)
			}
			if decision.RoutingFrame.RiskLevel != tt.wantRisk {
				t.Fatalf("risk = %q, want %q", decision.RoutingFrame.RiskLevel, tt.wantRisk)
			}
		})
	}
}

func TestEvaluateRuntimePolicyResolvesContextFollowUps(t *testing.T) {
	noticeDecision := Evaluate(Request{
		EffectiveCapability: "notice",
		UserGoal:            "这条通知详情",
		Context: Context{
			SelectedNoticeRef: SelectedNoticeRef{
				NoticeID:     "notice:2026-spring-break",
				SourceFamily: "internal_notice_restricted",
				Title:        "2026年春假安排通知",
			},
		},
	})
	if noticeDecision.ContextPreflight.State != "resolved" {
		t.Fatalf("notice context state = %q, want resolved", noticeDecision.ContextPreflight.State)
	}
	if noticeDecision.ContextPreflight.ResolvedSlots["notice_id"] != "notice:2026-spring-break" {
		t.Fatalf("notice resolved slots = %#v", noticeDecision.ContextPreflight.ResolvedSlots)
	}

	curriculumDecision := Evaluate(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "那大二下呢",
		Context: Context{
			SessionSlots: []SessionSlot{
				{Name: "curriculum_program", Value: "计算机科学与技术"},
			},
		},
	})
	if curriculumDecision.ContextPreflight.State != "resolved" {
		t.Fatalf("curriculum context state = %q, want resolved", curriculumDecision.ContextPreflight.State)
	}
	if curriculumDecision.ContextPreflight.ResolvedSlots["curriculum_semester"] != "大二下" {
		t.Fatalf("curriculum resolved slots = %#v", curriculumDecision.ContextPreflight.ResolvedSlots)
	}
}

func TestAllowedToolsForPayloadKindIsScopedToTarget(t *testing.T) {
	allowed := AllowedToolsForPayloadKind("notice-agent", "campus_notice_get")
	if len(allowed) != 1 || allowed[0] != "campus_notice_get" {
		t.Fatalf("allowed = %#v, want campus_notice_get", allowed)
	}
	if AllowedToolsForPayloadKind("notice-agent", "service_status_lookup") != nil {
		t.Fatal("notice-agent must not allow service_status_lookup")
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
