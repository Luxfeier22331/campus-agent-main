package temporalruntime

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const (
	langfuseTraceRetentionPeriod            = 7 * 24 * time.Hour
	langfuseTraceRetentionVerificationDelay = 15 * time.Minute
	langfuseTraceRetentionMaxRounds         = 3
)

func LangfuseTraceRetentionWorkflow(
	ctx workflow.Context,
) (LangfuseTraceRetentionWorkflowResult, error) {
	cutoff := workflow.Now(ctx).UTC().Add(-langfuseTraceRetentionPeriod)
	input := LangfuseTraceRetentionActivityInput{Cutoff: cutoff}
	result := LangfuseTraceRetentionWorkflowResult{Cutoff: cutoff}
	activityCtx := workflow.WithActivityOptions(ctx, langfuseTraceRetentionActivityOptions())

	for round := 1; round <= langfuseTraceRetentionMaxRounds; round++ {
		var purge LangfuseTraceRetentionActivityOutput
		if err := workflow.ExecuteActivity(
			activityCtx,
			PurgeLangfuseTraceRetentionActivityName,
			input,
		).Get(ctx, &purge); err != nil {
			return LangfuseTraceRetentionWorkflowResult{}, err
		}
		result.DeletedRuntimeTraceCount += purge.RuntimeTraceCount
		result.DeletedHindsightTraceCount += purge.HindsightTraceCount

		if err := workflow.Sleep(ctx, langfuseTraceRetentionVerificationDelay); err != nil {
			return LangfuseTraceRetentionWorkflowResult{}, err
		}
		var verification LangfuseTraceRetentionActivityOutput
		if err := workflow.ExecuteActivity(
			activityCtx,
			VerifyLangfuseTraceRetentionActivityName,
			input,
		).Get(ctx, &verification); err != nil {
			return LangfuseTraceRetentionWorkflowResult{}, err
		}
		result.VerificationRounds = round
		if verification.RuntimeTraceCount == 0 && verification.HindsightTraceCount == 0 {
			return result, nil
		}
	}

	return LangfuseTraceRetentionWorkflowResult{}, temporal.NewNonRetryableApplicationError(
		"Langfuse trace retention verification did not converge",
		"langfuse_trace_retention_incomplete",
		nil,
	)
}

func langfuseTraceRetentionActivityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		TaskQueue:           ActivityTaskQueueCore,
		StartToCloseTimeout: 30 * time.Minute,
		HeartbeatTimeout:    30 * time.Second,
		WaitForCancellation: true,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    10 * time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    time.Minute,
			MaximumAttempts:    3,
			NonRetryableErrorTypes: []string{
				"langfuse_trace_retention_invalid",
				"langfuse_trace_maintenance_not_configured",
			},
		},
	}
}
