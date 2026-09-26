package temporalruntime

import (
	"context"
	"errors"
	"go.temporal.io/sdk/activity"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/stretchr/testify/mock"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
)

func TestPersonalMemoryCommandWorkflowRetriesCallbackWithoutRepeatingProviderMutation(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := PersonalMemoryCommandRequest{
		CommandID:         "memcmd-retry-callback",
		CommandKind:       "memory_add",
		OwnerGeneration:   1,
		OwnerSequence:     1,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SubjectID:         "memory-1",
		SupersessionScope: "item:memory-1",
		Item:              &PersonalMemoryCommandItem{Text: "program: cs"},
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result := PersonalMemoryCommandActivityOutput{
		CommandID:         command.CommandID,
		ResultFingerprint: "fingerprint-1",
		Status:            "succeeded",
	}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(result, nil).
		Once()
	env.OnActivity(
		FinalizePersonalMemoryCommandReceiptActivityName,
		mock.Anything,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result},
	).Return(result, nil).Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(errors.New("product callback unavailable")).
		Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(nil).
		Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{
		Command:    command,
		WorkflowID: "campus-agent.memory.command." + command.CommandID,
	})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecutePersonalMemoryCommandActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizePersonalMemoryCommandReceiptActivityName, 1)
	env.AssertActivityNumberOfCalls(t, WritePersonalMemoryCommandResultActivityName, 2)
}

func TestPersonalMemoryCommandWorkflowWaitsAtOwnerReceiptGate(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := PersonalMemoryCommandRequest{
		CommandID:         "cmd-owner-gated",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result := PersonalMemoryCommandActivityOutput{CommandID: command.CommandID, ResultFingerprint: "fingerprint", Status: "succeeded"}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(PersonalMemoryCommandActivityOutput{}, temporal.NewApplicationError("waiting", "memory_command_owner_blocked")).
		Once()
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(result, nil).
		Once()
	env.OnActivity(FinalizePersonalMemoryCommandReceiptActivityName, mock.Anything, FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result}).
		Return(result, nil).
		Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(nil).
		Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{Command: command})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecutePersonalMemoryCommandActivityName, 2)
}

func TestPersonalMemoryEraseCompletesAfterProviderDeletion(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := PersonalMemoryCommandRequest{
		CommandID:         "cmd-owner-erase",
		CommandKind:       "owner_erase",
		OwnerGeneration:   2,
		OwnerSequence:     3,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:erase:2",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	result := PersonalMemoryCommandActivityOutput{
		CommandID:         command.CommandID,
		ResultFingerprint: "fingerprint",
		Status:            "succeeded",
	}
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(result, nil).Once()
	env.OnActivity(
		FinalizePersonalMemoryCommandReceiptActivityName,
		mock.Anything,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: command, Result: result},
	).Return(result, nil).Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, result).
		Return(nil).Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{Command: command})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, FinalizePersonalMemoryCommandReceiptActivityName, 1)
}

func TestToolExecutionWorkflowRunsSolveExecutorAndSynthesizerInOrder(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-order")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	step := WorkflowTaskPlanStep{
		ID:               "step.lookup",
		Objective:        "查找校园通知",
		CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch},
		DependsOn:        []string{},
	}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{step}}
	evidence := WorkflowEvidence{
		SchemaVersion: "workflow_evidence.v1",
		ID:            "evidence.notice",
		Source:        WorkflowSourceCampusSearch,
		Title:         "校园通知",
		Excerpt:       "通知内容",
		CitationIndex: 1,
	}
	sequence := make([]string, 0, 5)
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.MatchedBy(func(actual SolveTaskActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.MaxSteps > 0
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "solve") }).
		Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.Step.ID == step.ID && len(actual.CompletedSteps) == 0
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "execute_step") }).
		Return(workflowStepOutput(input.RequestID, step, "查到通知。", []WorkflowEvidence{evidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}}), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return actual.RequestID == input.RequestID && len(actual.RemainingFacts) == 1 &&
			len(actual.Evidence) == 1 && actual.Evidence[0].ID == evidence.ID
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "synthesize") }).
		Return(workflowSynthesisOutput(input.RequestID, "最终答案。", []WorkflowEvidence{evidence}), nil).Once()
	completedAt := time.Date(2026, 8, 1, 1, 2, 3, 0, time.UTC)
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.MatchedBy(func(actual WriteWorkflowFinalizationActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.WorkflowResult.Operation == WorkflowOperationSynthesize &&
			actual.WorkflowResult.FinalOutput == "最终答案。"
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
		Return(WorkflowFinalizationActivityOutput{
			CompletedAt:   completedAt,
			ProjectionRef: "projection://runs/" + input.RequestID + "/answer/synthesize/result",
			RequestID:     input.RequestID,
			Status:        "completed",
		}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, AppendConversationMemoryActivityInput{RequestID: input.RequestID}).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
		Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := sequence, []string{"solve", "execute_step", "synthesize", "finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("activity sequence = %#v, want %#v", got, want)
	}
	var result ToolExecutionWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.RequestID != input.RequestID || result.Status != "completed" || !result.CompletedAt.Equal(completedAt) {
		t.Fatalf("workflow result = %#v", result)
	}
	env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 0)
}

