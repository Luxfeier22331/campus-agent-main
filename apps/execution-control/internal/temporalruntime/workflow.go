package temporalruntime

import (
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func ToolExecutionWorkflow(
	ctx workflow.Context,
	input ToolExecutionWorkflowInput,
) (ToolExecutionWorkflowResult, error) {
	activityOptions := defaultActivityOptions()
	contextOptions := activityOptions
	contextOptions.TaskQueue = ActivityTaskQueueCore
	contextCtx := workflow.WithActivityOptions(ctx, contextOptions)
	var memory MemoryRecallActivityOutput
	requestedTool := input.RequestedTool
	if err := workflow.ExecuteActivity(contextCtx, MemoryRecallActivityName, MemoryRecallActivityInput{
		RequestID:     input.RequestID,
		RequestedTool: requestedTool,
		RunID:         input.RunID,
		TraceID:       input.TraceID,
	}).Get(ctx, &memory); err != nil {
		return ToolExecutionWorkflowResult{}, err
	}
	agent, err := executePrimaryAgentWithBoundedReplan(ctx, activityOptions, input, memory, requestedTool)
	if err != nil {
		return ToolExecutionWorkflowResult{}, err
	}
	if primaryAgentSelectedKnowledge(agent) {
		synthesis, grounding, err := executeKnowledgeBranch(
			ctx,
			activityOptions,
			input,
			agent.AgentResultRef,
			[]string{agent.AgentResultRef},
		)
		if err != nil {
			return ToolExecutionWorkflowResult{}, err
		}
		finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
			GroundingRef: grounding.GroundingRef,
			RunID:        input.RunID,
			SynthesisRef: synthesis.SynthesisRef,
			TraceID:      input.TraceID,
		})
		if err != nil {
			return ToolExecutionWorkflowResult{}, err
		}
		executeMemoryAppend(ctx, activityOptions, input, requestedTool)
		return workflowResultFromFinalization(finalization), nil
	}
	finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
		AgentResultRef: agent.AgentResultRef,
		RunID:          input.RunID,
		TraceID:        input.TraceID,
	})
	if err != nil {
		return ToolExecutionWorkflowResult{}, err
	}
	executeMemoryAppend(ctx, activityOptions, input, requestedTool)
	return workflowResultFromFinalization(finalization), nil
}

func defaultActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
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
	requestedTool string,
) {
	contextOptions := activityOptions
	contextOptions.TaskQueue = ActivityTaskQueueCore
	contextCtx := workflow.WithActivityOptions(ctx, contextOptions)
	appendInput := AppendConversationMemoryActivityInput{
		RequestID:     input.RequestID,
		RequestedTool: requestedTool,
		RunID:         input.RunID,
		TraceID:       input.TraceID,
	}
	var appendResult AppendConversationMemoryActivityOutput
	_ = workflow.ExecuteActivity(
		contextCtx,
		AppendConversationMemoryActivityName,
		appendInput,
	).Get(ctx, &appendResult)
}

func executePrimaryAgentWithBoundedReplan(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	memory MemoryRecallActivityOutput,
	requestedTool string,
) (ExecutePrimaryAgentActivityOutput, error) {
	agentOptions := primaryAgentActivityOptions(activityOptions)
	agentCtx := workflow.WithActivityOptions(ctx, agentOptions)
	agentInput := ExecutePrimaryAgentActivityInput{
		ConversationID:       input.ConversationID,
		MemoryContext:        memoryContext(memory),
		MemoryProjectionRefs: memoryProjectionRefs(memory),
		RequestID:            input.RequestID,
		RequestedTool:        requestedTool,
		RunID:                input.RunID,
		TraceID:              input.TraceID,
		TurnID:               input.TurnID,
		VisibleToolNames:     append([]string{}, input.VisibleToolNames...),
	}
	var agent ExecutePrimaryAgentActivityOutput
	if err := workflow.ExecuteActivity(agentCtx, ExecutePrimaryAgentActivityName, agentInput).Get(ctx, &agent); err != nil {
		return ExecutePrimaryAgentActivityOutput{}, err
	}
	if !primaryAgentAllowsBoundedReplan(agent) {
		return agent, nil
	}
	var retry ExecutePrimaryAgentActivityOutput
	retryInput := agentInput
	retryInput.Attempt = 2
	retryInput.ReplanReason = primaryAgentReplanReason(agent)
	if err := workflow.ExecuteActivity(agentCtx, ExecutePrimaryAgentActivityName, retryInput).Get(ctx, &retry); err != nil {
		return ExecutePrimaryAgentActivityOutput{}, err
	}
	return retry, nil
}

