package structuredplanning

import (
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

type plannerGoldenCase struct {
	name        string
	request     Request
	wantTarget  string
	wantKind    string
	wantTool    string
	wantPayload map[string]any
}

func TestPlanGoldenCases(t *testing.T) {
	tests := append([]plannerGoldenCase{}, plannerGoldenCasesPart01()...)
	tests = append(tests, plannerGoldenCasesPart02()...)
	tests = append(tests, plannerGoldenCasesPart03()...)
	tests = append(tests, plannerGoldenCasesPart04()...)

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			policy, err := runtimepolicy.LoadIntentPolicy("")
			if err != nil {
				t.Fatalf("load intent policy: %v", err)
			}
			plan := PlanWithPolicy(tt.request, policy)
			if plan == nil {
				t.Fatal("expected preplanned workflow plan")
			}
			if plan.WorkflowMode != WorkflowModeSingleHandoff {
				t.Fatalf("workflow mode = %q, want single_handoff", plan.WorkflowMode)
			}
			handoff := plan.SelectedHandoff()
			if handoff == nil {
				t.Fatal("expected preplanned handoff")
			}
			if handoff.Target != tt.wantTarget || handoff.PayloadKind != tt.wantKind {
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