func TestToolExecutionWorkflowFinalizesDirectSolveAnswer(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-direct-answer")
	sequence := make([]string, 0, 3)
	directAnswer := WorkflowOperationActivityOutput{
		Operation:    WorkflowOperationSolve,
		SolveOutcome: "answer",
		FinalOutput:  "直接答案。",
		RequestID:    input.RequestID,
		Status:       "completed",
	}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "solve") }).
		Return(directAnswer, nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.MatchedBy(func(actual WriteWorkflowFinalizationActivityInput) bool {
		return actual.RequestID == input.RequestID &&
			actual.WorkflowResult.Operation == WorkflowOperationSolve &&
			actual.WorkflowResult.SolveOutcome == "answer" &&
			actual.WorkflowResult.FinalOutput == "直接答案。"
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
		Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
		Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := sequence, []string{"solve", "finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("activity sequence = %#v, want %#v", got, want)
	}
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 0)
	env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 0)
	env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
}

func TestToolExecutionWorkflowFollowsMultipleStepDependencies(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-dependencies")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "获取基础事实", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	second := WorkflowTaskPlanStep{ID: "step.second", Objective: "整理关联规则", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{first.ID}}
	third := WorkflowTaskPlanStep{ID: "step.third", Objective: "读取个人偏好", CandidateSources: []WorkflowSource{WorkflowSourcePersonalMemoryRecall}, DependsOn: []string{second.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, second, third}}
	sequence := make([]string, 0, 3)
	evidence := WorkflowEvidence{SchemaVersion: "workflow_evidence.v1", ID: "evidence.dependency", Source: WorkflowSourceCampusSearch, Title: "基础事实", Excerpt: "基础事实内容", CitationIndex: 1}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	for index, step := range []WorkflowTaskPlanStep{first, second, third} {
		step := step
		expectedCompleted := index
		env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
			return actual.Step.ID == step.ID && len(actual.CompletedSteps) == expectedCompleted
		})).
			Run(func(mock.Arguments) { sequence = append(sequence, step.ID) }).
			Return(workflowStepOutput(input.RequestID, step, step.Objective+"完成。", []WorkflowEvidence{evidence}, []WorkflowSourceAttempt{{Source: step.CandidateSources[0], Status: "matched"}}), nil).Once()
	}
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 3 && actual.RemainingFacts[0].Objective == first.Objective &&
			actual.RemainingFacts[1].Objective == second.Objective && actual.RemainingFacts[2].Objective == third.Objective
	})).Return(workflowSynthesisOutput(input.RequestID, "依赖顺序答案。", []WorkflowEvidence{evidence}), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := sequence, []string{"step.first", "step.second", "step.third"}; !equalStrings(got, want) {
		t.Fatalf("step execution order = %#v, want %#v", got, want)
	}
}

func TestToolExecutionWorkflowContinuesToWebSearchAfterCampusNoMatch(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-source-expansion")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	campusStep := WorkflowTaskPlanStep{ID: "step.campus", Objective: "查询校内资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	webStep := WorkflowTaskPlanStep{ID: "step.web", Objective: "查询公开校园网页", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{campusStep.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{campusStep, webStep}}
	webEvidence := WorkflowEvidence{SchemaVersion: "workflow_evidence.v1", ID: "evidence.web", Source: WorkflowSourceWebSearch, Title: "公开网页", Excerpt: "公开资料内容", CitationIndex: 1, URL: "https://example.edu/notice"}
	steps := make([]string, 0, 2)
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == campusStep.ID
	})).
		Run(func(mock.Arguments) { steps = append(steps, campusStep.ID) }).
		Return(workflowStepOutput(input.RequestID, campusStep, "校内来源没有匹配结果。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == webStep.ID && len(actual.CompletedSteps) == 1 && actual.CompletedSteps[0].SourceAttempts[0].Status == "no_match"
	})).
		Run(func(mock.Arguments) { steps = append(steps, webStep.ID) }).
		Return(workflowStepOutput(input.RequestID, webStep, "公开网页找到资料。", []WorkflowEvidence{webEvidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceWebSearch, Status: "matched"}}), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 2 && len(actual.Evidence) == 1 && actual.Evidence[0].Source == WorkflowSourceWebSearch
	})).Return(workflowSynthesisOutput(input.RequestID, "基于公开资料的答案。", []WorkflowEvidence{webEvidence}), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := steps, []string{campusStep.ID, webStep.ID}; !equalStrings(got, want) {
		t.Fatalf("step execution order = %#v, want %#v", got, want)
	}
}