func primaryAgentActivityOptions(base workflow.ActivityOptions) workflow.ActivityOptions {
	options := base
	options.TaskQueue = ActivityTaskQueueAgent
	options.StartToCloseTimeout = 180 * time.Second
	return options
}

func primaryAgentSelectedKnowledge(agent ExecutePrimaryAgentActivityOutput) bool {
	for _, tool := range agent.SelectedTools {
		switch strings.TrimSpace(tool) {
		case "knowledge_query":
			return true
		}
	}
	for _, result := range agent.ToolResults {
		if strings.TrimSpace(result.ToolName) == "knowledge_query" {
			return true
		}
		if signal, ok := result.Result["workflow_signal"].(string); ok &&
			strings.TrimSpace(signal) == "knowledge_query" {
			return true
		}
	}
	return false
}

func memoryProjectionRefs(memory MemoryRecallActivityOutput) []string {
	if strings.TrimSpace(memory.MemoryRef) == "" {
		return nil
	}
	return []string{memory.MemoryRef}
}

func memoryContext(memory MemoryRecallActivityOutput) *MemoryContext {
	if strings.TrimSpace(memory.ContextBlock) == "" || strings.TrimSpace(memory.MemoryRef) == "" {
		return nil
	}
	return &MemoryContext{
		ContextBlock:        memory.ContextBlock,
		MemoryRef:           memory.MemoryRef,
		Provider:            memory.Provider,
		RetrievalMode:       memory.RetrievalMode,
		SchemaVersion:       memory.SchemaVersion,
		SelectedMemoryChars: memory.SelectedMemoryChars,
		SelectedMemoryCount: memory.SelectedMemoryCount,
	}
}

type toolBranchExecutionResult struct {
	GroundingRef  string
	SelectedTool  string
	SynthesisRef  string
	ToolResultRef string
	RunID         string
}

func (r toolBranchExecutionResult) FinalizationInput(traceID string) WriteFinalizationActivityInput {
	return WriteFinalizationActivityInput{
		GroundingRef:  r.GroundingRef,
		RunID:         r.RunID,
		SelectedTool:  r.SelectedTool,
		SynthesisRef:  r.SynthesisRef,
		ToolResultRef: r.ToolResultRef,
		TraceID:       traceID,
	}
}

func executeToolBranchWithReplan(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	plan PlanRouteActivityOutput,
) (toolBranchExecutionResult, error) {
	currentSteps := plan.BranchSteps()
	currentPlanRef := plan.PlanRef
	replanCount := 0
	for {
		result, failedStep, err := executeToolBranchOnce(
			ctx,
			activityOptions,
			input,
			plan.ToolTarget,
			plan.ToolName,
			currentPlanRef,
			currentSteps,
		)
		if err == nil {
			return result, nil
		}
		if !workflowFailureAllowsReplan(failedStep, err) {
			return toolBranchExecutionResult{}, err
		}
		if replanCount >= plan.MaxReplans {
			return toolBranchExecutionResult{}, err
		}
		replanCount++
		replan, replanErr := executePlanReplan(ctx, activityOptions, PlanReplanActivityInput{
			AllowedToolTargets: allowedToolTargetsForReplan(plan),
			AllowedTools:       allowedToolsForReplan(plan, currentSteps),
			FailureSummary:     sanitizeWorkflowFailure(err),
			PreviousPlanRef:    currentPlanRef,
			PreviousStepID:     failedStep.StepID,
			Reason:             reasonForReplanFailure(failedStep, err),
			ReplanCount:        replanCount,
			RunID:              input.RunID,
			TraceID:            input.TraceID,
		})
		if replanErr != nil {
			return toolBranchExecutionResult{}, replanErr
		}
		if err := validateReplanWithinBounds(plan, currentSteps, replan); err != nil {
			return toolBranchExecutionResult{}, err
		}
		currentSteps = replan.Steps
		currentPlanRef = replan.NewPlanRef
	}
}

