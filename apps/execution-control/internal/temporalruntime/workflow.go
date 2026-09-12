package temporalruntime

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const defaultPersonalMemoryActivityTimeoutSeconds = 90

func ToolExecutionWorkflow(
	ctx workflow.Context,
	input ToolExecutionWorkflowInput,
) (ToolExecutionWorkflowResult, error) {
	activityOptions := defaultActivityOptions()
	if err := validateWorkflowInput(input); err != nil {
		if finalizeErr := finalizeExecutionFailure(
			ctx,
			activityOptions,
			input,
			"workflow.input",
			"workflow_input_invalid",
			err,
		); finalizeErr != nil {
			return ToolExecutionWorkflowResult{}, finalizeErr
		}
		return ToolExecutionWorkflowResult{}, err
	}
	if !input.DeadlineAt.IsZero() && !workflow.Now(ctx).Before(input.DeadlineAt) {
		return failWorkflowStage(ctx, activityOptions, input, "workflow.deadline", "agent_deadline_exceeded", errors.New("workflow deadline has expired"))
	}
	solveResult, err := executeSolveTask(ctx, activityOptions, input)
	if err != nil {
		if workflowExecutionCanceled(ctx, err) {
			return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
		}
		if finalizeErr := finalizeExecutionFailure(
			ctx,
			activityOptions,
			input,
			"solve.initial",
			"workflow_solve_failed",
			err,
		); finalizeErr != nil {
			return ToolExecutionWorkflowResult{}, finalizeErr
		}
		return ToolExecutionWorkflowResult{}, err
	}
	if solveResult.Status == "failed" {
		evidence, _, mergeErr := mergeWorkflowEvidence(nil, solveResult.Evidence, 1)
		if mergeErr != nil {
			return failWorkflowStage(ctx, activityOptions, input, "solve.initial", "workflow_evidence_invalid", mergeErr)
		}
		if len(evidence) == 0 {
			code := workflowNoMaterialsFailure(solveResult)
			return failWorkflowStage(ctx, activityOptions, input, "solve.initial", code, errors.New("solver failed without usable materials"))
		}
		recoveryReason := "workflow_solve_failed"
		if solveResult.Failure != nil {
			recoveryReason = solveResult.Failure.Code
		}
		synthesis, synthesisErr := executeSynthesizeAnswer(ctx, activityOptions, input, SynthesizeAnswerActivityInput{
			Mode:              "recovery",
			Evidence:          evidence,
			SourceAttempts:    append([]WorkflowSourceAttempt{}, solveResult.SourceAttempts...),
			RemainingFacts:    []WorkflowRemainingFacts{},
			RecoveryReason:    recoveryReason,
			BufferAnswer:      solveResult.AnswerStarted,
			SearchSuggestions: solveResult.SearchSuggestions,
		})
		if synthesisErr != nil {
			if workflowExecutionCanceled(ctx, synthesisErr) {
				return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
			}
			if workflowFailureKind(synthesisErr, "") != "agent_deadline_exceeded" {
				synthesisErr = temporal.NewNonRetryableApplicationError("recovery synthesis failed", "answer_synthesis_failed", synthesisErr)
			}
			return failWorkflowStage(ctx, activityOptions, input, "answer.synthesize", "answer_synthesis_failed", synthesisErr)
		}
		if synthesis.Status == "failed" || strings.TrimSpace(synthesis.FinalOutput) == "" {
			if synthesis.Failure != nil && synthesis.Failure.Code == "agent_deadline_exceeded" {
				return failWorkflowStage(ctx, activityOptions, input, "answer.synthesize", "agent_deadline_exceeded", errors.New("recovery reached request deadline"))
			}
			return failWorkflowStage(ctx, activityOptions, input, "answer.synthesize", "answer_synthesis_failed", errors.New("synthesizer did not return a complete answer"))
		}
		return finalizeWorkflowAnswer(ctx, activityOptions, input, synthesis)
	}
	if solveResult.SolveOutcome == "answer" {
		if strings.TrimSpace(solveResult.FinalOutput) == "" {
			return failWorkflowStage(ctx, activityOptions, input, "solve.initial", "workflow_solve_invalid", errors.New("solver returned empty answer"))
		}
		return finalizeWorkflowAnswer(ctx, activityOptions, input, solveResult)
	}
	if solveResult.SolveOutcome != "plan" || solveResult.Plan == nil {
		return failWorkflowStage(ctx, activityOptions, input, "solve.initial", "workflow_solve_invalid", errors.New("solver returned neither an answer nor a plan"))
	}
	plan := *solveResult.Plan
	if err := ValidateWorkflowPlan(
		plan,
		input.AdmissionSnapshot.AgentBudget.MaxPlanSteps,
		input.AdmissionSnapshot.AgentCapabilities,
	); err != nil {
		return failWorkflowStage(ctx, activityOptions, input, "solve.initial", "workflow_solve_invalid", err)
	}
	remaining := append([]WorkflowTaskPlanStep{}, plan.Steps...)
	completedSteps := make([]WorkflowCompletedStep, 0, len(plan.Steps))
	evidence, nextCitationIndex, mergeErr := mergeWorkflowEvidence(nil, solveResult.Evidence, 1)
	if mergeErr != nil {
		return failWorkflowStage(ctx, activityOptions, input, "solve.initial", "workflow_evidence_invalid", mergeErr)
	}
	replanCount := 0
	for len(remaining) > 0 {
		if !input.DeadlineAt.IsZero() && !workflow.Now(ctx).Before(input.DeadlineAt) {
			return failWorkflowStage(ctx, activityOptions, input, "workflow.deadline", "agent_deadline_exceeded", errors.New("workflow deadline has expired"))
		}
		stepIndex := nextReadyWorkflowStep(remaining, completedSteps)
		if stepIndex < 0 {
			return failWorkflowStage(
				ctx,
				activityOptions,
				input,
				"workflow.solve",
				"workflow_dependency_cycle",
				errors.New("workflow has no executable remaining step"),
			)
		}
		step := remaining[stepIndex]
		stepResult, stepErr := executeTaskStep(ctx, activityOptions, input, plan, step, completedSteps, nextCitationIndex, solveResult)
		var completed WorkflowCompletedStep
		if stepErr != nil {
			if workflowExecutionCanceled(ctx, stepErr) {
				return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
			}
			if !WorkflowFailureRecoverable(workflowFailureKind(stepErr, "")) {
				return failWorkflowStage(ctx, activityOptions, input, workflowTaskStepID(step.ID), "workflow_step_failed", stepErr)
			}
			completed = failedWorkflowStep(step, len(completedSteps)+1, stepErr)
		} else if stepResult.Status == "failed" {
			if stepResult.Failure == nil || !WorkflowFailureRecoverable(stepResult.Failure.Code) {
				code := "workflow_step_failed"
				if stepResult.Failure != nil {
					code = stepResult.Failure.Code
				}
				return failWorkflowStage(ctx, activityOptions, input, workflowTaskStepID(step.ID), code, errors.New("executor returned an unrecoverable failure"))
			}
			if stepResult.Failure.Code == "agent_deadline_exceeded" {
				return failWorkflowStage(ctx, activityOptions, input, workflowTaskStepID(step.ID), "agent_deadline_exceeded", errors.New("executor reached request deadline"))
			}
			completed = failedWorkflowStep(step, len(completedSteps)+1,
				temporal.NewNonRetryableApplicationError("executor output failed", stepResult.Failure.Code, nil))
			completed.Evidence = stepResult.Evidence
			completed.SourceAttempts = stepResult.SourceAttempts
			completed.SearchSuggestions = stepResult.SearchSuggestions
		} else {
			var completedErr error
			completed, completedErr = canonicalCompletedWorkflowStep(stepResult, step, len(completedSteps)+1)
			if completedErr != nil {
				return failWorkflowStage(ctx, activityOptions, input, workflowTaskStepID(step.ID), "workflow_step_invalid", completedErr)
			}
		}
		var mergeErr error
		evidence, nextCitationIndex, mergeErr = mergeWorkflowEvidence(evidence, completed.Evidence, nextCitationIndex)
		if mergeErr != nil {
			return failWorkflowStage(ctx, activityOptions, input, workflowTaskStepID(step.ID), "workflow_evidence_invalid", mergeErr)
		}
		completedSteps = append(completedSteps, completed)
		remaining = append(remaining[:stepIndex], remaining[stepIndex+1:]...)
		if replanCount >= input.AdmissionSnapshot.AgentBudget.MaxReplans ||
			len(completedSteps) >= input.AdmissionSnapshot.AgentBudget.MaxPlanSteps ||
			!workflowStepNeedsRecoveryReplan(completed, remaining, completedSteps) ||
			!workflowHasRecoveryPath(completedSteps, remaining, input.AdmissionSnapshot.AgentCapabilities) {
			continue
		}
		replanCount++
		replanStage := fmt.Sprintf("solve.replan.%d", replanCount)
		replanResult, replanErr := executeReplanTask(
			ctx,
			activityOptions,
			input,
			plan,
			completedSteps,
			remaining,
			replanCount,
			solveResult,
		)
		if replanErr != nil {
			if workflowExecutionCanceled(ctx, replanErr) {
				return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
			}
			if WorkflowFailureRecoverable(workflowFailureKind(replanErr, "")) {
				continue
			}
			return failWorkflowStage(ctx, activityOptions, input, replanStage, "workflow_replan_failed", replanErr)
		}
		if replanResult.Status == "failed" && replanResult.Failure != nil && WorkflowFailureRecoverable(replanResult.Failure.Code) {
			if replanResult.Failure.Code == "agent_deadline_exceeded" {
				return failWorkflowStage(ctx, activityOptions, input, replanStage, "agent_deadline_exceeded", errors.New("replanner reached request deadline"))
			}
			continue
		}
		if replanResult.Replan == nil {
			return failWorkflowStage(ctx, activityOptions, input, replanStage, "workflow_replan_invalid", errors.New("replanner returned no decision"))
		}
		decision := replanResult.Replan
		if err := ValidateWorkflowReplanDecision(*decision); err != nil {
			return failWorkflowStage(ctx, activityOptions, input, replanStage, "workflow_replan_invalid", err)
		}
		switch decision.Decision {
		case "synthesize":
			remaining = nil
		case "continue":
			if err := ValidateWorkflowRemainingSteps(
				decision.RemainingSteps,
				input.AdmissionSnapshot.AgentBudget.MaxPlanSteps,
				completedSteps,
				input.AdmissionSnapshot.AgentCapabilities,
			); err != nil {
				return failWorkflowStage(ctx, activityOptions, input, replanStage, "workflow_replan_invalid", err)
			}
			remaining = append([]WorkflowTaskPlanStep{}, decision.RemainingSteps...)
			plan = workflowPlanWithCompletedAndRemaining(plan, completedSteps, remaining)
		default:
			return failWorkflowStage(ctx, activityOptions, input, replanStage, "workflow_replan_invalid", fmt.Errorf("unsupported replan decision %q", decision.Decision))
		}
	}
	if !workflowCanSynthesize(evidence, completedSteps) {
		// Preserve a concrete failure code when every attempt failed.
		failureCode := "workflow_evidence_unavailable"
		for _, completed := range completedSteps {
			if completed.Failure != nil {
				failureCode = completed.Failure.Code
			}
			for _, attempt := range completed.SourceAttempts {
				if attempt.Status == "failed" && attempt.FailureCode != "" {
					failureCode = attempt.FailureCode
				}
			}
		}
		return failWorkflowStage(ctx, activityOptions, input, "answer.synthesize", failureCode, errors.New("search ended without materials or a successful source attempt"))
	}
	synthesis, err := executeSynthesizeAnswer(ctx, activityOptions, input, SynthesizeAnswerActivityInput{
		Mode: "planned", RemainingFacts: WorkflowRemainingFactsForSynthesis(completedSteps), Evidence: evidence,
		SourceAttempts:    append(append([]WorkflowSourceAttempt{}, solveResult.SourceAttempts...), WorkflowCompletedSourceAttempts(completedSteps)...),
		SearchSuggestions: workflowSearchSuggestions(solveResult.SearchSuggestions, completedSteps),
	})
	if err != nil {
		if workflowExecutionCanceled(ctx, err) {
			return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
		}
		if finalizeErr := finalizeExecutionFailure(
			ctx,
			activityOptions,
			input,
			"answer.synthesize",
			"workflow_synthesis_failed",
			err,
		); finalizeErr != nil {
			return ToolExecutionWorkflowResult{}, finalizeErr
		}
		return ToolExecutionWorkflowResult{}, err
	}
	if synthesis.Status == "failed" || strings.TrimSpace(synthesis.FinalOutput) == "" {
		return failWorkflowStage(ctx, activityOptions, input, "answer.synthesize", "workflow_synthesis_invalid", errors.New("synthesizer returned empty output"))
	}
	return finalizeWorkflowAnswer(ctx, activityOptions, input, synthesis)
}