func TestToolExecutionWorkflowPreservesEvidenceAfterStepFailureAndContinues(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-step-failure-continues")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "获取已知资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	failed := WorkflowTaskPlanStep{ID: "step.failed", Objective: "获取暂时不可用资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{first.ID}}
	last := WorkflowTaskPlanStep{ID: "step.last", Objective: "补充公开资料", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{failed.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, failed, last}}
	firstEvidence := WorkflowEvidence{
		SchemaVersion: "workflow_evidence.v1",
		ID:            "evidence.first",
		Source:        WorkflowSourceCampusSearch,
		Title:         "已知资料",
		Excerpt:       "已知资料内容",
		CitationIndex: 1,
	}
	lastEvidence := WorkflowEvidence{
		SchemaVersion: "workflow_evidence.v1",
		ID:            "evidence.last",
		Source:        WorkflowSourceWebSearch,
		Title:         "公开资料",
		Excerpt:       "公开资料内容",
		CitationIndex: 2,
		URL:           "https://example.edu/notice",
	}
	sequence := make([]string, 0, 7)
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "solve") }).
		Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == first.ID && len(actual.CompletedSteps) == 0
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "first") }).
		Return(workflowStepOutput(input.RequestID, first, "第一步完成。", []WorkflowEvidence{firstEvidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}}), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == failed.ID && len(actual.CompletedSteps) == 1
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "failed") }).
		Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("step provider failed", "agent_deadline_exceeded", nil)).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == last.ID && len(actual.CompletedSteps) == 2 &&
			actual.CompletedSteps[1].Step.ID == failed.ID &&
			actual.CompletedSteps[1].Failure != nil
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "last") }).
		Return(workflowStepOutput(input.RequestID, last, "补充资料完成。", []WorkflowEvidence{lastEvidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceWebSearch, Status: "matched"}}), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 3 &&
			actual.RemainingFacts[1].Objective == failed.Objective &&
			len(actual.RemainingFacts[1].Facts) == 1 &&
			len(actual.Evidence) == 2 && actual.Evidence[0].ID == firstEvidence.ID && actual.Evidence[1].ID == lastEvidence.ID
	})).
		Run(func(mock.Arguments) { sequence = append(sequence, "synthesize") }).
		Return(workflowSynthesisOutput(input.RequestID, "基于已取得资料的部分答案。", []WorkflowEvidence{firstEvidence, lastEvidence}), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
		Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
		Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	if got, want := sequence, []string{"solve", "first", "failed", "last", "synthesize", "finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("activity sequence = %#v, want %#v", got, want)
	}
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
}

func TestToolExecutionWorkflowSynthesizesExistingEvidenceAfterTimedOutStep(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-step-timeout-partial")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "获取已知资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	second := WorkflowTaskPlanStep{ID: "step.timeout", Objective: "获取超时资料", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{first.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, second}}
	evidence := WorkflowEvidence{
		SchemaVersion: "workflow_evidence.v1",
		ID:            "evidence.timeout-first",
		Source:        WorkflowSourceCampusSearch,
		Title:         "已取得资料",
		Excerpt:       "已取得资料内容",
		CitationIndex: 1,
	}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == first.ID
	})).Return(workflowStepOutput(input.RequestID, first, "第一步完成。", []WorkflowEvidence{evidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "matched"}}), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == second.ID
	})).Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("agent runtime timed out", "agent_deadline_exceeded", nil)).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 2 && actual.RemainingFacts[1].Objective == second.Objective &&
			len(actual.RemainingFacts[1].Facts) == 1 &&
			len(actual.Evidence) == 1 && actual.Evidence[0].ID == evidence.ID
	})).Return(workflowSynthesisOutput(input.RequestID, "仅基于已取得资料的答案。", []WorkflowEvidence{evidence}), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 2)
	env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
}

func TestToolExecutionWorkflowFailsWhenFirstStepFailsWithoutEvidence(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-first-step-failure")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
	step := WorkflowTaskPlanStep{ID: "step.first", Objective: "获取资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{step}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).
		Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("step failed", "agent_deadline_exceeded", nil)).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.Stage == "task.step.step.first" &&
			actual.FailureKind == "agent_deadline_exceeded"
	})).Return(FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("workflow error is nil, want first-step failure")
	}
	env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
}

