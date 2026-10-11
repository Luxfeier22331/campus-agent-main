package temporalruntime

import (
	"testing"

	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestExecutorOutputFailurePreservesMaterials(t *testing.T) {
	for _, scenario := range []string{"materials", "no_match", "none", "deadline", "max_turns_exceeded", "tool_call_budget_exhausted"} {
		t.Run(scenario, func(t *testing.T) {
			env := (&testsuite.WorkflowTestSuite{}).NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("executor-output-" + scenario)
			input.AdmissionSnapshot.AgentCapabilities.HostedWebSearch = false
			input.AdmissionSnapshot.AgentCapabilities.VisibleFunctionToolNames = []string{"campus_search"}
			step := WorkflowTaskPlanStep{ID: "step.notice", Objective: "查找借购数量", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
			plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: "借购数量", Steps: []WorkflowTaskPlanStep{step}}
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
			failure := WorkflowOperationActivityOutput{Operation: WorkflowOperationExecuteStep, Status: "failed", Failure: &ExecutionFailure{Code: "model_output_invalid", Operation: "workflow.execute_step"}}
			if scenario == "materials" || scenario == "max_turns_exceeded" || scenario == "tool_call_budget_exhausted" {
				if scenario != "materials" {
					failure.Failure.Code = scenario
				}
				failure.Evidence = []WorkflowEvidence{{SchemaVersion: "workflow_evidence.v1", ID: "notice-246587", Source: WorkflowSourceCampusSearch, Title: "借购数量", Excerpt: "由2册增加至4册", CitationIndex: 1}}
				failure.SourceAttempts = []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}}
			}
			if scenario == "no_match" {
				failure.SourceAttempts = []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}
			}
			if scenario == "deadline" {
				failure.Failure.Code = "agent_deadline_exceeded"
			}
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).Return(failure, nil).Once()
			success := scenario == "materials" || scenario == "no_match" || scenario == "max_turns_exceeded" || scenario == "tool_call_budget_exhausted"
			if success {
				env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
					return len(actual.RemainingFacts) == 1 && actual.RemainingFacts[0].Objective == step.Objective &&
						len(actual.Evidence) == len(failure.Evidence) && len(actual.SourceAttempts) == 1
				})).Return(workflowSynthesisOutput(input.RequestID, "由2册增加至4册", failure.Evidence), nil).Once()
				env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{Status: "completed"}, nil).Once()
			} else {
				env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool {
					return actual.FailureKind == failure.Failure.Code
				})).Return(FinalizeExecutionFailureActivityOutput{Status: "failed"}, nil).Once()
			}
			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if (env.GetWorkflowError() == nil) != success {
				t.Fatalf("unexpected workflow error: %v", env.GetWorkflowError())
			}
			env.AssertExpectations(t)
			env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 1)
			env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 0)
		})
	}
}

func TestInvalidExecutorAndReplanContinueExistingSteps(t *testing.T) {
	env := (&testsuite.WorkflowTestSuite{}).NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("invalid-output-remaining")
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "查通知", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	second := WorkflowTaskPlanStep{ID: "step.second", Objective: "核对数量", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{first.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: "核对数量", Steps: []WorkflowTaskPlanStep{first, second}}
	materials := []WorkflowEvidence{{SchemaVersion: "workflow_evidence.v1", ID: "notice", Source: WorkflowSourceCampusSearch, Title: "借购数量", Excerpt: "2册增加到4册", CitationIndex: 1}}
	attempts := []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == first.ID })).Return(WorkflowOperationActivityOutput{
		Status: "failed", Failure: &ExecutionFailure{Code: "model_output_invalid"}, Evidence: materials, SourceAttempts: attempts,
	}, nil).Once()
	env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.Anything).Return(WorkflowOperationActivityOutput{
		Status: "failed", Failure: &ExecutionFailure{Code: "model_output_invalid"},
	}, nil).Once()
	secondOutput := workflowStepOutput(input.RequestID, second, "已核对", materials, attempts)
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == second.ID && actual.CompletedSteps[0].Failure.Code == "model_output_invalid"
	})).Return(secondOutput, nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 2 && len(actual.Evidence) == 1
	})).Return(workflowSynthesisOutput(input.RequestID, "由2册增加至4册。[1]", materials), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{Status: "completed"}, nil).Once()
	env.ExecuteWorkflow(ToolExecutionWorkflow, input)
	if err := env.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	env.AssertExpectations(t)
}

