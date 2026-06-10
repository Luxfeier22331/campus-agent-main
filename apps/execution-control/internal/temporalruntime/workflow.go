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
	if plan.Capability != "knowledge" {
		branchOptions := activityOptions
		branchOptions.TaskQueue = ActivityTaskQueueForCapability(plan.Capability)
		branchCtx := workflow.WithActivityOptions(ctx, branchOptions)
		var toolResult ExecuteTypedToolActivityOutput
		if err := workflow.ExecuteActivity(branchCtx, ExecuteTypedToolActivityName, ExecuteTypedToolActivityInput{
			AllowedTools: plan.AllowedTools,
			Capability:   plan.Capability,
			Payload:      plan.Payload,
			PayloadKind:  plan.PayloadKind,
			RoutePlanRef: plan.PlanRef,
			RunID:        input.RunID,
			ToolName:     plan.ToolName,
			TraceID:      input.TraceID,
			WorkerRole:   plan.WorkerRole,
		}).Get(ctx, &toolResult); err != nil {
			return CapabilityExecutionWorkflowResult{}, err
		}
		finalizationOptions := activityOptions
		finalizationOptions.StartToCloseTimeout = 30 * time.Second
		finalizationOptions.TaskQueue = ActivityTaskQueueFinalization
		finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
		var finalization WriteFinalizationActivityOutput
		if err := workflow.ExecuteActivity(finalizationCtx, WriteFinalizationActivityName, WriteFinalizationActivityInput{
			RunID:              input.RunID,
			SelectedCapability: toolResult.Capability,
			SelectedTool:       toolResult.ToolName,
			ToolResultRef:      toolResult.ResultRef,
			TraceID:            input.TraceID,
		}).Get(ctx, &finalization); err != nil {
			return CapabilityExecutionWorkflowResult{}, err
		}
		return CapabilityExecutionWorkflowResult{
			CompletedAt:   finalization.CompletedAt,
			ProjectionRef: finalization.ProjectionRef,
			RunID:         finalization.RunID,
			Status:        finalization.Status,
		}, nil
	}
	knowledgeOptions := activityOptions
	knowledgeOptions.TaskQueue = ActivityTaskQueueKnowledge
	knowledgeCtx := workflow.WithActivityOptions(ctx, knowledgeOptions)
	var ragPlan PlanRAGActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, PlanRAGActivityName, PlanRAGActivityInput{
		RunID:           input.RunID,
		TraceID:         input.TraceID,
		WorkflowPlanRef: plan.PlanRef,
	}).Get(ctx, &ragPlan); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	var lookup RetrieveIndexedLookupActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, RetrieveIndexedLookupActivityName, RetrieveIndexedLookupActivityInput{
		RAGPlanRef: ragPlan.PlanRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &lookup); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	var rescue ExpandOrRescueRetrievalActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, ExpandOrRescueRetrievalActivityName, ExpandOrRescueRetrievalActivityInput{
		LookupRef:  lookup.LookupRef,
		RAGPlanRef: ragPlan.PlanRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &rescue); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	var evidence SelectEvidenceActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, SelectEvidenceActivityName, SelectEvidenceActivityInput{
		LookupRef:  lookup.LookupRef,
		RAGPlanRef: ragPlan.PlanRef,
		RescueRef:  rescue.RescueRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &evidence); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	var synthesis SynthesizeRAGAnswerActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, SynthesizeRAGAnswerActivityName, SynthesizeRAGAnswerActivityInput{
		EvidenceRef: evidence.EvidenceRef,
		RAGPlanRef:  ragPlan.PlanRef,
		RunID:       input.RunID,
		TraceID:     input.TraceID,
	}).Get(ctx, &synthesis); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	var grounding VerifyGroundingActivityOutput
	if err := workflow.ExecuteActivity(knowledgeCtx, VerifyGroundingActivityName, VerifyGroundingActivityInput{
		EvidenceRef:  evidence.EvidenceRef,
		RunID:        input.RunID,
		SynthesisRef: synthesis.SynthesisRef,
		TraceID:      input.TraceID,
	}).Get(ctx, &grounding); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	finalizationOptions := activityOptions
	finalizationOptions.StartToCloseTimeout = 30 * time.Second
	finalizationOptions.TaskQueue = ActivityTaskQueueFinalization
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var finalization WriteFinalizationActivityOutput
	if err := workflow.ExecuteActivity(finalizationCtx, WriteFinalizationActivityName, WriteFinalizationActivityInput{
		GroundingRef:       grounding.GroundingRef,
		RunID:              input.RunID,
		SelectedCapability: plan.Capability,
		SelectedTool:       plan.ToolName,
		SynthesisRef:       synthesis.SynthesisRef,
		TraceID:            input.TraceID,
	}).Get(ctx, &finalization); err != nil {
		return CapabilityExecutionWorkflowResult{}, err
	}
	return CapabilityExecutionWorkflowResult{
		CompletedAt:   finalization.CompletedAt,
		ProjectionRef: finalization.ProjectionRef,
		RunID:         finalization.RunID,
		Status:        finalization.Status,
	}, nil
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