func TestToolExecutionWorkflowReplansAfterFinalCampusSearchMissOrFailure(t *testing.T) {
	for _, campusStatus := range []string{"failed", "no_match", "activity_error"} {
		t.Run(campusStatus, func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("run-workflow-final-campus-" + campusStatus)
			input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
			campusStep := WorkflowTaskPlanStep{ID: "step.campus", Objective: "查询校内资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
			webStep := WorkflowTaskPlanStep{ID: "step.web", Objective: "补充查询公开校园网页", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{campusStep.ID}}
			plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{campusStep}}
			webEvidence := WorkflowEvidence{SchemaVersion: "workflow_evidence.v1", ID: "evidence.web." + campusStatus, Source: WorkflowSourceWebSearch, Title: "公开网页", Excerpt: "公开资料内容", CitationIndex: 1, URL: "https://example.edu/notice"}
			sequence := make([]string, 0, 6)
			stepOutput := workflowStepOutput(input.RequestID, campusStep, "校内来源没有可用结果。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: campusStatus, FailureCode: "campus_search_unavailable"}})
			var stepError error
			if campusStatus == "activity_error" {
				stepOutput = WorkflowOperationActivityOutput{}
				stepError = temporal.NewNonRetryableApplicationError("source unavailable", "provider_http_failed", nil)
			}
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
				Run(func(mock.Arguments) { sequence = append(sequence, "solve") }).
				Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
				return actual.Step.ID == campusStep.ID
			})).
				Run(func(mock.Arguments) { sequence = append(sequence, "campus") }).
				Return(stepOutput, stepError).Once()
			env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.MatchedBy(func(actual ReplanTaskActivityInput) bool {
				if actual.ReplanIndex != 1 || len(actual.RemainingSteps) != 0 || len(actual.CompletedSteps) != 1 {
					return false
				}
				completed := actual.CompletedSteps[0]
				if completed.Step.ID != campusStep.ID || len(completed.Evidence) != 0 {
					return false
				}
				if campusStatus == "activity_error" {
					return completed.Failure != nil && completed.Failure.Code == "provider_http_failed" && len(completed.SourceAttempts) == 0 && equalStrings(completed.RemainingFacts, []string{campusStep.Objective})
				}
				return len(completed.SourceAttempts) == 1 && completed.SourceAttempts[0].Status == campusStatus && completed.SourceAttempts[0].FailureCode == "campus_search_unavailable"
			})).
				Run(func(mock.Arguments) { sequence = append(sequence, "replan") }).
				Return(workflowReplanOutput(input.RequestID, "continue", "校内来源不可用，改查公开来源。", []WorkflowTaskPlanStep{webStep}), nil).Once()
			env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
				return actual.Step.ID == webStep.ID && len(actual.CompletedSteps) == 1 &&
					len(actual.Plan.Steps) == 2 && actual.Plan.Steps[1].ID == webStep.ID
			})).
				Run(func(mock.Arguments) { sequence = append(sequence, "web") }).
				Return(workflowStepOutput(input.RequestID, webStep, "公开网页找到资料。", []WorkflowEvidence{webEvidence}, []WorkflowSourceAttempt{{Source: WorkflowSourceWebSearch, Status: "matched"}}), nil).Once()
			env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
				return len(actual.RemainingFacts) == 2 && len(actual.Evidence) == 1 &&
					actual.Evidence[0].Source == WorkflowSourceWebSearch
			})).
				Run(func(mock.Arguments) { sequence = append(sequence, "synthesize") }).
				Return(workflowSynthesisOutput(input.RequestID, "基于公开资料的答案。", []WorkflowEvidence{webEvidence}), nil).Once()
			env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).
				Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
				Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
			env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
				Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
				Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

			env.ExecuteWorkflow(ToolExecutionWorkflow, input)

			if err := env.GetWorkflowError(); err != nil {
				t.Fatalf("workflow error: %v", err)
			}
			if got, want := sequence, []string{"solve", "campus", "replan", "web", "synthesize", "finalization", "memory_append"}; !equalStrings(got, want) {
				t.Fatalf("activity sequence = %#v, want %#v", got, want)
			}
			env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 1)
		})
	}
}

func TestToolExecutionWorkflowReplannerCanReplaceRemainingPath(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-replace")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "先查基础资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	oldSecond := WorkflowTaskPlanStep{ID: "step.old", Objective: "旧路径", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{first.ID}}
	newSecond := WorkflowTaskPlanStep{ID: "step.new", Objective: "改查公开资料", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{first.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, oldSecond}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == first.ID })).
		Return(workflowStepOutput(input.RequestID, first, "基础资料完成。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}), nil).Once()
	env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.MatchedBy(func(actual ReplanTaskActivityInput) bool {
		return actual.ReplanIndex == 1 && len(actual.RemainingSteps) == 1 && actual.RemainingSteps[0].ID == oldSecond.ID
	})).Return(workflowReplanOutput(input.RequestID, "continue", "切换来源。", []WorkflowTaskPlanStep{newSecond}), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == newSecond.ID && len(actual.CompletedSteps) == 1 &&
			len(actual.Plan.Steps) == 2 && actual.Plan.Steps[0].ID == first.ID && actual.Plan.Steps[1].ID == newSecond.ID
	})).Return(workflowStepOutput(input.RequestID, newSecond, "新路径完成。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceWebSearch, Status: "matched"}}), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 2 && actual.RemainingFacts[1].Objective == newSecond.Objective
	})).Return(workflowSynthesisOutput(input.RequestID, "重规划后的答案。", nil), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 1)
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 2)
}