func workflowNoMaterialsFailure(output WorkflowOperationActivityOutput) string {
	if output.Failure != nil && output.Failure.Code != "retrieval_budget_exhausted" {
		return output.Failure.Code
	}
	for _, attempt := range output.SourceAttempts {
		if attempt.Status == "failed" && attempt.FailureCode != "" && attempt.FailureCode != "campus_search_result_budget_exhausted" {
			return attempt.FailureCode
		}
	}
	return "materials_insufficient"
}

func workflowStepNeedsRecoveryReplan(completed WorkflowCompletedStep, _ []WorkflowTaskPlanStep, _ []WorkflowCompletedStep) bool {
	if len(completed.RemainingFacts) > 0 || completed.Failure != nil {
		return true
	}
	if len(completed.Evidence) > 0 {
		return false
	}
	for _, attempt := range completed.SourceAttempts {
		if attempt.Status == "failed" || attempt.Status == "no_match" {
			return true
		}
	}
	return false
}

func failedWorkflowStep(
	step WorkflowTaskPlanStep,
	executionIndex int,
	cause error,
) WorkflowCompletedStep {
	failureCode := workflowFailureKind(cause, "workflow_step_failed")
	return WorkflowCompletedStep{
		Evidence:       []WorkflowEvidence{},
		ExecutionIndex: executionIndex,
		Step:           step,
		Summary:        "该资料步骤未完成；最终回答仅基于已经取得的资料。",
		SourceAttempts: []WorkflowSourceAttempt{},
		RemainingFacts: []string{step.Objective},
		Failure:        &ExecutionFailure{Code: failureCode, Operation: "execute_step"},
	}
}

