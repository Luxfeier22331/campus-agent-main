package temporalruntime

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func ChatAnswerWorkflow(
	ctx workflow.Context,
	input ChatAnswerWorkflowInput,
) (ChatAnswerWorkflowResult, error) {
	ragActivityOptions := workflow.ActivityOptions{
		StartToCloseTimeout: 60 * time.Second,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    10 * time.Second,
			MaximumAttempts:    3,
		},
		TaskQueue: ActivityTaskQueueRAG,
	}
	ragCtx := workflow.WithActivityOptions(ctx, ragActivityOptions)
	var memory MemoryRecallActivityOutput
	requestedCapability := input.RequestedCapability
	if requestedCapability == "" {
		requestedCapability = "knowledge"
	}
	if err := workflow.ExecuteActivity(ragCtx, MemoryRecallActivityName, MemoryRecallActivityInput{
		RequestID:           input.RequestID,
		RequestedCapability: requestedCapability,
		RunID:               input.RunID,
		TraceID:             input.TraceID,
	}).Get(ctx, &memory); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var plan PlanChatAnswerActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, PlanChatAnswerActivityName, PlanChatAnswerActivityInput{
		ConversationID: input.ConversationID,
		Namespace:      input.Namespace,
		PayloadSHA256:  input.PayloadSHA256,
		PolicyVersions: input.PolicyVersions,
		RequestID:      input.RequestID,
		RunID:          input.RunID,
		TraceID:        input.TraceID,
		TurnID:         input.TurnID,
		WorkflowID:     input.WorkflowID,
	}).Get(ctx, &plan); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var ragPlan PlanRAGActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, PlanRAGActivityName, PlanRAGActivityInput{
		RunID:           input.RunID,
		TraceID:         input.TraceID,
		WorkflowPlanRef: plan.PlanRef,
	}).Get(ctx, &ragPlan); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var lookup RetrieveIndexedLookupActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, RetrieveIndexedLookupActivityName, RetrieveIndexedLookupActivityInput{
		RAGPlanRef: ragPlan.PlanRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &lookup); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var rescue ExpandOrRescueRetrievalActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, ExpandOrRescueRetrievalActivityName, ExpandOrRescueRetrievalActivityInput{
		LookupRef:  lookup.LookupRef,
		RAGPlanRef: ragPlan.PlanRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &rescue); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var evidence SelectEvidenceActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, SelectEvidenceActivityName, SelectEvidenceActivityInput{
		LookupRef:  lookup.LookupRef,
		RAGPlanRef: ragPlan.PlanRef,
		RescueRef:  rescue.RescueRef,
		RunID:      input.RunID,
		TraceID:    input.TraceID,
	}).Get(ctx, &evidence); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var synthesis SynthesizeRAGAnswerActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, SynthesizeRAGAnswerActivityName, SynthesizeRAGAnswerActivityInput{
		EvidenceRef: evidence.EvidenceRef,
		RAGPlanRef:  ragPlan.PlanRef,
		RunID:       input.RunID,
		TraceID:     input.TraceID,
	}).Get(ctx, &synthesis); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var grounding VerifyGroundingActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, VerifyGroundingActivityName, VerifyGroundingActivityInput{
		EvidenceRef:  evidence.EvidenceRef,
		RunID:        input.RunID,
		SynthesisRef: synthesis.SynthesisRef,
		TraceID:      input.TraceID,
	}).Get(ctx, &grounding); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	finalizationOptions := ragActivityOptions
	finalizationOptions.StartToCloseTimeout = 30 * time.Second
	finalizationOptions.TaskQueue = ActivityTaskQueueFinalization
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var finalization WriteFinalizationActivityOutput
	if err := workflow.ExecuteActivity(finalizationCtx, WriteFinalizationActivityName, WriteFinalizationActivityInput{
		GroundingRef: grounding.GroundingRef,
		RunID:        input.RunID,
		SynthesisRef: synthesis.SynthesisRef,
		TraceID:      input.TraceID,
	}).Get(ctx, &finalization); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	return ChatAnswerWorkflowResult{
		CompletedAt:   finalization.CompletedAt,
		ProjectionRef: finalization.ProjectionRef,
		RunID:         finalization.RunID,
		Status:        finalization.Status,
	}, nil
}