func executeToolBranchOnce(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	selectedToolTarget string,
	selectedTool string,
	planRef string,
	branchSteps []ToolBranchStep,
) (toolBranchExecutionResult, ToolBranchStep, error) {
	dependencyResultRefs := []string{}
	var lastToolResult ExecuteTypedToolActivityOutput
	for _, step := range branchSteps {
		if step.ToolTarget == "knowledge_query" {
			synthesis, grounding, err := executeKnowledgeBranch(
				ctx,
				activityOptions,
				input,
				planRef,
				dependencyResultRefs,
			)
			if err != nil {
				return toolBranchExecutionResult{}, step, err
			}
			return toolBranchExecutionResult{
				GroundingRef: grounding.GroundingRef,
				RunID:        input.RunID,
				SelectedTool: firstNonEmpty(step.ToolName, selectedTool),
				SynthesisRef: synthesis.SynthesisRef,
			}, ToolBranchStep{}, nil
		}
		branchOptions := activityOptions
		branchOptions.TaskQueue = ActivityTaskQueueForToolTarget(step.ToolTarget)
		branchCtx := workflow.WithActivityOptions(ctx, branchOptions)
		var toolResult ExecuteTypedToolActivityOutput
		if err := workflow.ExecuteActivity(branchCtx, ExecuteTypedToolActivityName, ExecuteTypedToolActivityInput{
			AllowedTools: step.AllowedTools,
			Payload:      step.Payload,
			PayloadKind:  step.PayloadKind,
			RoutePlanRef: planRef,
			RunID:        input.RunID,
			ToolName:     step.ToolName,
			ToolTarget:   step.ToolTarget,
			TraceID:      input.TraceID,
			TaskQueue:    step.TaskQueue,
		}).Get(ctx, &toolResult); err != nil {
			return toolBranchExecutionResult{}, step, err
		}
		lastToolResult = toolResult
		if toolResult.ResultRef != "" {
			dependencyResultRefs = append(dependencyResultRefs, toolResult.ResultRef)
		}
	}
	if lastToolResult.ResultRef == "" {
		return toolBranchExecutionResult{}, ToolBranchStep{}, temporal.NewNonRetryableApplicationError(
			"tool branch did not produce a finalizable result",
			"tool_branch_empty",
			nil,
		)
	}
	return toolBranchExecutionResult{
		RunID:         input.RunID,
		SelectedTool:  lastToolResult.ToolName,
		ToolResultRef: lastToolResult.ResultRef,
	}, ToolBranchStep{}, nil
}

func executePlanReplan(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input PlanReplanActivityInput,
) (PlanReplanActivityOutput, error) {
	replanOptions := activityOptions
	replanOptions.TaskQueue = ActivityTaskQueueCore
	replanCtx := workflow.WithActivityOptions(ctx, replanOptions)
	var output PlanReplanActivityOutput
	err := workflow.ExecuteActivity(replanCtx, PlanReplanActivityName, input).Get(ctx, &output)
	return output, err
}

func allowedToolTargetsForReplan(plan PlanRouteActivityOutput) []string {
	if len(plan.AllowedToolTargets) > 0 {
		return append([]string{}, plan.AllowedToolTargets...)
	}
	targets := []string{}
	seen := map[string]bool{}
	for _, step := range plan.BranchSteps() {
		if step.ToolTarget != "" && !seen[step.ToolTarget] {
			seen[step.ToolTarget] = true
			targets = append(targets, step.ToolTarget)
		}
	}
	if len(targets) == 0 && plan.ToolTarget != "" {
		targets = append(targets, plan.ToolTarget)
	}
	return targets
}