func finalizeWorkflowAnswer(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	workflowResult WorkflowOperationActivityOutput,
) (ToolExecutionWorkflowResult, error) {
	if strings.TrimSpace(workflowResult.FinalOutput) == "" {
		return failWorkflowStage(ctx, activityOptions, input, workflowFinalizationStage(workflowResult), "workflow_answer_invalid", errors.New("workflow answer is empty"))
	}
	finalization, err := executeWorkflowFinalization(ctx, activityOptions, WriteWorkflowFinalizationActivityInput{
		WorkflowResult:    workflowResult,
		AdmissionSnapshot: input.AdmissionSnapshot,
		RequestID:         input.RequestID,
	})
	if err != nil {
		if workflowExecutionCanceled(ctx, err) {
			return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
		}
		if workflowFailureKind(err, "") == "finalization_projection_conflict" {
			return ToolExecutionWorkflowResult{}, err
		}
		if finalizeErr := finalizeExecutionFailure(
			ctx,
			activityOptions,
			input,
			"finalization.write",
			"finalization_failed",
			err,
		); finalizeErr != nil {
			return ToolExecutionWorkflowResult{}, finalizeErr
		}
		return ToolExecutionWorkflowResult{}, err
	}
	// Memory append is a post-answer side effect. Its own activity records a
	// failure without changing the already completed product run. Once product
	// finalization has succeeded, this post-answer work continues even if a
	// cancellation request raced with the finalization activity.
	postFinalizationCtx, postFinalizationCancel := workflow.NewDisconnectedContext(ctx)
	defer postFinalizationCancel()
	_ = executeMemoryAppend(postFinalizationCtx, activityOptions, input)
	return workflowResultFromFinalization(finalization), nil
}

