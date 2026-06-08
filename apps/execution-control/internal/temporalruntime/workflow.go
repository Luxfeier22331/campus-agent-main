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
	var bridge InvokeSemanticWorkerActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, InvokeSemanticWorkerActivityName, InvokeSemanticWorkerActivityInput{
		PlanRef: plan.PlanRef,
		RunID:   input.RunID,
		TraceID: input.TraceID,
	}).Get(ctx, &bridge); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	var synthesis SynthesizeRAGAnswerActivityOutput
	if err := workflow.ExecuteActivity(ragCtx, SynthesizeRAGAnswerActivityName, SynthesizeRAGAnswerActivityInput{
		BridgeRef: bridge.BridgeRef,
		PlanRef:   plan.PlanRef,
		RunID:     input.RunID,
		TraceID:   input.TraceID,
	}).Get(ctx, &synthesis); err != nil {
		return ChatAnswerWorkflowResult{}, err
	}
	finalizationOptions := ragActivityOptions
	finalizationOptions.StartToCloseTimeout = 30 * time.Second
	finalizationOptions.TaskQueue = ActivityTaskQueueFinalization
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var finalization FinalizeChatAnswerActivityOutput
	if err := workflow.ExecuteActivity(finalizationCtx, FinalizeChatAnswerActivityName, FinalizeChatAnswerActivityInput{
		BridgeRef: synthesis.BridgeRef,
		PlanRef:   plan.PlanRef,
		RunID:     input.RunID,
		TraceID:   input.TraceID,
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
