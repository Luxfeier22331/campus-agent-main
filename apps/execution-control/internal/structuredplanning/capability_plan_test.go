package structuredplanning

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func TestPlanWithPolicyAttachesInternalCapabilityPlanForSelectedNoticeFollowthrough(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability:      "knowledge",
		UserGoal:                 "这条通知依据学生手册哪条规定？",
		HasRequestedScope:        true,
		MultiStepWorkflowEnabled: true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:      "notice:smoke:001",
			SourceFamily:  "wechat_public_notice",
			Title:         "烟雾测试通知",
			TargetSurface: "regulations/student_rules",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected workflow plan")
		return
	}
	if plan.WorkflowMode != WorkflowModeMultiStep {
		t.Fatalf("workflow mode = %q, want multi_step capability preplan", plan.WorkflowMode)
	}
	capabilityPlan := plan.CapabilityPlan()
	if capabilityPlan == nil {
		t.Fatal("expected internal capability plan")
		return
	}
	if handoff := plan.SelectedHandoff(); handoff != nil {
		t.Fatalf("capability-only selected notice preplan must not bake selected handoff: %#v", handoff)
	}
	if handoffs := plan.Handoffs(); len(handoffs) != 0 {
		t.Fatalf("capability-only selected notice preplan must not bake handoffs: %#v", handoffs)
	}
	if capabilityPlan.SchemaVersion != CapabilityPlanSchemaVersion {
		t.Fatalf(
			"capability plan schema_version = %q, want %q",
			capabilityPlan.SchemaVersion,
			CapabilityPlanSchemaVersion,
		)
	}
	if capabilityPlan.Capability != "knowledge" {
		t.Fatalf("capability = %q, want knowledge", capabilityPlan.Capability)
	}
	if capabilityPlan.UserGoalSummary != "这条通知依据学生手册哪条规定？" {
		t.Fatalf("user goal summary = %q", capabilityPlan.UserGoalSummary)
	}
	if !sameCapabilityArtifacts(
		capabilityPlan.RequiredArtifacts,
		[]string{"notice_context", "evidence_bundle", "grounding_verdict"},
	) {
		t.Fatalf("required artifacts = %#v", capabilityPlan.RequiredArtifacts)
	}
	if len(capabilityPlan.OptionalArtifacts) != 0 {
		t.Fatalf("optional artifacts = %#v, want none", capabilityPlan.OptionalArtifacts)
	}
	if capabilityPlan.Constraints.SelectedNotice == nil {
		t.Fatal("selected notice constraint must be present")
	}
	if !capabilityPlan.Constraints.SelectedNotice.Required {
		t.Fatal("selected notice constraint must be required")
	}
	if capabilityPlan.Constraints.SelectedNotice.NoticeID != "notice:smoke:001" {
		t.Fatalf(
			"selected notice id = %q, want notice:smoke:001",
			capabilityPlan.Constraints.SelectedNotice.NoticeID,
		)
	}
	if !sameCapabilityArtifacts(
		capabilityPlan.Constraints.SelectedNotice.AllowedTargetSurfaces,
		[]string{
			"regulations/student_rules",
			"regulations/institutional_rules",
			"regulations/scoped_rules",
		},
	) {
		t.Fatalf(
			"allowed target surfaces = %#v",
			capabilityPlan.Constraints.SelectedNotice.AllowedTargetSurfaces,
		)
	}
	if capabilityPlan.Constraints.RequestedScope == nil {
		t.Fatal("requested scope constraint must be present")
	}
	if capabilityPlan.Constraints.RequestedScope.Corpus != "regulations" ||
		capabilityPlan.Constraints.RequestedScope.Collection != "student_rules" {
		t.Fatalf("requested scope = %#v", capabilityPlan.Constraints.RequestedScope)
	}
	if capabilityPlan.AnswerPolicy.FinalAnswerOwner != "execution-control-finalizer" ||
		!capabilityPlan.AnswerPolicy.RequiresArtifactBackedAnswer {
		t.Fatalf("answer policy = %#v", capabilityPlan.AnswerPolicy)
	}
	if !capabilityPlan.GroundingPolicy.Required ||
		!sameCapabilityArtifacts(
			capabilityPlan.GroundingPolicy.RequiredArtifacts,
			[]string{"evidence_bundle", "grounding_verdict"},
		) {
		t.Fatalf("grounding policy = %#v", capabilityPlan.GroundingPolicy)
	}
	if capabilityPlan.Budget.MaxSteps != 2 || capabilityPlan.Budget.MaxReplans != 1 {
		t.Fatalf("budget = %#v", capabilityPlan.Budget)
	}
	if !capabilityPlan.FailClose.FailClosed ||
		capabilityPlan.FailClose.Reason !=
			"selected_notice_target_surface_ineligible_for_knowledge_followthrough" {
		t.Fatalf("fail close = %#v", capabilityPlan.FailClose)
	}
	if _, exists := plan.Map()["capability_plan"]; exists {
		t.Fatal("workflow plan public map must not expose internal capability plan")
	}
	projection := plan.Map()
	if projection["workflow_mode"] != "multi_step" {
		t.Fatalf("workflow plan public map workflow_mode = %#v, want multi_step", projection["workflow_mode"])
	}
	if steps, ok := projection["steps"].([]map[string]any); !ok || len(steps) != 0 {
		t.Fatalf("capability-only selected notice preplan must not expose steps: %#v", projection["steps"])
	}
	if edges, ok := projection["edges"].([]map[string]any); !ok || len(edges) != 0 {
		t.Fatalf("capability-only selected notice preplan must not expose edges: %#v", projection["edges"])
	}
}