func workflowFinalizationStage(result WorkflowOperationActivityOutput) string {
	if result.Operation == WorkflowOperationSolve {
		return "solve.initial"
	}
	return "answer.synthesize"
}

func validateWorkflowInput(input ToolExecutionWorkflowInput) error {
	if strings.TrimSpace(input.RequestID) == "" || strings.TrimSpace(input.ConversationID) == "" {
		return errors.New("workflow request id and conversation id are required")
	}
	if input.AdmissionSnapshot.AgentBudget.MaxPlanSteps < 1 || input.AdmissionSnapshot.AgentBudget.MaxModelTurns < 1 ||
		input.AdmissionSnapshot.AgentBudget.MaxFunctionToolCalls < 0 || input.AdmissionSnapshot.AgentBudget.MaxReplans < 0 {
		return errors.New("workflow admission budget is invalid")
	}
	return nil
}

func executeSolveTask(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
) (WorkflowOperationActivityOutput, error) {
	var output WorkflowOperationActivityOutput
	err := executeBoundedActivity(
		workflow.WithActivityOptions(ctx, workflowOperationActivityOptions(activityOptions)),
		SolveTaskActivityName,
		SolveTaskActivityInput{
			WorkflowOperationActivityInputBase: workflowOperationActivityInputBase(input),
			MaxSteps:                           input.AdmissionSnapshot.AgentBudget.MaxPlanSteps,
		},
	).Get(ctx, &output)
	return output, err
}

