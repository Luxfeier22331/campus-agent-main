package temporalruntime

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestToolExecutionWorkflowReplansPartialCoverageWithinBudget(t *testing.T) {
	for _, tc := range []struct {
		name        string
		missing     []string
		budget      int
		wantReplans int
	}{
		{name: "partial coverage", missing: []string{"申请截止日期"}, budget: 1, wantReplans: 1},
		{name: "sufficient coverage", budget: 1},
		{name: "exhausted budget", missing: []string{"申请截止日期"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("run-coverage")
			input.AdmissionSnapshot.AgentBudget.MaxReplans = tc.budget
			first := WorkflowTaskPlanStep{ID: "step.first", Objective: "申请条件和截止日期", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}}
			next := WorkflowTaskPlanStep{ID: "step.next", Objective: "补充截止日期", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{first.ID}}
			plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first}}
			evidence := WorkflowEvidence{SchemaVersion: "workflow_evidence.v1", ID: "evidence.conditions", Source: WorkflowSourceCampusSearch, Title: "申请条件", Excerpt: "在校学生可申请。", CitationIndex: 1}
			output := workflowStepOutput(input.RequestID, first, "已取得申请条件。", []WorkflowEvidence{evidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}})
			output.CompletedStep.RemainingFacts = append([]string{}, tc.missing...)
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == first.ID })).Return(output, nil).Once()
			if tc.wantReplans > 0 {
				env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.MatchedBy(func(actual ReplanTaskActivityInput) bool {
					return len(actual.CompletedSteps) == 1 && len(actual.CompletedSteps[0].Evidence) == 1 && equalStrings(actual.CompletedSteps[0].RemainingFacts, tc.missing)
				})).Return(workflowReplanOutput(input.RequestID, "continue", "补充缺失日期。", []WorkflowTaskPlanStep{next}), nil).Once()
				env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == next.ID })).Return(workflowStepOutput(input.RequestID, next, "未找到日期。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceWebSearch, Status: "no_match"}}), nil).Once()
			}
			env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
				return actual.AnswerMode == "grounded" && len(actual.Evidence) == 1 && len(actual.CompletedSteps) == 1+tc.wantReplans
			})).Return(workflowSynthesisOutput(input.RequestID, "在校学生可申请，截止日期尚未查明。", []WorkflowEvidence{evidence}), nil).Once()
			env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
			env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if err := env.GetWorkflowError(); err != nil {
				t.Fatal(err)
			}
			env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, tc.wantReplans)
			env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 1+tc.wantReplans)
			env.AssertExpectations(t)
		})
	}
}

func TestToolExecutionWorkflowFailsWithoutRecoveryAdmission(t *testing.T) {
	for _, tc := range []struct {
		name   string
		budget int
		web    bool
		code   string
	}{
		{name: "zero budget", web: true, code: "provider_http_failed"},
		{name: "no alternative", budget: 1, code: "provider_http_failed"},
		{name: "contract error", budget: 1, web: true, code: "tool_contract_mismatch"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("run-no-recovery")
			input.AdmissionSnapshot.AgentBudget.MaxReplans = tc.budget
			input.AdmissionSnapshot.AgentCapabilities.HostedWebSearch = tc.web
			input.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames = []string{"campus_search"}
			step := WorkflowTaskPlanStep{ID: "step.first", Objective: "检索资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}}
			plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{step}}
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("failed", tc.code, nil)).Once()
			env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool { return actual.FailureKind == tc.code })).Return(FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, Status: "failed"}, nil).Once()
			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if env.GetWorkflowError() == nil {
				t.Fatal("expected workflow failure")
			}
			env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 0)
			env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
			env.AssertExpectations(t)
		})
	}
}

func TestWorkflowReplanRejectsUngroundedSynthesis(t *testing.T) {
	for _, status := range []string{"no_match", "failed"} {
		completed := []WorkflowCompletedStep{{SourceAttempts: []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: status}}}}
		if err := ValidateWorkflowReplanDecision(WorkflowTaskReplan{SchemaVersion: "task_replan.v2", Decision: "synthesize"}, completed); err == nil {
			t.Fatalf("synthesize accepted without evidence for %s", status)
		}
		err := ValidateWorkflowReplanDecision(WorkflowTaskReplan{SchemaVersion: "task_replan.v2", Decision: "insufficient"}, completed)
		if (err == nil) != (status == "no_match") {
			t.Fatalf("insufficient decision for %s: %v", status, err)
		}
	}
}
