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
			output.RemainingFacts = append([]string{}, tc.missing...)
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == first.ID })).Return(output, nil).Once()
			if tc.wantReplans > 0 {
				env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.MatchedBy(func(actual ReplanTaskActivityInput) bool {
					return len(actual.CompletedSteps) == 1 && len(actual.CompletedSteps[0].Evidence) == 1 && equalStrings(actual.CompletedSteps[0].RemainingFacts, tc.missing)
				})).Return(workflowReplanOutput(input.RequestID, "continue", "补充缺失日期。", []WorkflowTaskPlanStep{next}), nil).Once()
				env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == next.ID })).Return(workflowStepOutput(input.RequestID, next, "未找到日期。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceWebSearch, Status: "no_match"}}), nil).Once()
			}
			env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
				return len(actual.Evidence) == 1 && len(actual.RemainingFacts) == 1+tc.wantReplans
			})).Return(workflowSynthesisOutput(input.RequestID, "在校学生可申请，截止日期尚未查明。", []WorkflowEvidence{evidence}), nil).Once()
			env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

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

func TestWorkflowSynthesisRequiresMaterialsOrSuccessfulAttempt(t *testing.T) {
	for _, code := range []string{"campus_search_timeout", "personal_memory_recall_failed"} {
		completed := []WorkflowCompletedStep{{SourceAttempts: []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "failed", FailureCode: code}}}}
		if !workflowCanSynthesize(nil, completed) {
			t.Fatalf("source unavailable must permit synthesis: %s", code)
		}
	}
	for _, status := range []string{"matched", "no_match", "completed", "failed", ""} {
		completed := []WorkflowCompletedStep{{SourceAttempts: []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: status}}}}
		if got := workflowCanSynthesize(nil, completed); got != (status != "failed" && status != "") {
			t.Fatalf("synthesis readiness for %q = %t", status, got)
		}
		if !workflowCanSynthesize([]WorkflowEvidence{{ID: "candidate"}}, completed) {
			t.Fatal("candidate materials must permit synthesis even after another source fails")
		}
	}
	if workflowCanSynthesize(nil, nil) {
		t.Fatal("no materials and no source attempt must not pretend to be no-match")
	}
	if err := ValidateWorkflowReplanDecision(WorkflowTaskReplan{SchemaVersion: "task_replan.v3", Decision: "synthesize"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidateWorkflowReplanDecision(WorkflowTaskReplan{SchemaVersion: "task_replan.v3", Decision: "insufficient"}); err == nil {
		t.Fatal("retired insufficient decision was accepted")
	}
}

func TestWorkflowKeepsUnhelpfulCandidatesAndCompletes(t *testing.T) {
	for _, replan := range []bool{false, true} {
		t.Run(map[bool]string{false: "budget exhausted", true: "replanner finishes"}[replan], func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("run-unhelpful-candidate")
			input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
			if replan {
				input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
			}
			step := WorkflowTaskPlanStep{ID: "step.lookup", Objective: "申请截止日期", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}}
			plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{step}}
			evidence := []WorkflowEvidence{{SchemaVersion: "workflow_evidence.v1", ID: "candidate", Source: WorkflowSourceCampusSearch, Title: "申请资格", Excerpt: "在校学生可申请。", CitationIndex: 1}}
			output := workflowStepOutput(input.RequestID, step, "只有资格要求，没有截止日期。", evidence, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}})
			output.RemainingFacts = []string{"申请截止日期"}
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).Return(output, nil).Once()
			if replan {
				env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.Anything).Return(workflowReplanOutput(input.RequestID, "synthesize", "没有进一步适用路径。", nil), nil).Once()
			}
			env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
				return len(actual.Evidence) == 1 && actual.Evidence[0].ID == "candidate" && actual.SourceAttempts[0].Status == "matched" && equalStrings(actual.RemainingFacts[0].Facts, []string{"申请截止日期"})
			})).Return(workflowSynthesisOutput(input.RequestID, "暂时无法确认申请截止日期。", evidence), nil).Once()
			env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if err := env.GetWorkflowError(); err != nil {
				t.Fatal(err)
			}
			env.AssertExpectations(t)
			env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 1)
			env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 1)
		})
	}
}