func executeTaskStep(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	plan WorkflowTaskPlan,
	step WorkflowTaskPlanStep,
	completedSteps []WorkflowCompletedStep,
	citationStart int,
	solveResult WorkflowOperationActivityOutput,
) (WorkflowOperationActivityOutput, error) {
	var output WorkflowOperationActivityOutput
	err := executeBoundedActivity(
		workflow.WithActivityOptions(ctx, workflowOperationActivityOptions(activityOptions)),
		ExecuteTaskStepActivityName,
		ExecuteTaskStepActivityInput{
			WorkflowOperationActivityInputBase: workflowOperationActivityInputBase(input),
			Plan:                               plan,
			Step:                               step,
			CompletedSteps:                     append([]WorkflowCompletedStep{}, completedSteps...),
			CitationStart:                      citationStart,
			PriorEvidence:                      solveResult.Evidence,
			PriorSourceAttempts:                solveResult.SourceAttempts,
		},
	).Get(ctx, &output)
	return output, err
}

func executeReplanTask(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	plan WorkflowTaskPlan,
	completedSteps []WorkflowCompletedStep,
	remaining []WorkflowTaskPlanStep,
	replanIndex int,
	solveResult WorkflowOperationActivityOutput,
) (WorkflowOperationActivityOutput, error) {
	var output WorkflowOperationActivityOutput
	err := executeBoundedActivity(
		workflow.WithActivityOptions(ctx, workflowOperationActivityOptions(activityOptions)),
		ReplanTaskActivityName,
		ReplanTaskActivityInput{
			WorkflowOperationActivityInputBase: workflowOperationActivityInputBase(input),
			Plan:                               plan,
			CompletedSteps:                     append([]WorkflowCompletedStep{}, completedSteps...),
			RemainingSteps:                     append([]WorkflowTaskPlanStep{}, remaining...),
			MaxRemainingSteps:                  input.AdmissionSnapshot.AgentBudget.MaxPlanSteps - len(completedSteps),
			ReplanIndex:                        replanIndex,
			PriorEvidence:                      solveResult.Evidence,
			PriorSourceAttempts:                solveResult.SourceAttempts,
		},
	).Get(ctx, &output)
	return output, err
}

func executeSynthesizeAnswer(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	materials SynthesizeAnswerActivityInput,
) (WorkflowOperationActivityOutput, error) {
	materials.WorkflowOperationActivityInputBase = workflowOperationActivityInputBase(input)
	var output WorkflowOperationActivityOutput
	err := executeBoundedActivity(
		workflow.WithActivityOptions(ctx, workflowOperationActivityOptions(activityOptions)),
		SynthesizeAnswerActivityName,
		materials,
	).Get(ctx, &output)
	return output, err
}

func executeWorkflowFinalization(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input WriteWorkflowFinalizationActivityInput,
) (WorkflowFinalizationActivityOutput, error) {
	finalizationOptions := unlimitedFinalizerActivityOptions(30 * time.Second)
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var output WorkflowFinalizationActivityOutput
	err := executeBoundedActivity(finalizationCtx, WriteWorkflowFinalizationActivityName, input).Get(ctx, &output)
	return output, err
}

func workflowOperationActivityInputBase(input ToolExecutionWorkflowInput) WorkflowOperationActivityInputBase {
	return WorkflowOperationActivityInputBase{
		AdmissionSnapshot: input.AdmissionSnapshot,
		ConversationID:    input.ConversationID,
		RequestID:         input.RequestID,
		TraceParent:       input.TraceParent,
	}
}

func workflowOperationActivityOptions(base workflow.ActivityOptions) workflow.ActivityOptions {
	options := base
	options.TaskQueue = ActivityTaskQueueAgent
	options.StartToCloseTimeout = 300 * time.Second
	options.HeartbeatTimeout = 30 * time.Second
	if options.RetryPolicy == nil {
		options.RetryPolicy = &temporal.RetryPolicy{}
	} else {
		policy := *options.RetryPolicy
		policy.NonRetryableErrorTypes = append([]string{}, options.RetryPolicy.NonRetryableErrorTypes...)
		options.RetryPolicy = &policy
	}
	options.RetryPolicy.MaximumAttempts = 0
	return options
}