func TestToolExecutionWorkflowRejectsRemovedReplanDecision(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-revise-rejected")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
	step := WorkflowTaskPlanStep{ID: "step.first", Objective: "查询资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{step}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).
		Return(workflowStepOutput(input.RequestID, step, "没有匹配结果。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}), nil).Once()
	env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.Anything).
		Return(workflowReplanOutput(input.RequestID, "revise", "旧决策不再支持。", nil), nil).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.Stage == "solve.replan.1" && actual.FailureKind == "workflow_replan_invalid"
	})).Return(FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err == nil || !strings.Contains(err.Error(), "unsupported replan decision") {
		t.Fatalf("workflow error = %v, want removed decision failure", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 1)
	env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
}

func TestToolExecutionWorkflowRejectsReplanThatExceedsTotalStepBudget(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-replan-budget")
	input.AdmissionSnapshot.AgentBudget.MaxPlanSteps = 2
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "先查基础资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	oldSecond := WorkflowTaskPlanStep{ID: "step.old", Objective: "旧路径", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{first.ID}}
	newSecond := WorkflowTaskPlanStep{ID: "step.new", Objective: "改查公开资料", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{first.ID}}
	newThird := WorkflowTaskPlanStep{ID: "step.extra", Objective: "追加检索", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{newSecond.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, oldSecond}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool {
		return actual.Step.ID == first.ID
	})).Return(workflowStepOutput(input.RequestID, first, "基础资料完成。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}), nil).Once()
	env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.MatchedBy(func(actual ReplanTaskActivityInput) bool {
		return actual.MaxRemainingSteps == 1
	})).Return(workflowReplanOutput(input.RequestID, "continue", "扩展检索路径。", []WorkflowTaskPlanStep{newSecond, newThird}), nil).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.Stage == "solve.replan.1" &&
			actual.FailureKind == "workflow_replan_invalid"
	})).Return(FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err == nil || !strings.Contains(err.Error(), "workflow steps exceed budget") {
		t.Fatalf("workflow error = %v, want total step budget failure", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 1)
	env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
}

func TestToolExecutionWorkflowReplannerCanEndSearchAndSynthesize(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-early-synthesis")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "获取足够资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	second := WorkflowTaskPlanStep{ID: "step.second", Objective: "不应执行的补充资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{first.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, second}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == first.ID })).
		Return(workflowStepOutput(input.RequestID, first, "校内来源没有匹配结果。", nil, []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}), nil).Once()
	env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.Anything).Return(workflowReplanOutput(input.RequestID, "synthesize", "检索无匹配结果。", nil), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.MatchedBy(func(actual SynthesizeAnswerActivityInput) bool {
		return len(actual.RemainingFacts) == 1 && actual.RemainingFacts[0].Objective == first.Objective
	})).Return(workflowSynthesisOutput(input.RequestID, "提前合成的答案。", nil), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 1)
	env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 1)
}

func TestToolExecutionWorkflowStopsAfterMaxReplans(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-max-replans")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 1
	first := WorkflowTaskPlanStep{ID: "step.first", Objective: "第一步", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}
	second := WorkflowTaskPlanStep{ID: "step.second", Objective: "第二步", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{first.ID}}
	third := WorkflowTaskPlanStep{ID: "step.third", Objective: "第三步", CandidateSources: []WorkflowSource{WorkflowSourceWebSearch}, DependsOn: []string{second.ID}}
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{first, second, third}}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	for _, step := range []WorkflowTaskPlanStep{first, second, third} {
		step := step
		status := "completed"
		if step.ID == first.ID {
			status = "no_match"
		}
		env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.MatchedBy(func(actual ExecuteTaskStepActivityInput) bool { return actual.Step.ID == step.ID })).
			Return(workflowStepOutput(input.RequestID, step, step.ID+" 完成。", nil, []WorkflowSourceAttempt{{Source: step.CandidateSources[0], Status: status}}), nil).Once()
	}
	env.OnActivity(ReplanTaskActivityName, mock.Anything, mock.Anything).Return(workflowReplanOutput(input.RequestID, "continue", "继续。", []WorkflowTaskPlanStep{second, third}), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.Anything).Return(workflowSynthesisOutput(input.RequestID, "预算内答案。", nil), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, ReplanTaskActivityName, 1)
	env.AssertActivityNumberOfCalls(t, ExecuteTaskStepActivityName, 3)
}

func TestToolExecutionWorkflowFinalizesSolveRunFailed(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-solve-failure")
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("solve operation failed", "run_failed", nil)).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeExecutionFailureActivityInput) bool {
		return actual.RequestID == input.RequestID && actual.Stage == "solve.initial" &&
			actual.FailureKind == "run_failed" && !actual.FailedAt.IsZero()
	})).Return(FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want solve failure")
	}
	env.AssertActivityNumberOfCalls(t, SolveTaskActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 1)
	env.AssertActivityNumberOfCalls(t, SynthesizeAnswerActivityName, 0)
}

