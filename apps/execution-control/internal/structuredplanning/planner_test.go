package structuredplanning

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

func TestPlanSkipsTransactionalStructuredRequests(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}
	for _, request := range []Request{
		{
			EffectiveCapability: "notice",
			UserGoal:            "帮我提交采购公告",
		},
		{
			EffectiveCapability: "campus_services",
			UserGoal:            "帮我打电话给研究生院招生办公室",
		},
		{
			EffectiveCapability: "campus_services",
			UserGoal:            "帮我发邮件给国际合作处",
		},
		{
			EffectiveCapability: "campus_services",
			UserGoal:            "帮我预约地铁接驳车",
		},
	} {
		plan := PlanWithPolicy(request, policy)
		if plan != nil {
			t.Fatalf("transactional request must not be preplanned for %q: %#v", request.UserGoal, plan)
		}
	}
}

func TestPlanWithPolicyProjectsCanonicalWorkflowPlan(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability: "knowledge",
		UserGoal:            "学生手册请假制度怎么规定？",
		HasRequestedScope:   true,
		RequestedScope: Scope{
			Corpus:     "regulations",
			Collection: "student_rules",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected workflow plan")
		return
	}
	if plan.SchemaVersion != WorkflowPlanSchemaVersion {
		t.Fatalf("schema version = %q, want %q", plan.SchemaVersion, WorkflowPlanSchemaVersion)
	}
	if plan.WorkflowMode != WorkflowModeSingleStep {
		t.Fatalf("workflow mode = %q, want single_step", plan.WorkflowMode)
	}
	if plan.PlanID == "" {
		t.Fatal("plan id must not be empty")
	}
	if len(plan.Steps) != 1 {
		t.Fatalf("step count = %d, want 1", len(plan.Steps))
	}
	step := plan.Steps[0]
	if step.StepKind != WorkflowStepKindHandoff || step.Capability != "knowledge" {
		t.Fatalf("step = %#v, want knowledge capability handoff", step)
	}
	if step.SelectedTool != "retrieval.query" {
		t.Fatalf("selected tool = %q, want retrieval.query", step.SelectedTool)
	}
	if len(plan.Edges) != 0 {
		t.Fatalf("edges = %#v, want none for single step", plan.Edges)
	}
	if plan.SemanticRetryPolicy.MaxReplans != 0 {
		t.Fatalf("semantic retry max replans = %d, want 0", plan.SemanticRetryPolicy.MaxReplans)
	}
	projection := plan.Map()
	if projection["workflow_mode"] != "single_step" {
		t.Fatalf("projection workflow_mode = %v, want single_step", projection["workflow_mode"])
	}
	steps, ok := projection["steps"].([]map[string]any)
	if !ok || len(steps) != 1 || steps[0]["capability"] != "knowledge" {
		t.Fatalf("projection steps = %#v, want typed knowledge step", projection["steps"])
	}
}

func TestPlanWithPolicyBuildsCapabilityOnlyNoticeKnowledgeFollowthroughPreplan(t *testing.T) {
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
		t.Fatalf("workflow mode = %q, want multi_step", plan.WorkflowMode)
	}
	if handoff := plan.SelectedHandoff(); handoff != nil {
		t.Fatalf("capability preplan must not carry selected handoff: %#v", handoff)
	}
	handoffs := plan.Handoffs()
	if len(handoffs) != 0 {
		t.Fatalf("handoff count = %d, want 0 for capability preplan", len(handoffs))
	}
	if capabilityPlan := plan.CapabilityPlan(); capabilityPlan == nil {
		t.Fatal("selected notice followthrough must carry internal capability plan")
	}
	if plan.ResumePolicy.ResumeSupported != true {
		t.Fatal("multi-step plan must declare resume support")
	}
	if plan.SemanticRetryPolicy.MaxReplans != 1 {
		t.Fatalf("semantic retry max replans = %d, want 1", plan.SemanticRetryPolicy.MaxReplans)
	}
	projection := plan.Map()
	if projection["workflow_mode"] != "multi_step" {
		t.Fatalf("projection workflow_mode = %v, want multi_step", projection["workflow_mode"])
	}
	steps, ok := projection["steps"].([]map[string]any)
	if !ok || len(steps) != 0 {
		t.Fatalf("projection steps = %#v, want no baked steps", projection["steps"])
	}
	edges, ok := projection["edges"].([]map[string]any)
	if !ok || len(edges) != 0 {
		t.Fatalf("projection edges = %#v, want no baked dependency edges", projection["edges"])
	}
}