func allowedToolsForReplan(plan PlanRouteActivityOutput, steps []ToolBranchStep) []string {
	tools := []string{}
	seen := map[string]bool{}
	appendTool := func(tool string) {
		tool = strings.TrimSpace(tool)
		if tool != "" && !seen[tool] {
			seen[tool] = true
			tools = append(tools, tool)
		}
	}
	for _, tool := range plan.AllowedTools {
		appendTool(tool)
	}
	for _, step := range steps {
		for _, tool := range step.AllowedTools {
			appendTool(tool)
		}
		appendTool(step.ToolName)
	}
	return tools
}

func validateReplanWithinBounds(
	original PlanRouteActivityOutput,
	currentSteps []ToolBranchStep,
	replan PlanReplanActivityOutput,
) error {
	allowedToolTargets := setFromStrings(allowedToolTargetsForReplan(original))
	allowedTools := setFromStrings(allowedToolsForReplan(original, currentSteps))
	for _, target := range replan.AllowedToolTargets {
		if strings.TrimSpace(target) != "" && !allowedToolTargets[target] {
			return fmt.Errorf("replan expanded tool target: %s", target)
		}
	}
	for _, step := range replan.Steps {
		if strings.TrimSpace(step.ToolTarget) != "" && !allowedToolTargets[step.ToolTarget] {
			return fmt.Errorf("replan expanded tool target: %s", step.ToolTarget)
		}
		for _, tool := range step.AllowedTools {
			if strings.TrimSpace(tool) != "" && !allowedTools[tool] {
				return fmt.Errorf("replan expanded tool: %s", tool)
			}
		}
		if strings.TrimSpace(step.ToolName) != "" && !allowedTools[step.ToolName] {
			return fmt.Errorf("replan expanded tool: %s", step.ToolName)
		}
	}
	if strings.TrimSpace(replan.NewPlanRef) == "" {
		return fmt.Errorf("replan new_plan_ref is required")
	}
	if len(replan.Steps) == 0 {
		return fmt.Errorf("replan steps are required")
	}
	return nil
}

func setFromStrings(values []string) map[string]bool {
	result := map[string]bool{}
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result[value] = true
		}
	}
	return result
}

func sanitizeWorkflowFailure(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if len(message) > 240 {
		return message[:240]
	}
	return message
}

func executeKnowledgeBranch(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	workflowPlanRef string,
	dependencyResultRefs []string,
) (SynthesizeRAGAnswerActivityOutput, VerifyGroundingActivityOutput, error) {
	var ragPlan PlanRAGActivityOutput
	if err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, knowledgeActivityOptions(activityOptions, PlanRAGActivityName)),
		PlanRAGActivityName,
		PlanRAGActivityInput{
			DependencyResultRefs: append([]string{}, dependencyResultRefs...),
			RunID:                input.RunID,
			TraceID:              input.TraceID,
			WorkflowPlanRef:      workflowPlanRef,
		}).Get(ctx, &ragPlan); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var lookup RetrieveIndexedLookupActivityOutput
	if err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, knowledgeActivityOptions(activityOptions, RetrieveIndexedLookupActivityName)),
		RetrieveIndexedLookupActivityName,
		RetrieveIndexedLookupActivityInput{
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      input.RunID,
			TraceID:    input.TraceID,
		}).Get(ctx, &lookup); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var rescue ExpandOrRescueRetrievalActivityOutput
	if err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, knowledgeActivityOptions(activityOptions, ExpandOrRescueRetrievalActivityName)),
		ExpandOrRescueRetrievalActivityName,
		ExpandOrRescueRetrievalActivityInput{
			LookupRef:  lookup.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RunID:      input.RunID,
			TraceID:    input.TraceID,
		}).Get(ctx, &rescue); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var evidence SelectEvidenceActivityOutput
	if err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, knowledgeActivityOptions(activityOptions, SelectEvidenceActivityName)),
		SelectEvidenceActivityName,
		SelectEvidenceActivityInput{
			LookupRef:  lookup.LookupRef,
			RAGPlanRef: ragPlan.PlanRef,
			RescueRef:  rescue.RescueRef,
			RunID:      input.RunID,
			TraceID:    input.TraceID,
		}).Get(ctx, &evidence); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var synthesis SynthesizeRAGAnswerActivityOutput
	if err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, knowledgeActivityOptions(activityOptions, SynthesizeRAGAnswerActivityName)),
		SynthesizeRAGAnswerActivityName,
		SynthesizeRAGAnswerActivityInput{
			EvidenceRef: evidence.EvidenceRef,
			RAGPlanRef:  ragPlan.PlanRef,
			RunID:       input.RunID,
			TraceID:     input.TraceID,
		}).Get(ctx, &synthesis); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var grounding VerifyGroundingActivityOutput
	if err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, knowledgeActivityOptions(activityOptions, VerifyGroundingActivityName)),
		VerifyGroundingActivityName,
		VerifyGroundingActivityInput{
			EvidenceRef:  evidence.EvidenceRef,
			RunID:        input.RunID,
			SynthesisRef: synthesis.SynthesisRef,
			TraceID:      input.TraceID,
		}).Get(ctx, &grounding); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	return synthesis, grounding, nil
}

