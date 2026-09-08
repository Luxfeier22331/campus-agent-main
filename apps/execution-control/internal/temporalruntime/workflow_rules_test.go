package temporalruntime

import (
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestValidateWorkflowRulesSharePlanAndReplanSemantics(t *testing.T) {
	capabilities := execution.AgentCapabilitiesForAdmission(false, true)
	first := WorkflowTaskPlanStep{
		ID:               "step.first",
		Objective:        "先查资料",
		CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch},
	}
	plan := WorkflowTaskPlan{
		SchemaVersion: "task_plan.v1",
		Goal:          "校园任务",
		Steps:         []WorkflowTaskPlanStep{first},
	}
	if err := ValidateWorkflowPlan(plan, 2, capabilities); err != nil {
		t.Fatalf("valid plan rejected: %v", err)
	}
	completed := []WorkflowCompletedStep{{Step: first, ExecutionIndex: 1, Summary: "已完成"}}
	if err := ValidateWorkflowCompletedSteps(completed, plan); err != nil {
		t.Fatalf("valid completed step rejected: %v", err)
	}
	replacement := WorkflowTaskPlanStep{
		ID:               "step.second",
		Objective:        "补充公开资料",
		CandidateSources: []WorkflowSource{WorkflowSourceWebSearch},
		DependsOn:        []string{first.ID},
	}
	if err := ValidateWorkflowRemainingSteps([]WorkflowTaskPlanStep{replacement}, 2, completed, capabilities); err != nil {
		t.Fatalf("valid remaining step rejected: %v", err)
	}

	for _, test := range []struct {
		name   string
		replan WorkflowTaskReplan
		want   string
	}{
		{
			name:   "continue requires remaining steps",
			replan: WorkflowTaskReplan{Decision: "continue"},
			want:   "requires remaining steps",
		},
		{
			name:   "synthesize rejects remaining steps",
			replan: WorkflowTaskReplan{Decision: "synthesize", RemainingSteps: []WorkflowTaskPlanStep{replacement}},
			want:   "must not contain remaining steps",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateWorkflowReplanDecision(test.replan)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error = %v, want substring %q", err, test.want)
			}
		})
	}
}

func TestValidateWorkflowCompletedStepsDoesNotRevalidateSources(t *testing.T) {
	step := WorkflowTaskPlanStep{
		ID:               "step.first",
		Objective:        "已准入步骤",
		CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch},
	}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: "校园任务", Steps: []WorkflowTaskPlanStep{step}}
	completed := []WorkflowCompletedStep{{Step: step, ExecutionIndex: 1, Summary: "已完成"}}
	if err := ValidateWorkflowCompletedSteps(completed, plan); err != nil {
		t.Fatalf("completed step rejected despite exact plan membership: %v", err)
	}
}

func TestWorkflowTaskPlanStepEqualComparesPlanSemantics(t *testing.T) {
	base := WorkflowTaskPlanStep{
		ID:               "step.first",
		Objective:        "先查资料",
		CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch, WorkflowSourceWebSearch},
		DependsOn:        []string{"step.previous"},
	}

	tests := []struct {
		name  string
		other WorkflowTaskPlanStep
		want  bool
	}{
		{name: "identical", other: base, want: true},
		{name: "different id", other: func() WorkflowTaskPlanStep { v := base; v.ID = "step.other"; return v }(), want: false},
		{name: "different objective", other: func() WorkflowTaskPlanStep { v := base; v.Objective = "换个目标"; return v }(), want: false},
		{name: "different candidate sources", other: func() WorkflowTaskPlanStep {
			v := base
			v.CandidateSources = []WorkflowSource{WorkflowSourceCampusSearch}
			return v
		}(), want: false},
		{name: "different dependency", other: func() WorkflowTaskPlanStep { v := base; v.DependsOn = []string{"step.other"}; return v }(), want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := WorkflowTaskPlanStepEqual(base, test.other); got != test.want {
				t.Fatalf("WorkflowTaskPlanStepEqual() = %v, want %v", got, test.want)
			}
		})
	}
}
