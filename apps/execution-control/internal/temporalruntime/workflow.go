package temporalruntime

import (
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
	if requestedCapability == "" {
		requestedCapability = "knowledge"
	}
	if err := workflow.ExecuteActivity(contextCtx, MemoryRecallActivityName, MemoryRecallActivityInput{
		RequestID:           input.RequestID,
		RequestedCapability: requestedCapability,
		RunID:               input.RunID,
		TraceID:             input.TraceID,
	}).Get(ctx, &memory); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	var plan PlanRouteActivityOutput
	if err := workflow.ExecuteActivity(contextCtx, PlanRouteActivityName, PlanRouteActivityInput{
		ConversationID:      input.ConversationID,
		MemoryRef:           memory.MemoryRef,
		Namespace:           input.Namespace,
		PayloadSHA256:       input.PayloadSHA256,
		PolicyVersions:      input.PolicyVersions,
		RequestID:           input.RequestID,
		RequestedCapability: requestedCapability,
		RunID:               input.RunID,
		SelectedMemoryChars: memory.SelectedMemoryChars,
		SelectedMemoryCount: memory.SelectedMemoryCount,
		TraceID:             input.TraceID,
		TurnID:              input.TurnID,
		WorkflowID:          input.WorkflowID,
	}).Get(ctx, &plan); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	branchSteps := plan.BranchSteps()
	dependencyResultRefs := []string{}
	var lastToolResult ExecuteTypedToolActivityOutput
	for _, step := range branchSteps {
		if step.Capability == "knowledge" {
			synthesis, grounding, err := executeKnowledgeBranch(
				ctx,
				activityOptions,
				input,
				plan.PlanRef,
				dependencyResultRefs,
			)
			if err != nil {
				return CapabilityExecutionWorkflowResult{}, err
			}
			finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
				GroundingRef:       grounding.GroundingRef,
				RunID:              input.RunID,
				SelectedCapability: plan.Capability,
				SelectedTool:       firstNonEmpty(step.ToolName, plan.ToolName),
				SynthesisRef:       synthesis.SynthesisRef,
				TraceID:            input.TraceID,
			})
			if err != nil {
				return CapabilityExecutionWorkflowResult{}, err
			}
			return workflowResultFromFinalization(finalization), nil
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
			RoutePlanRef: plan.PlanRef,
			RunID:        input.RunID,
			ToolName:     step.ToolName,
			TraceID:      input.TraceID,
			WorkerRole:   step.WorkerRole,
		}).Get(ctx, &toolResult); err != nil {
			return CapabilityExecutionWorkflowResult{}, err
		}
		lastToolResult = toolResult
		if toolResult.ResultRef != "" {
			dependencyResultRefs = append(dependencyResultRefs, toolResult.ResultRef)
		}
	}
	if lastToolResult.ResultRef == "" {
		return CapabilityExecutionWorkflowResult{}, temporal.NewNonRetryableApplicationError(
			"capability branch did not produce a finalizable result",
			"capability_branch_empty",
			nil,
		)
	}
	finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
		RunID:              input.RunID,
		SelectedCapability: lastToolResult.Capability,
		SelectedTool:       lastToolResult.ToolName,
		ToolResultRef:      lastToolResult.ResultRef,
		TraceID:            input.TraceID,
	})
	if err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	return workflowResultFromFinalization(finalization), nil
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
	return CapabilityExecutionWorkflowResult{
		CompletedAt:   finalization.CompletedAt,
		ProjectionRef: finalization.ProjectionRef,
		RunID:         finalization.RunID,
		Status:        finalization.Status,
	}
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