func TestToolExecutionWorkflowFreezesFailureTimestampAcrossFinalizerRetries(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-frozen-failure-time")
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("solve operation failed", "run_failed", nil)).Once()
	failedAt := make([]time.Time, 0, 2)
	captureFailedAt := func(arguments mock.Arguments) {
		finalization, ok := arguments.Get(1).(FinalizeExecutionFailureActivityInput)
		if !ok {
			t.Fatalf("failure finalizer input = %#v", arguments.Get(1))
		}
		failedAt = append(failedAt, finalization.FailedAt)
	}
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Run(captureFailedAt).
		Return(FinalizeExecutionFailureActivityOutput{}, errors.New("temporary finalizer outage")).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Run(captureFailedAt).
		Return(FinalizeExecutionFailureActivityOutput{RequestID: input.RequestID, Status: "failed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if env.GetWorkflowError() == nil {
		t.Fatal("workflow error is nil, want solve failure")
	}
	if len(failedAt) != 2 || failedAt[0].IsZero() || !failedAt[0].Equal(failedAt[1]) {
		t.Fatalf("failure finalizer timestamps = %#v, want one frozen non-zero value", failedAt)
	}
}

func TestToolExecutionWorkflowReturnsFailureFinalizerErrorBeforeStageError(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-finalizer-failure")
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		Return(WorkflowOperationActivityOutput{}, temporal.NewNonRetryableApplicationError("solve operation failed", "run_failed", nil)).Once()
	env.OnActivity(FinalizeExecutionFailureActivityName, mock.Anything, mock.Anything).
		Return(FinalizeExecutionFailureActivityOutput{}, temporal.NewNonRetryableApplicationError("failure finalizer rejected", "execution_failure_finalizer_invalid", nil)).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	err := env.GetWorkflowError()
	if err == nil || !strings.Contains(err.Error(), "failure finalizer rejected") {
		t.Fatalf("workflow error = %v, want failure finalizer error", err)
	}
	if strings.Contains(err.Error(), "solve operation failed") {
		t.Fatalf("workflow error = %v, finalizer error must take precedence", err)
	}
}

func TestToolExecutionWorkflowRetriesFinalizationProjectionWithoutFailureFinalizer(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-finalization-repair")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	plan := WorkflowTaskPlan{
		SchemaVersion: "task_plan.v1",
		Goal:          workflowTestGoal,
		Steps: []WorkflowTaskPlanStep{{
			ID:               "step.lookup",
			Objective:        "查找资料",
			CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch},
			DependsOn:        []string{},
		}},
	}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).Return(workflowStepOutput(input.RequestID, plan.Steps[0], "步骤完成。", nil, nil), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.Anything).Return(workflowSynthesisOutput(input.RequestID, "答案。", nil), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WorkflowFinalizationActivityOutput{}, errors.New("internal finalization projection unavailable")).Once()
	completedAt := time.Date(2026, 8, 2, 8, 0, 0, 0, time.UTC)
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).
		Return(WorkflowFinalizationActivityOutput{CompletedAt: completedAt, ProjectionRef: "projection://runs/" + input.RequestID + "/answer/synthesize/result", RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error after finalization repair: %v", err)
	}
	env.AssertActivityNumberOfCalls(t, WriteWorkflowFinalizationActivityName, 2)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
}

func TestToolExecutionWorkflowLeavesFinalizationProjectionConflictForRepair(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-finalization-conflict")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	plan := WorkflowTaskPlan{
		SchemaVersion: "task_plan.v1",
		Goal:          workflowTestGoal,
		Steps: []WorkflowTaskPlanStep{{
			ID:               "step.lookup",
			Objective:        "查找资料",
			CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch},
			DependsOn:        []string{},
		}},
	}
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).Return(workflowStepOutput(input.RequestID, plan.Steps[0], "步骤完成。", nil, nil), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.Anything).Return(workflowSynthesisOutput(input.RequestID, "答案。", nil), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(
		WorkflowFinalizationActivityOutput{},
		temporal.NewNonRetryableApplicationError("projection conflict", "finalization_projection_conflict", nil),
	).Once()

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err == nil || !strings.Contains(err.Error(), "projection conflict") {
		t.Fatalf("workflow error = %v, want finalization projection conflict", err)
	}
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
}

func TestToolExecutionWorkflowFinalizesCancellationOnDisconnectedContext(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-canceled")
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).
		After(time.Hour).
		Return(WorkflowOperationActivityOutput{}, nil).Once()
	env.OnActivity(
		FinalizeExecutionCancellationActivityName,
		mock.Anything,
		mock.MatchedBy(func(finalization FinalizeExecutionCancellationActivityInput) bool {
			return finalization.RequestID == input.RequestID && finalization.Reason == "user_requested" && !finalization.CanceledAt.IsZero()
		}),
	).Return(FinalizeExecutionCancellationActivityOutput{RequestID: input.RequestID, Status: "canceled"}, nil).Once()
	env.RegisterDelayedCallback(env.CancelWorkflow, time.Minute)

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) {
		t.Fatalf("workflow error = %v, want canceled error", err)
	}
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionCancellationActivityName, 1)
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
	env.AssertActivityNumberOfCalls(t, WriteWorkflowFinalizationActivityName, 0)
}

