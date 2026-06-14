package temporalruntime

import (
	"fmt"
	"strings"
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func CapabilityExecutionWorkflow(
	ctx workflow.Context,
	input CapabilityExecutionWorkflowInput,
) (CapabilityExecutionWorkflowResult, error) {
	activityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    3,
		},
	}
	contextOptions := activityOptions
	contextOptions.TaskQueue = ActivityTaskQueueContext
	contextCtx := workflow.WithActivityOptions(ctx, contextOptions)
	var memory MemoryRecallActivityOutput
	requestedCapability := input.RequestedCapability
	if err := workflow.ExecuteActivity(contextCtx, MemoryRecallActivityName, MemoryRecallActivityInput{
		RequestID:           input.RequestID,
		RequestedCapability: requestedCapability,
		RunID:               input.RunID,
		TraceID:             input.TraceID,
	}).Get(ctx, &memory); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	agent, err := executePrimaryAgentWithBoundedReplan(ctx, activityOptions, input, memory, requestedCapability)
	if err != nil {
		return CapabilityExecutionWorkflowResult{}, err
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
			return CapabilityExecutionWorkflowResult{}, err
		}
		finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
			GroundingRef: grounding.GroundingRef,
			RunID:        input.RunID,
			SynthesisRef: synthesis.SynthesisRef,
			TraceID:      input.TraceID,
		})
		if err != nil {
			return CapabilityExecutionWorkflowResult{}, err
		}
		executeMemoryUpdate(ctx, activityOptions, input, requestedCapability)
		return workflowResultFromFinalization(finalization), nil
	}
	finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
		AgentResultRef: agent.AgentResultRef,
		RunID:          input.RunID,
		TraceID:        input.TraceID,
	})
	if err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	executeMemoryUpdate(ctx, activityOptions, input, requestedCapability)
	return workflowResultFromFinalization(finalization), nil
}

func executeMemoryUpdate(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input CapabilityExecutionWorkflowInput,
	requestedCapability string,
) {
	contextOptions := activityOptions
	contextOptions.TaskQueue = ActivityTaskQueueContext
	contextCtx := workflow.WithActivityOptions(ctx, contextOptions)
	extractInput := ExtractMemoryCandidatesActivityInput{
		RequestID:           input.RequestID,
		RequestedCapability: requestedCapability,
		RunID:               input.RunID,
		TraceID:             input.TraceID,
	}
	var extract ExtractMemoryCandidatesActivityOutput
	if err := workflow.ExecuteActivity(
		contextCtx,
		ExtractMemoryCandidatesActivityName,
		extractInput,
	).Get(ctx, &extract); err != nil {
		return
	}
	if len(extract.Candidates) == 0 {
		return
	}
	var upsert UpsertInferredMemoryActivityOutput
	_ = workflow.ExecuteActivity(
		contextCtx,
		UpsertInferredMemoryActivityName,
		UpsertInferredMemoryActivityInput{
			Candidates:          extract.Candidates,
			RequestID:           input.RequestID,
			RequestedCapability: requestedCapability,
			RunID:               input.RunID,
			TraceID:             input.TraceID,
		},
	).Get(ctx, &upsert)
}