func TestFailedSolveRecoveryUsesMaterialsWithoutPlan(t *testing.T) {
	for _, scenario := range []string{"recovered", "partial_answer", "no_materials", "provider_failure", "synthesis_failed", "synthesis_http_failure", "deadline", "cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("recovery-" + scenario)
			evidence := []WorkflowEvidence{{SchemaVersion: "workflow_evidence.v1", ID: "notice-246587", Source: WorkflowSourceCampusSearch, Title: "借阅调整", Excerpt: "增加至4册", CitationIndex: 1}}
			if scenario == "no_materials" || scenario == "provider_failure" {
				evidence = nil
			}
			attempts := []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "failed", FailureCode: "campus_search_result_budget_exhausted"}}
			failureCode := "retrieval_budget_exhausted"
			if scenario == "provider_failure" {
				failureCode = "provider_timeout"
			}
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(WorkflowOperationActivityOutput{Operation: WorkflowOperationSolve, Status: "failed", Evidence: evidence, SourceAttempts: attempts, AnswerStarted: scenario == "partial_answer", Failure: &ExecutionFailure{Code: failureCode, Operation: "solve"}}, nil).Once()
			if len(evidence) > 0 {
				result := workflowSynthesisOutput(input.RequestID, "增加至4册。[1]", evidence)
				if scenario == "synthesis_failed" {
					result.Status = "failed"
					result.FinalOutput = ""
					result.Failure = &ExecutionFailure{Code: "provider_http_failed", Operation: "synthesize"}
				}
				var synthesisErr error
				if scenario == "synthesis_http_failure" {
					synthesisErr = temporal.NewNonRetryableApplicationError("upstream unavailable", "provider_http_failed", nil)
				}
				if scenario == "deadline" {
					synthesisErr = temporal.NewNonRetryableApplicationError("expired", "agent_deadline_exceeded", nil)
				}
				if scenario == "cancelled" {
					synthesisErr = temporal.NewCanceledError()
				}
				env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
					return actual.Mode == "recovery" && len(actual.RemainingFacts) == 0 && len(actual.Evidence) == 1 && len(actual.SourceAttempts) == 1 && actual.RecoveryReason == "retrieval_budget_exhausted" && actual.BufferAnswer == (scenario == "partial_answer")
				})).Return(result, synthesisErr).Once()
			}
			switch scenario {
			case "recovered", "partial_answer":
				env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.MatchedBy(func(actual WriteWorkflowFinalizationActivityInput) bool {
					return actual.WorkflowResult.Status == "completed" && actual.WorkflowResult.FinalOutput == "增加至4册。[1]"
				})).Return(WorkflowFinalizationActivityOutput{Status: "completed", RequestID: input.RequestID}, nil).Once()
			case "cancelled":
				env.OnActivity(FinalizeExecutionCancellationActivityName, mock.Anything, mock.Anything).Return(FinalizeExecutionCancellationActivityOutput{Status: "cancelled"}, nil).Once()
			default:
				code := "materials_insufficient"
				if scenario == "synthesis_failed" || scenario == "synthesis_http_failure" {
					code = "answer_synthesis_failed"
				}
				if scenario == "provider_failure" {
					code = "provider_timeout"
				}
				if scenario == "deadline" {
					code = "agent_deadline_exceeded"
				}
				env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool { return actual.FailureKind == code })).Return(FinalizeExecutionFailureActivityOutput{Status: "failed"}, nil).Once()
			}
			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if (env.GetWorkflowError() == nil) != (scenario == "recovered" || scenario == "partial_answer") {
				t.Fatalf("unexpected workflow error: %v", env.GetWorkflowError())
			}
			env.AssertExpectations(t)
			if len(evidence) == 0 {
				env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
			}
		})
	}
}

func TestValidAnswerCompletesWithoutSourceEvidence(t *testing.T) {
	for _, tc := range []struct {
		name    string
		attempt WorkflowSourceAttempt
		want    string
	}{
		{"no_match", WorkflowSourceAttempt{Source: WorkflowSourceCampusSearch, Status: "no_match"}, "materials_insufficient"},
		{"source_failure", WorkflowSourceAttempt{Source: WorkflowSourceCampusSearch, Status: "failed", FailureCode: "campus_search_timeout"}, "campus_search_timeout"},
		{"memory_failure", WorkflowSourceAttempt{Source: WorkflowSourcePersonalMemoryRecall, Status: "failed", FailureCode: "personal_memory_recall_failed"}, "personal_memory_recall_failed"},
		{"web_metadata_only", WorkflowSourceAttempt{Source: WorkflowSourceWebSearch, Status: "no_match"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := (&testsuite.WorkflowTestSuite{}).NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput(tc.name)
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(WorkflowOperationActivityOutput{Status: "completed", SolveOutcome: "answer", FinalOutput: "暂未找到相关资料。", SourceAttempts: []WorkflowSourceAttempt{tc.attempt}}, nil).Once()
			env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.MatchedBy(func(actual WriteWorkflowFinalizationActivityInput) bool {
				return actual.WorkflowResult.FinalOutput == "暂未找到相关资料。"
			})).Return(WorkflowFinalizationActivityOutput{Status: "completed"}, nil).Once()

			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if err := env.GetWorkflowError(); err != nil {
				t.Fatalf("valid answer failed: %v", err)
			}
			env.AssertExpectations(t)
			env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
		})
	}
}