func nextReadyWorkflowStep(
	remaining []WorkflowTaskPlanStep,
	completed []WorkflowCompletedStep,
) int {
	completedIDs := make(map[string]struct{}, len(completed))
	for _, item := range completed {
		completedIDs[item.Step.ID] = struct{}{}
	}
	for index, step := range remaining {
		ready := true
		for _, dependency := range step.DependsOn {
			if _, done := completedIDs[dependency]; !done {
				ready = false
				break
			}
		}
		if ready {
			return index
		}
	}
	return -1
}

func canonicalCompletedWorkflowStep(
	output WorkflowOperationActivityOutput,
	want WorkflowTaskPlanStep,
	executionIndex int,
) (WorkflowCompletedStep, error) {
	completed := WorkflowCompletedStep{
		Step: want, ExecutionIndex: executionIndex, Summary: output.FinalOutput,
		RemainingFacts:    append([]string{}, output.RemainingFacts...),
		Evidence:          append([]WorkflowEvidence{}, output.Evidence...),
		SourceAttempts:    append([]WorkflowSourceAttempt{}, output.SourceAttempts...),
		SearchSuggestions: append([]SearchSuggestion{}, output.SearchSuggestions...),
	}
	if strings.TrimSpace(completed.Summary) == "" {
		return WorkflowCompletedStep{}, errors.New("executor summary is empty")
	}
	if err := ValidateWorkflowStepOutcome(completed); err != nil {
		return WorkflowCompletedStep{}, err
	}
	return completed, nil
}

func workflowSearchSuggestions(initial []SearchSuggestion, completed []WorkflowCompletedStep) []SearchSuggestion {
	result := append([]SearchSuggestion{}, initial...)
	for _, step := range completed {
		result = append(result, step.SearchSuggestions...)
	}
	return result
}

func WorkflowRemainingFactsForSynthesis(completed []WorkflowCompletedStep) []WorkflowRemainingFacts {
	result := make([]WorkflowRemainingFacts, 0, len(completed))
	for _, item := range completed {
		result = append(result, WorkflowRemainingFacts{Objective: item.Step.Objective, Facts: append([]string{}, item.RemainingFacts...)})
	}
	return result
}

func mergeWorkflowEvidence(
	existing []WorkflowEvidence,
	additional []WorkflowEvidence,
	nextCitationIndex int,
) ([]WorkflowEvidence, int, error) {
	result := append([]WorkflowEvidence{}, existing...)
	seenIDs := make(map[string]struct{}, len(result))
	usedCitations := map[int]struct{}{}
	for _, item := range result {
		if item.ID == "" {
			return nil, nextCitationIndex, errors.New("workflow evidence id is required")
		}
		seenIDs[item.ID] = struct{}{}
		if item.CitationIndex > 0 {
			if _, duplicate := usedCitations[item.CitationIndex]; duplicate {
				return nil, nextCitationIndex, fmt.Errorf("workflow citation index %d is duplicated", item.CitationIndex)
			}
			usedCitations[item.CitationIndex] = struct{}{}
			if item.CitationIndex >= nextCitationIndex {
				nextCitationIndex = item.CitationIndex + 1
			}
		}
	}
	for _, item := range additional {
		if item.ID == "" || item.Title == "" || item.Excerpt == "" {
			return nil, nextCitationIndex, errors.New("workflow evidence fields are required")
		}
		if _, duplicate := seenIDs[item.ID]; duplicate {
			continue
		}
		if item.CitationIndex > 0 {
			if _, duplicate := usedCitations[item.CitationIndex]; duplicate {
				return nil, nextCitationIndex, fmt.Errorf("workflow citation index %d is duplicated", item.CitationIndex)
			}
			usedCitations[item.CitationIndex] = struct{}{}
			if item.CitationIndex >= nextCitationIndex {
				nextCitationIndex = item.CitationIndex + 1
			}
		}
		seenIDs[item.ID] = struct{}{}
		result = append(result, item)
	}
	return result, nextCitationIndex, nil
}