func executePrimaryAgentWithBoundedReplan(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input CapabilityExecutionWorkflowInput,
	memory MemoryRecallActivityOutput,
	requestedCapability string,
) (ExecutePrimaryAgentActivityOutput, error) {
	agentOptions := activityOptions
	agentOptions.TaskQueue = ActivityTaskQueueAgent
	agentCtx := workflow.WithActivityOptions(ctx, agentOptions)
	visibleCapabilities := visibleCapabilitiesForPrimaryAgent(requestedCapability)
	agentInput := ExecutePrimaryAgentActivityInput{
		ConversationID:       input.ConversationID,
		MemoryProjectionRefs: memoryProjectionRefs(memory),
		RequestID:            input.RequestID,
		RequestedCapability:  requestedCapability,
		RunID:                input.RunID,
		TraceID:              input.TraceID,
		TurnID:               input.TurnID,
		VisibleCapabilities:  visibleCapabilities,
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

func visibleCapabilitiesForPrimaryAgent(requestedCapability string) []string {
	switch strings.TrimSpace(requestedCapability) {
	case "knowledge":
		return []string{"knowledge"}
	case "campus_services":
		return []string{"campus_services"}
	case "notice":
		return []string{"notice"}
	case "place_lookup", "navigation":
		return []string{"navigation"}
	case "":
		return []string{"knowledge", "campus_services", "notice"}
	default:
		return []string{}
	}
}

type capabilityBranchExecutionResult struct {
	GroundingRef       string
	SelectedCapability string
	SelectedTool       string
	SynthesisRef       string
	ToolResultRef      string
	RunID              string
}

func (r capabilityBranchExecutionResult) FinalizationInput(traceID string) WriteFinalizationActivityInput {
	return WriteFinalizationActivityInput{
		GroundingRef:       r.GroundingRef,
		RunID:              r.RunID,
		SelectedCapability: r.SelectedCapability,
		SelectedTool:       r.SelectedTool,
		SynthesisRef:       r.SynthesisRef,
		ToolResultRef:      r.ToolResultRef,
		TraceID:            traceID,
	}
}

func executeCapabilityBranchWithReplan(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input CapabilityExecutionWorkflowInput,
	plan PlanRouteActivityOutput,
) (capabilityBranchExecutionResult, error) {
	currentSteps := plan.BranchSteps()
	currentPlanRef := plan.PlanRef
	replanCount := 0
	for {
		result, failedStep, err := executeCapabilityBranchOnce(
			ctx,
			activityOptions,
			input,
			plan.Capability,
			plan.ToolName,
			currentPlanRef,
			currentSteps,
		)
		if err == nil {
			return result, nil
		}
		if !workflowFailureAllowsReplan(failedStep, err) {
			return capabilityBranchExecutionResult{}, err
		}
		if replanCount >= plan.MaxReplans {
			return capabilityBranchExecutionResult{}, err
		}
		replanCount++
		replan, replanErr := executePlanReplan(ctx, activityOptions, PlanReplanActivityInput{
			AllowedCapabilities: allowedCapabilitiesForReplan(plan),
			AllowedTools:        allowedToolsForReplan(plan, currentSteps),
			FailureSummary:      sanitizeWorkflowFailure(err),
			PreviousPlanRef:     currentPlanRef,
			PreviousStepID:      failedStep.StepID,
			Reason:              reasonForReplanFailure(failedStep, err),
			ReplanCount:         replanCount,
			RunID:               input.RunID,
			TraceID:             input.TraceID,
		})
		if replanErr != nil {
			return capabilityBranchExecutionResult{}, replanErr
		}
		if err := validateReplanWithinBounds(plan, currentSteps, replan); err != nil {
			return capabilityBranchExecutionResult{}, err
		}
		currentSteps = replan.Steps
		currentPlanRef = replan.NewPlanRef
	}
}

func executeCapabilityBranchOnce(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input CapabilityExecutionWorkflowInput,
	selectedCapability string,
	selectedTool string,
	planRef string,
	branchSteps []CapabilityBranchStep,
) (capabilityBranchExecutionResult, CapabilityBranchStep, error) {
	dependencyResultRefs := []string{}
	var lastToolResult ExecuteTypedToolActivityOutput
	for _, step := range branchSteps {
		if step.Capability == "knowledge" {
			synthesis, grounding, err := executeKnowledgeBranch(
				ctx,
				activityOptions,
				input,
				planRef,
				dependencyResultRefs,
			)
			if err != nil {
				return capabilityBranchExecutionResult{}, step, err
			}
			return capabilityBranchExecutionResult{
				GroundingRef:       grounding.GroundingRef,
				RunID:              input.RunID,
				SelectedCapability: firstNonEmpty(selectedCapability, step.Capability),
				SelectedTool:       firstNonEmpty(step.ToolName, selectedTool),
				SynthesisRef:       synthesis.SynthesisRef,
			}, CapabilityBranchStep{}, nil
		}
		branchOptions := activityOptions
		branchOptions.TaskQueue = ActivityTaskQueueForCapability(step.Capability)
		branchCtx := workflow.WithActivityOptions(ctx, branchOptions)
		var toolResult ExecuteTypedToolActivityOutput
		if err := workflow.ExecuteActivity(branchCtx, ExecuteTypedToolActivityName, ExecuteTypedToolActivityInput{
			AllowedTools: step.AllowedTools,
			Capability:   step.Capability,
			Payload:      step.Payload,
			PayloadKind:  step.PayloadKind,
			RoutePlanRef: planRef,
			RunID:        input.RunID,
			ToolName:     step.ToolName,
			TraceID:      input.TraceID,
			WorkerRole:   step.WorkerRole,
		}).Get(ctx, &toolResult); err != nil {
			return capabilityBranchExecutionResult{}, step, err
		}
		lastToolResult = toolResult
		if toolResult.ResultRef != "" {
			dependencyResultRefs = append(dependencyResultRefs, toolResult.ResultRef)
		}
	}
	if lastToolResult.ResultRef == "" {
		return capabilityBranchExecutionResult{}, CapabilityBranchStep{}, temporal.NewNonRetryableApplicationError(
			"capability branch did not produce a finalizable result",
			"capability_branch_empty",
			nil,
		)
	}
	return capabilityBranchExecutionResult{
		RunID:              input.RunID,
		SelectedCapability: lastToolResult.Capability,
		SelectedTool:       lastToolResult.ToolName,
		ToolResultRef:      lastToolResult.ResultRef,
	}, CapabilityBranchStep{}, nil
}

func executePlanReplan(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input PlanReplanActivityInput,
) (PlanReplanActivityOutput, error) {
	replanOptions := activityOptions
	replanOptions.TaskQueue = ActivityTaskQueueContext
	replanCtx := workflow.WithActivityOptions(ctx, replanOptions)
	var output PlanReplanActivityOutput
	err := workflow.ExecuteActivity(replanCtx, PlanReplanActivityName, input).Get(ctx, &output)
	return output, err
}

func allowedCapabilitiesForReplan(plan PlanRouteActivityOutput) []string {
	if len(plan.AllowedCapabilities) > 0 {
		return append([]string{}, plan.AllowedCapabilities...)
	}
	capabilities := []string{}
	seen := map[string]bool{}
	for _, step := range plan.BranchSteps() {
		if step.Capability != "" && !seen[step.Capability] {
			seen[step.Capability] = true
			capabilities = append(capabilities, step.Capability)
		}
	}
	if len(capabilities) == 0 && plan.Capability != "" {
		capabilities = append(capabilities, plan.Capability)
	}
	return capabilities
}

func allowedToolsForReplan(plan PlanRouteActivityOutput, steps []CapabilityBranchStep) []string {
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
	currentSteps []CapabilityBranchStep,
	replan PlanReplanActivityOutput,
) error {
	allowedCapabilities := setFromStrings(allowedCapabilitiesForReplan(original))
	allowedTools := setFromStrings(allowedToolsForReplan(original, currentSteps))
	for _, capability := range replan.AllowedCapabilities {
		if strings.TrimSpace(capability) != "" && !allowedCapabilities[capability] {
			return fmt.Errorf("replan expanded capability: %s", capability)
		}
	}
	for _, step := range replan.Steps {
		if strings.TrimSpace(step.Capability) != "" && !allowedCapabilities[step.Capability] {
			return fmt.Errorf("replan expanded capability: %s", step.Capability)
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
	input CapabilityExecutionWorkflowInput,
	workflowPlanRef string,
	dependencyResultRefs []string,
) (SynthesizeRAGAnswerActivityOutput, VerifyGroundingActivityOutput, error) {
	knowledgeOptions := activityOptions
	knowledgeOptions.TaskQueue = ActivityTaskQueueKnowledge
	knowledgeCtx := workflow.WithActivityOptions(ctx, knowledgeOptions)
	var ragPlan PlanRAGActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, PlanRAGActivityName, PlanRAGActivityInput{
		DependencyResultRefs: append([]string{}, dependencyResultRefs...),
		RunID:                input.RunID,
		TraceID:              input.TraceID,
		WorkflowPlanRef:      workflowPlanRef,
	}).Get(ctx, &ragPlan); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var lookup RetrieveIndexedLookupActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, RetrieveIndexedLookupActivityName, RetrieveIndexedLookupActivityInput{
		RAGPlanRef: ragPlan.PlanRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &lookup); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var rescue ExpandOrRescueRetrievalActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, ExpandOrRescueRetrievalActivityName, ExpandOrRescueRetrievalActivityInput{
		LookupRef:  lookup.LookupRef,
		RAGPlanRef: ragPlan.PlanRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &rescue); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var evidence SelectEvidenceActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, SelectEvidenceActivityName, SelectEvidenceActivityInput{
		LookupRef:  lookup.LookupRef,
		RAGPlanRef: ragPlan.PlanRef,
		RescueRef:  rescue.RescueRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &evidence); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var synthesis SynthesizeRAGAnswerActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, SynthesizeRAGAnswerActivityName, SynthesizeRAGAnswerActivityInput{
		EvidenceRef: evidence.EvidenceRef,
		RAGPlanRef:  ragPlan.PlanRef,
		RunID:       input.RunID,
		TraceID:     input.TraceID,
	}).Get(ctx, &synthesis); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	var grounding VerifyGroundingActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, VerifyGroundingActivityName, VerifyGroundingActivityInput{
		EvidenceRef:  evidence.EvidenceRef,
		RunID:        input.RunID,
		SynthesisRef: synthesis.SynthesisRef,
		TraceID:      input.TraceID,
	}).Get(ctx, &grounding); err != nil {
		return SynthesizeRAGAnswerActivityOutput{}, VerifyGroundingActivityOutput{}, err
	}
	return synthesis, grounding, nil
}

func executeFinalization(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input WriteFinalizationActivityInput,
) (WriteFinalizationActivityOutput, error) {
	finalizationOptions := activityOptions
	finalizationOptions.StartToCloseTimeout = 30 * time.Second
	finalizationOptions.TaskQueue = ActivityTaskQueueFinalization
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var finalization WriteFinalizationActivityOutput
	err := workflow.ExecuteActivity(finalizationCtx, WriteFinalizationActivityName, input).Get(ctx, &finalization)
	return finalization, err
}

func workflowResultFromFinalization(finalization WriteFinalizationActivityOutput) CapabilityExecutionWorkflowResult {
	return CapabilityExecutionWorkflowResult(finalization)
}

func ActivityTaskQueueForCapability(capability string) string {
	switch capability {
	case "campus_services":
		return ActivityTaskQueueCampusService
	case "notice":
		return ActivityTaskQueueNotice
	case "navigation", "place_lookup":
		return ActivityTaskQueueNavigation
	case "knowledge", "":
		return ActivityTaskQueueKnowledge
	default:
		return ActivityTaskQueueStructured
	}
}

func (p PlanRouteActivityOutput) BranchSteps() []CapabilityBranchStep {
	if len(p.Steps) > 0 {
		steps := make([]CapabilityBranchStep, 0, len(p.Steps))
		for _, step := range p.Steps {
			steps = append(steps, step.Clone())
		}
		return steps
	}
	return []CapabilityBranchStep{{
		AllowedTools: append([]string{}, p.AllowedTools...),
		Capability:   p.Capability,
		Payload:      cloneMap(p.Payload),
		PayloadKind:  p.PayloadKind,
		ToolName:     p.ToolName,
		WorkerRole:   p.WorkerRole,
	}}
}

func (s CapabilityBranchStep) Clone() CapabilityBranchStep {
	return CapabilityBranchStep{
		AllowedTools: append([]string{}, s.AllowedTools...),
		Capability:   s.Capability,
		Payload:      cloneMap(s.Payload),
		PayloadKind:  s.PayloadKind,
		StepID:       s.StepID,
		ToolName:     s.ToolName,
		WorkerRole:   s.WorkerRole,
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
