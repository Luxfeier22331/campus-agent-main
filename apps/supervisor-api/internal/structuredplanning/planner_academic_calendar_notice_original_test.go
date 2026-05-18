package structuredplanning

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
)

func TestPlanNoticeOriginalSpringBreakStaysNoticeLookup(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability: "notice",
		UserGoal:            "找春假通知原文",
	}, policy)

	if plan == nil {
		t.Fatal("expected workflow plan")
	}
	if plan.WorkflowMode != WorkflowModeSingleHandoff {
		t.Fatalf("workflow mode = %q, want single_handoff", plan.WorkflowMode)
	}
	handoff := plan.SelectedHandoff()
	if handoff == nil {
		t.Fatal("expected selected handoff")
	}
	if handoff.Target != "notice-agent" {
		t.Fatalf("target = %q, want notice-agent", handoff.Target)
	}
	if handoff.PayloadKind != "campus_notice_discover" {
		t.Fatalf("payload kind = %q, want campus_notice_discover", handoff.PayloadKind)
	}
	if len(handoff.AllowedTools) != 1 || handoff.AllowedTools[0] != "campus_notice_discover" {
		t.Fatalf("allowed tools = %#v, want campus_notice_discover", handoff.AllowedTools)
	}
	if got := handoff.Payload["query_text"]; got != "找春假通知原文" {
		t.Fatalf("payload query_text = %#v, want 找春假通知原文", got)
	}
}