// workflowPlanWithCompletedAndRemaining is the workflow's current plan view.
// A replanner may introduce steps that were not present in the initial plan;
// keeping completed definitions first preserves dependency validation for the
// next executor activity while making the replacement steps part of the
// contract passed to agent-runtime.
func workflowPlanWithCompletedAndRemaining(
	previous WorkflowTaskPlan,
	completed []WorkflowCompletedStep,
	remaining []WorkflowTaskPlanStep,
) WorkflowTaskPlan {
	steps := make([]WorkflowTaskPlanStep, 0, len(completed)+len(remaining))
	for _, item := range completed {
		steps = append(steps, item.Step)
	}
	steps = append(steps, remaining...)
	return WorkflowTaskPlan{
		SchemaVersion: previous.SchemaVersion,
		Goal:          previous.Goal,
		Steps:         steps,
	}
}

func workflowTaskStepID(stepID string) string {
	stepID = strings.TrimSpace(stepID)
	if stepID == "" {
		return "task.step.invalid"
	}
	return "task.step." + stepID
}

func failWorkflowStage(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	stage string,
	fallback string,
	cause error,
) (ToolExecutionWorkflowResult, error) {
	if finalizeErr := finalizeExecutionFailure(ctx, activityOptions, input, stage, fallback, cause); finalizeErr != nil {
		return ToolExecutionWorkflowResult{}, finalizeErr
	}
	return ToolExecutionWorkflowResult{}, cause
}

func PersonalMemoryCommandWorkflow(
	ctx workflow.Context,
	input PersonalMemoryCommandWorkflowInput,
) (PersonalMemoryCommandWorkflowResult, error) {
	providerOptions := personalMemoryCommandProviderActivityOptions(input.Command.CommandKind)
	var result PersonalMemoryCommandActivityOutput
	if err := executePersonalMemoryCommandProvider(ctx, providerOptions, input.Command, &result); err != nil {
		result = PersonalMemoryCommandActivityOutput{
			CommandID: input.Command.CommandID,
			ErrorCode: "personal_memory_command_failed",
			Status:    "failed",
		}
	}
	finalizerOptions := unlimitedFinalizerActivityOptions(15 * time.Second)
	finalizerCtx := workflow.WithActivityOptions(ctx, finalizerOptions)
	if err := executeBoundedActivity(
		finalizerCtx,
		FinalizePersonalMemoryCommandReceiptActivityName,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: input.Command, Result: result},
	).Get(ctx, &result); err != nil {
		return PersonalMemoryCommandWorkflowResult{}, err
	}
	callbackOptions := unlimitedFinalizerActivityOptions(15 * time.Second)
	callbackCtx := workflow.WithActivityOptions(ctx, callbackOptions)
	if err := executeBoundedActivity(
		callbackCtx,
		WritePersonalMemoryCommandResultActivityName,
		result,
	).Get(ctx, nil); err != nil {
		return PersonalMemoryCommandWorkflowResult{}, err
	}
	return PersonalMemoryCommandWorkflowResult(result), nil
}

func executePersonalMemoryCommandProvider(
	ctx workflow.Context,
	options workflow.ActivityOptions,
	command PersonalMemoryCommandRequest,
	result *PersonalMemoryCommandActivityOutput,
) error {
	for {
		providerCtx := workflow.WithActivityOptions(ctx, options)
		err := executeBoundedActivity(
			providerCtx,
			ExecutePersonalMemoryCommandActivityName,
			command,
		).Get(ctx, result)
		if err == nil {
			return nil
		}
		switch workflowFailureKind(err, "personal_memory_command_failed") {
		case "memory_command_owner_blocked", "memory_command_receipt_active":
			if sleepErr := workflow.Sleep(ctx, time.Second); sleepErr != nil {
				return sleepErr
			}
		default:
			return err
		}
	}
}

func personalMemoryCommandProviderActivityOptions(commandKind string) workflow.ActivityOptions {
	options := memoryActivityOptions(defaultActivityOptions(), 0)
	if destructivePersonalMemoryCommand(commandKind) {
		options.RetryPolicy.MaximumAttempts = 0
	} else {
		options.RetryPolicy.MaximumAttempts = 5
	}
	options.RetryPolicy.NonRetryableErrorTypes = append(
		options.RetryPolicy.NonRetryableErrorTypes,
		"memory_command_owner_blocked",
		"memory_command_receipt_active",
	)
	return options
}

func destructivePersonalMemoryCommand(commandKind string) bool {
	switch strings.TrimSpace(commandKind) {
	case "owner_erase", "item_delete", "conversation_prune", "conversation_delete":
		return true
	default:
		return false
	}
}

func unlimitedFinalizerActivityOptions(timeout time.Duration) workflow.ActivityOptions {
	options := defaultActivityOptions()
	options.TaskQueue = ActivityTaskQueueCore
	options.StartToCloseTimeout = timeout
	options.RetryPolicy.MaximumAttempts = 0
	return options
}