func TestToolExecutionWorkflowKeepsCompletedResultWhenCancellationRacesCleanup(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	input := validToolExecutionWorkflowInput("run-workflow-completed-cancel-race")
	input.AdmissionSnapshot.AgentBudget.MaxReplans = 0
	plan := WorkflowTaskPlan{SchemaVersion: "task_plan.v1", Goal: workflowTestGoal, Steps: []WorkflowTaskPlanStep{{ID: "step.lookup", Objective: "查找资料", CandidateSources: []WorkflowSource{WorkflowSourceCampusSearch}, DependsOn: []string{}}}}
	completedAt := time.Date(2026, 8, 3, 1, 2, 3, 0, time.UTC)
	sequence := make([]string, 0, 2)
	env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(workflowPlanOutput(input.RequestID, plan), nil).Once()
	env.OnActivity(ExecuteTaskStepActivityName, mock.Anything, mock.Anything).Return(workflowStepOutput(input.RequestID, plan.Steps[0], "步骤完成。", nil, nil), nil).Once()
	env.OnActivity(SynthesizeAnswerActivityName, mock.Anything, mock.Anything).Return(workflowSynthesisOutput(input.RequestID, "答案。", nil), nil).Once()
	env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).
		Run(func(mock.Arguments) { sequence = append(sequence, "finalization") }).
		Return(WorkflowFinalizationActivityOutput{CompletedAt: completedAt, ProjectionRef: "projection://runs/" + input.RequestID + "/answer/synthesize/result", RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).
		After(time.Hour).
		Run(func(mock.Arguments) { sequence = append(sequence, "memory_append") }).
		Return(AppendConversationMemoryActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
	env.RegisterDelayedCallback(env.CancelWorkflow, time.Minute)

	env.ExecuteWorkflow(ToolExecutionWorkflow, input)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result ToolExecutionWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.RequestID != input.RequestID || result.Status != "completed" || !result.CompletedAt.Equal(completedAt) {
		t.Fatalf("workflow result = %#v, want completed finalization", result)
	}
	if got, want := sequence, []string{"finalization", "memory_append"}; !equalStrings(got, want) {
		t.Fatalf("post-finalization sequence = %#v, want %#v", got, want)
	}
	env.AssertActivityNumberOfCalls(t, FinalizeExecutionCancellationActivityName, 0)
}

func workflowPlanOutput(requestID string, plan WorkflowTaskPlan) WorkflowOperationActivityOutput {
	return WorkflowOperationActivityOutput{
		Operation:    WorkflowOperationSolve,
		SolveOutcome: "plan",
		Plan:         &plan,
		RequestID:    requestID,
		Status:       "completed",
	}
}

func workflowStepOutput(
	requestID string,
	step WorkflowTaskPlanStep,
	summary string,
	evidence []WorkflowEvidence,
	attempts []WorkflowSourceAttempt,
) WorkflowOperationActivityOutput {
	if len(evidence) == 0 && len(attempts) == 0 {
		attempts = []WorkflowSourceAttempt{{Source: step.CandidateSources[0], Status: "no_match"}}
	}
	completed := WorkflowCompletedStep{
		Step:           step,
		ExecutionIndex: 1,
		Summary:        summary,
		RemainingFacts: []string{},
		Evidence:       append([]WorkflowEvidence{}, evidence...),
		SourceAttempts: append([]WorkflowSourceAttempt{}, attempts...),
	}
	return WorkflowOperationActivityOutput{
		Operation:      WorkflowOperationExecuteStep,
		RequestID:      requestID,
		Status:         "completed",
		FinalOutput:    summary,
		RemainingFacts: completed.RemainingFacts,
		Evidence:       append([]WorkflowEvidence{}, evidence...),
		SourceAttempts: append([]WorkflowSourceAttempt{}, attempts...),
	}
}

func workflowReplanOutput(requestID string, decision string, reason string, remaining []WorkflowTaskPlanStep) WorkflowOperationActivityOutput {
	return WorkflowOperationActivityOutput{
		Operation: WorkflowOperationReplan,
		RequestID: requestID,
		Status:    "completed",
		Replan: &WorkflowTaskReplan{
			SchemaVersion:  "task_replan.v3",
			Decision:       decision,
			Reason:         reason,
			RemainingSteps: append([]WorkflowTaskPlanStep{}, remaining...),
		},
	}
}

func workflowSynthesisOutput(requestID string, finalOutput string, evidence []WorkflowEvidence) WorkflowOperationActivityOutput {
	attempts := []WorkflowSourceAttempt{}
	if len(evidence) == 0 {
		attempts = []WorkflowSourceAttempt{{Source: WorkflowSourceCampusSearch, Status: "no_match"}}
	}
	return WorkflowOperationActivityOutput{
		Operation:      WorkflowOperationSynthesize,
		RequestID:      requestID,
		Status:         "completed",
		FinalOutput:    finalOutput,
		Evidence:       append([]WorkflowEvidence{}, evidence...),
		SourceAttempts: attempts,
	}
}

func equalStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func TestMemoryAppendExhaustionClosesOnlyBackgroundStep(t *testing.T) {
	for _, mode := range []string{"provider", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			var suite testsuite.WorkflowTestSuite
			env := suite.NewTestWorkflowEnvironment()
			registerWorkflowTestActivities(env, &Activities{})
			input := validToolExecutionWorkflowInput("memory-final-" + mode)
			answer := WorkflowOperationActivityOutput{Operation: WorkflowOperationSolve, SolveOutcome: "answer", FinalOutput: "答案", RequestID: input.RequestID, Status: "completed"}
			env.OnActivity(SolveTaskActivityName, mock.Anything, mock.Anything).Return(answer, nil).Once()
			env.OnActivity(WriteWorkflowFinalizationActivityName, mock.Anything, mock.Anything).Return(WorkflowFinalizationActivityOutput{RequestID: input.RequestID, Status: "completed"}, nil).Once()
			cause := temporal.NewApplicationError("provider failed", "hindsight_append_failed")
			if mode == "timeout" {
				cause = temporal.NewTimeoutError(enumspb.TIMEOUT_TYPE_START_TO_CLOSE, nil)
			}
			env.OnActivity(AppendConversationMemoryActivityName, mock.Anything, mock.Anything).Return(AppendConversationMemoryActivityOutput{}, cause).Times(3)
			env.OnActivity(FinalizeMemoryAppendActivityName, mock.Anything, mock.MatchedBy(func(actual FinalizeMemoryAppendActivityInput) bool {
				return actual.RequestID == input.RequestID && actual.FailureKind != ""
			})).Return(func(ctx context.Context, _ FinalizeMemoryAppendActivityInput) error {
				if queue := activity.GetInfo(ctx).TaskQueue; queue != ActivityTaskQueueCore {
					t.Errorf("finalizer queue = %q", queue)
				}
				return nil
			}).Once()
			env.ExecuteWorkflow(ToolExecutionWorkflow, input)
			if err := env.GetWorkflowError(); err != nil {
				t.Fatal(err)
			}
			env.AssertActivityNumberOfCalls(t, FinalizeMemoryAppendActivityName, 1)
			env.AssertActivityNumberOfCalls(t, FinalizeExecutionFailureActivityName, 0)
			env.AssertExpectations(t)
		})
	}
}