func TestPlanWithPolicyDoesNotAttachCapabilityPlanForSingleStepQueries(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	knowledgePlan := PlanWithPolicy(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "学生手册请假制度怎么规定？",
		HasRequestedScope:   true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
	}, policy)
	if knowledgePlan == nil {
		t.Fatal("expected knowledge workflow plan")
	}
	if knowledgePlan.CapabilityPlan() != nil {
		t.Fatalf("single-step knowledge plan must not attach capability plan: %#v", knowledgePlan.CapabilityPlan())
	}

	servicePlan := PlanWithPolicy(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "班车最早几点发车",
	}, policy)
	if servicePlan == nil {
		t.Fatal("expected campus services workflow plan")
	}
	if servicePlan.CapabilityPlan() != nil {
		t.Fatalf("campus services single-step plan must not attach capability plan: %#v", servicePlan.CapabilityPlan())
	}
}

func TestPlanWithPolicyDoesNotAttachCapabilityPlanForIneligibleSelectedNotice(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability:      "knowledge",
		UserGoal:                 "这条通知依据学生手册哪条规定？",
		HasRequestedScope:        true,
		MultiStepWorkflowEnabled: true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:      "notice:transport:355122",
			SourceFamily:  "internal_notice_restricted",
			Title:         "关于两校区学生通勤班车增加班次的通知",
			TargetSurface: "campus_services/service_status_candidate",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected generated workflow plan")
		return
	}
	if plan.WorkflowMode != WorkflowModeSingleStep {
		t.Fatalf("workflow mode = %q, want single_step", plan.WorkflowMode)
	}
	if plan.CapabilityPlan() != nil {
		t.Fatalf("ineligible selected notice must not attach capability plan: %#v", plan.CapabilityPlan())
	}
}

func TestTransportNoticeOverrideCapabilityPlanFreezesThreeStepArtifactIntent(t *testing.T) {
	plan := transportNoticeOverrideCapabilityPlan(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "今天丰台到海淀通勤车乘车点有没有调整",
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:      "353903",
			SourceFamily:  "internal_notice_restricted",
			Title:         "关于通勤班车丰台校区乘车点调整的通知",
			TargetSurface: "campus_services/service_status_candidate",
		},
	})

	if plan.SchemaVersion != CapabilityPlanSchemaVersion {
		t.Fatalf("schema_version = %q", plan.SchemaVersion)
	}
	if plan.Capability != "campus_services" {
		t.Fatalf("capability = %q", plan.Capability)
	}
	if !sameCapabilityArtifacts(
		plan.RequiredArtifacts,
		[]string{"schedule_baseline", "notice_change_set", "evidence_bundle", "grounding_verdict"},
	) {
		t.Fatalf("required artifacts = %#v", plan.RequiredArtifacts)
	}
	if plan.Budget.MaxSteps != 3 {
		t.Fatalf("max steps = %d, want 3", plan.Budget.MaxSteps)
	}
	if !plan.GroundingPolicy.Required {
		t.Fatal("grounding policy must be required for transport notice override synthesis")
	}
}

func sameCapabilityArtifacts(got []string, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for index := range got {
		if got[index] != want[index] {
			return false
		}
	}
	return true
}