func TestPlanWithPolicyBuildsTransportNoticeOverrideCapabilityPreplan(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}

	plan := PlanWithPolicy(Request{
		EffectiveCapability:      "campus_services",
		UserGoal:                 "今天丰台到海淀通勤车乘车点有没有调整",
		MultiStepWorkflowEnabled: true,
		SelectedNoticeRef: SelectedNoticeRef{
			NoticeID:      "notice:transport:353903",
			SourceFamily:  "internal_notice_restricted",
			Title:         "关于通勤班车丰台校区乘车点调整的通知",
			TargetSurface: "campus_services/service_status_candidate",
		},
	}, policy)

	if plan == nil {
		t.Fatal("expected transport notice override capability preplan")
	}
	if plan.WorkflowMode != WorkflowModeMultiStep || plan.CapabilityPlan() == nil {
		t.Fatalf("plan = %#v, want multi_step capability preplan", plan)
	}
}

func TestValidateWorkflowPlanWithCapabilitySpecRejectsInactiveCapability(t *testing.T) {
	plan := SingleStepPlan(Handoff{
		Capability:  "navigation",
		PayloadKind: "place_lookup",
		Payload:     map[string]any{"query_text": "北楼在哪里"},
	})
	registry := runtimepolicy.CapabilitySpecRegistry{
		SchemaVersion:   runtimepolicy.CapabilitySpecSchemaVersion,
		RegistryVersion: "test",
		Capabilities: []runtimepolicy.CapabilitySpec{
			{
				ID:                     "navigation",
				OwnerPackage:           "packages/navigation-capability",
				WorkerRole:             "activity-worker-navigation",
				RuntimeAdapter:         "temporal_activity_worker",
				Active:                 false,
				OpeningGate:            "closed",
				AllowedStructuredTools: []string{},
				ContextProjectionKinds: []string{"place_context"},
				Description:            "fixture",
			},
		},
	}
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load tool spec: %v", err)
	}

	err = ValidateWorkflowPlanWithCapabilitySpec(plan, registry, toolRegistry)

	if err == nil {
		t.Fatal("expected inactive capability plan validation to fail")
	}
}

func TestValidateWorkflowPlanWithCapabilitySpecRejectsPayloadKindOutsideCapabilitySpec(t *testing.T) {
	plan := SingleStepPlan(Handoff{
		Capability:  "campus_services",
		PayloadKind: "campus_notice_discover",
		Payload:     map[string]any{"query_text": "校历"},
	})
	registry, err := runtimepolicy.LoadCapabilitySpecRegistry("")
	if err != nil {
		t.Fatalf("load capability spec: %v", err)
	}
	toolRegistry, err := runtimepolicy.LoadToolSpecRegistry("")
	if err != nil {
		t.Fatalf("load tool spec: %v", err)
	}

	err = ValidateWorkflowPlanWithCapabilitySpec(plan, registry, toolRegistry)

	if err == nil {
		t.Fatal("expected payload kind outside CapabilitySpec to fail")
	}
}

func TestPlanWithPolicyUsesIntentPolicyArtifactSignals(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}
	policy.SignalGroups["structured_transport"] = []string{"摆渡车"}

	plan := PlanWithPolicy(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "摆渡车最早几点",
	}, policy)

	if plan == nil {
		t.Fatal("expected transport schedule plan from policy signal")
	}
	handoff := plan.SelectedHandoff()
	if handoff == nil ||
		handoff.Capability != "campus_services" ||
		handoff.PayloadKind != "transport_schedule_lookup" {
		t.Fatalf("handoff = %#v", handoff)
	}
}

func assertPayloadValue(t *testing.T, payload map[string]any, key string, want any) {
	t.Helper()
	got := payload[key]
	wantMap, wantIsMap := want.(map[string]any)
	if !wantIsMap {
		if got != want {
			t.Fatalf("payload[%s] = %#v, want %#v", key, got, want)
		}
		return
	}
	gotMap, ok := got.(map[string]any)
	if !ok {
		t.Fatalf("payload[%s] = %#v, want map", key, got)
	}
	for nestedKey, nestedWant := range wantMap {
		if gotMap[nestedKey] != nestedWant {
			t.Fatalf(
				"payload[%s][%s] = %#v, want %#v",
				key,
				nestedKey,
				gotMap[nestedKey],
				nestedWant,
			)
		}
	}
}