func TestPersonalMemoryCommandWorkflowFailsAfterBoundedOwnerGateWait(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	registerWorkflowTestActivities(env, &Activities{})
	command := PersonalMemoryCommandRequest{
		CommandID:         "cmd-wait-timeout",
		CommandKind:       "owner_transition",
		LifecycleState:    "paused",
		OwnerGeneration:   1,
		OwnerSequence:     2,
		SchemaVersion:     memoryruntime.PersonalMemoryCommandSchemaVersion,
		SourceUpdatedAt:   "2026-07-16T00:00:00Z",
		SupersessionScope: "owner:lifecycle",
		TenantID:          "tenant-main",
		UserID:            "user-1",
	}
	// The predecessor receipt never resolves, so the gate stays blocked.
	env.OnActivity(ExecutePersonalMemoryCommandActivityName, mock.Anything, command).
		Return(PersonalMemoryCommandActivityOutput{}, temporal.NewApplicationError("waiting", "memory_command_owner_blocked"))
	timeoutResult := PersonalMemoryCommandActivityOutput{
		CommandID:         command.CommandID,
		ErrorCode:         "memory_command_wait_timeout",
		ResultFingerprint: "fingerprint-timeout",
		Status:            "failed",
	}
	env.OnActivity(
		FinalizePersonalMemoryCommandReceiptActivityName,
		mock.Anything,
		mock.MatchedBy(func(input FinalizePersonalMemoryCommandReceiptActivityInput) bool {
			return input.Command.CommandID == command.CommandID &&
				input.Result.Status == "failed" &&
				input.Result.ErrorCode == "memory_command_wait_timeout"
		}),
	).Return(timeoutResult, nil).Once()
	env.OnActivity(WritePersonalMemoryCommandResultActivityName, mock.Anything, timeoutResult).
		Return(nil).
		Once()

	env.ExecuteWorkflow(PersonalMemoryCommandWorkflow, PersonalMemoryCommandWorkflowInput{Command: command})

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow error: %v", err)
	}
	var result PersonalMemoryCommandWorkflowResult
	if err := env.GetWorkflowResult(&result); err != nil {
		t.Fatalf("workflow result: %v", err)
	}
	if result.Status != "failed" || result.ErrorCode != "memory_command_wait_timeout" {
		t.Fatalf("result=%#v, want failed memory_command_wait_timeout", result)
	}
}