func finalizeExecutionFailure(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	stage string,
	fallbackKind string,
	cause error,
) error {
	options := activityOptions
	options.TaskQueue = ActivityTaskQueueCore
	options.StartToCloseTimeout = 30 * time.Second
	options.RetryPolicy = &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2,
		MaximumInterval:    30 * time.Second,
		MaximumAttempts:    0,
	}
	finalizerCtx := workflow.WithActivityOptions(ctx, options)
	return executeBoundedActivity(finalizerCtx, FinalizeExecutionFailureActivityName, FinalizeExecutionFailureActivityInput{
		FailureKind: workflowFailureKind(cause, fallbackKind),
		FailedAt:    workflow.Now(ctx).UTC(),
		RequestID:   input.RequestID,
		Stage:       stage,
	}).Get(ctx, nil)
}

func workflowExecutionCanceled(ctx workflow.Context, cause error) bool {
	return temporal.IsCanceledError(cause) || temporal.IsCanceledError(ctx.Err())
}

func finalizeWorkflowCancellation(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	reason string,
) (ToolExecutionWorkflowResult, error) {
	disconnectedCtx, cancel := workflow.NewDisconnectedContext(ctx)
	defer cancel()
	options := activityOptions
	options.TaskQueue = ActivityTaskQueueCore
	options.StartToCloseTimeout = 30 * time.Second
	options.RetryPolicy = &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2,
		MaximumInterval:    30 * time.Second,
		MaximumAttempts:    0,
	}
	err := executeBoundedActivity(
		workflow.WithActivityOptions(disconnectedCtx, options),
		FinalizeExecutionCancellationActivityName,
		FinalizeExecutionCancellationActivityInput{
			CanceledAt: workflow.Now(disconnectedCtx).UTC(),
			Reason:     reason,
			RequestID:  input.RequestID,
		},
	).Get(disconnectedCtx, nil)
	if err != nil {
		return ToolExecutionWorkflowResult{}, err
	}
	return ToolExecutionWorkflowResult{}, temporal.NewCanceledError(reason)
}

func workflowFailureKind(cause error, fallback string) string {
	kind := ""
	var applicationError *temporal.ApplicationError
	if errors.As(cause, &applicationError) {
		kind = applicationError.Type()
	}
	if !boundedFailureKind(kind) {
		kind = fallback
	}
	if !boundedFailureKind(kind) {
		return "execution_failed"
	}
	return kind
}

func boundedFailureKind(kind string) bool {
	kind = strings.TrimSpace(kind)
	if kind == "" || len(kind) > 64 {
		return false
	}
	for _, char := range kind {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func defaultActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		WaitForCancellation: true,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    3,
		},
	}
}

func executeMemoryAppend(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
) error {
	contextCtx := workflow.WithActivityOptions(
		ctx,
		memoryActivityOptions(activityOptions, input.PersonalMemoryTimeoutSeconds),
	)
	var appendResult AppendConversationMemoryActivityOutput
	return executeBoundedActivity(
		contextCtx,
		AppendConversationMemoryActivityName,
		AppendConversationMemoryActivityInput{
			RequestID: input.RequestID,
		},
	).Get(ctx, &appendResult)
}

func memoryActivityOptions(base workflow.ActivityOptions, timeoutSeconds float64) workflow.ActivityOptions {
	options := base
	options.TaskQueue = ActivityTaskQueueCore
	timeout := time.Duration(timeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = defaultPersonalMemoryActivityTimeoutSeconds * time.Second
	}
	options.StartToCloseTimeout = timeout + 30*time.Second
	options.HeartbeatTimeout = 30 * time.Second
	options.RetryPolicy = &temporal.RetryPolicy{
		InitialInterval:    time.Second,
		BackoffCoefficient: 2,
		MaximumInterval:    10 * time.Second,
		MaximumAttempts:    3,
		NonRetryableErrorTypes: []string{
			"memory_append_request_invalid",
			"memory_projection_invalid",
			"personal_memory_not_configured",
		},
	}
	return options
}

func workflowResultFromFinalization(finalization WorkflowFinalizationActivityOutput) ToolExecutionWorkflowResult {
	return ToolExecutionWorkflowResult(finalization)
}

func ActivityTaskQueueForToolTarget(string) string {
	return ActivityTaskQueueAgent
}
