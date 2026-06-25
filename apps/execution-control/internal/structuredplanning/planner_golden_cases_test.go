package structuredplanning

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

type plannerGoldenCase struct {
	name           string
	request        Request
	wantCapability string
	wantKind       string
	wantTool       string
	wantPayload    map[string]any
}

func TestPlanGoldenCases(t *testing.T) {
	tests := append([]plannerGoldenCase{}, plannerGoldenCasesPart01()...)
	tests = append(tests, plannerGoldenCasesPart02()...)
	tests = append(tests, plannerGoldenCasesPart03()...)
	tests = append(tests, plannerGoldenCasesPart04()...)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !capabilityOpenForPlanning(tt.request.EffectiveCapability) {
				t.Skipf("%s capability is closed for current product runtime", tt.request.EffectiveCapability)
			}
			policy, err := runtimepolicy.LoadIntentPolicy("")
			if err != nil {
				t.Fatalf("load intent policy: %v", err)
			}
			plan := PlanWithPolicy(tt.request, policy)
			if plan == nil {
				t.Fatal("expected preplanned workflow plan")
				return
			}
			if plan.WorkflowMode != WorkflowModeSingleStep {
				t.Fatalf("workflow mode = %q, want single_step", plan.WorkflowMode)
			}
			handoff := plan.SelectedHandoff()
			if handoff == nil {
				t.Fatal("expected preplanned handoff")
				return
			}
			if handoff.Capability != tt.wantCapability || handoff.PayloadKind != tt.wantKind {
				t.Fatalf("handoff = %#v", handoff)
			}
			if tt.wantTool == "" {
				if len(handoff.AllowedTools) != 0 {
					t.Fatalf("allowed tools = %#v, want none", handoff.AllowedTools)
				}
			} else if len(handoff.AllowedTools) != 1 || handoff.AllowedTools[0] != tt.wantTool {
				t.Fatalf("allowed tools = %#v, want %q", handoff.AllowedTools, tt.wantTool)
			}
			for key, want := range tt.wantPayload {
				assertPayloadValue(t, handoff.Payload, key, want)
			}
		})
	}
}

func TestPlanWithPolicyDoesNotPreplanClosedCampusServicesCapability(t *testing.T) {
	policy, err := runtimepolicy.LoadIntentPolicy("")
	if err != nil {
		t.Fatalf("load intent policy: %v", err)
	}
	plan := PlanWithPolicy(Request{
		EffectiveCapability: "campus_services",
		UserGoal:            "校车时刻表",
	}, policy)
	if plan != nil {
		t.Fatalf("plan = %#v, want nil while campus_services is closed", plan)
	}
}