func knowledgeActivityOptions(base workflow.ActivityOptions, activityName string) workflow.ActivityOptions {
	options := base
	options.TaskQueue = KnowledgeActivityTaskQueueForActivity(activityName)
	return options
}

func KnowledgeActivityTaskQueueForActivity(activityName string) string {
	switch activityName {
	case PlanRAGActivityName, SelectEvidenceActivityName, VerifyGroundingActivityName:
		return ActivityTaskQueueKnowledge
	case RetrieveIndexedLookupActivityName, ExpandOrRescueRetrievalActivityName:
		return ActivityTaskQueueKnowledge
	case SynthesizeRAGAnswerActivityName:
		return ActivityTaskQueueKnowledge
	default:
		return ActivityTaskQueueCore
	}
}

func executeFinalization(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input WriteFinalizationActivityInput,
) (WriteFinalizationActivityOutput, error) {
	finalizationOptions := activityOptions
	finalizationOptions.StartToCloseTimeout = 30 * time.Second
	finalizationOptions.TaskQueue = ActivityTaskQueueCore
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var finalization WriteFinalizationActivityOutput
	err := workflow.ExecuteActivity(finalizationCtx, WriteFinalizationActivityName, input).Get(ctx, &finalization)
	return finalization, err
}

func workflowResultFromFinalization(finalization WriteFinalizationActivityOutput) ToolExecutionWorkflowResult {
	return ToolExecutionWorkflowResult(finalization)
}

func ActivityTaskQueueForToolTarget(toolTarget string) string {
	switch toolTarget {
	case "transport_schedule_lookup":
		return ActivityTaskQueueCore
	case "campus_notice_discover", "campus_notice_change_set_lookup", "campus_notice_period_summary", "campus_notice_get":
		return ActivityTaskQueueCore
	case "place_lookup":
		return ActivityTaskQueueCore
	case "knowledge_query", "":
		return ActivityTaskQueueKnowledge
	default:
		return ActivityTaskQueueCore
	}
}

func (p PlanRouteActivityOutput) BranchSteps() []ToolBranchStep {
	if len(p.Steps) > 0 {
		steps := make([]ToolBranchStep, 0, len(p.Steps))
		for _, step := range p.Steps {
			steps = append(steps, step.Clone())
		}
		return steps
	}
	return []ToolBranchStep{{
		AllowedTools: append([]string{}, p.AllowedTools...),
		Payload:      cloneMap(p.Payload),
		PayloadKind:  p.PayloadKind,
		ToolName:     p.ToolName,
		ToolTarget:   p.ToolTarget,
		TaskQueue:    p.TaskQueue,
	}}
}

func (s ToolBranchStep) Clone() ToolBranchStep {
	return ToolBranchStep{
		AllowedTools: append([]string{}, s.AllowedTools...),
		Payload:      cloneMap(s.Payload),
		PayloadKind:  s.PayloadKind,
		StepID:       s.StepID,
		ToolName:     s.ToolName,
		ToolTarget:   s.ToolTarget,
		TaskQueue:    s.TaskQueue,
	}
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
