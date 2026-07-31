package temporalruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

const defaultPersonalMemoryActivityTimeoutSeconds = 90

const (
	personalMemoryEraseExporterDrainDelay = 10 * time.Minute
	personalMemoryEraseRetryDelay         = time.Minute
	personalMemoryEraseMaxRounds          = 5
)

func ToolExecutionWorkflow(
	ctx workflow.Context,
	input ToolExecutionWorkflowInput,
) (ToolExecutionWorkflowResult, error) {
	activityOptions := defaultActivityOptions()
	groundingContext := GroundingContext{}
	if input.AdmissionSnapshot.GroundingPlan.Mode != "none" {
		grounding, err := prepareGroundingContext(ctx, activityOptions, input)
		if err != nil {
			if workflowExecutionCanceled(ctx, err) {
				return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
			}
			if finalizeErr := finalizeExecutionFailure(
				ctx,
				activityOptions,
				input,
				"grounding.prepare",
				"retrieval_unavailable",
				err,
			); finalizeErr != nil {
				return ToolExecutionWorkflowResult{}, finalizeErr
			}
			return ToolExecutionWorkflowResult{}, err
		}
		groundingContext = grounding.GroundingContext
	}
	agent, err := executePrimaryAgent(ctx, activityOptions, input, groundingContext)
	if err != nil {
		if workflowExecutionCanceled(ctx, err) {
			return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
		}
		if finalizeErr := finalizeExecutionFailure(
			ctx,
			activityOptions,
			input,
			"agent.primary",
			"agent_runtime_failed",
			err,
		); finalizeErr != nil {
			return ToolExecutionWorkflowResult{}, finalizeErr
		}
		return ToolExecutionWorkflowResult{}, err
	}
	finalization, err := executeFinalization(ctx, activityOptions, WriteFinalizationActivityInput{
		AgentResult:       agent,
		AdmissionSnapshot: input.AdmissionSnapshot,
		FinalizedAt:       workflow.Now(ctx).UTC(),
		RunID:             input.RunID,
		TraceID:           input.TraceID,
	})
	if err != nil {
		if workflowExecutionCanceled(ctx, err) {
			return finalizeWorkflowCancellation(ctx, activityOptions, input, "user_requested")
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
	if result.Status == "succeeded" && strings.TrimSpace(input.Command.CommandKind) == "owner_erase" {
		if err := executePersonalMemoryTraceErase(ctx, input.Command); err != nil {
			result = PersonalMemoryCommandActivityOutput{
				CommandID: input.Command.CommandID,
				ErrorCode: "personal_memory_trace_erase_failed",
				Status:    "failed",
			}
		}
	}
	finalizerOptions := unlimitedFinalizerActivityOptions(15 * time.Second)
	finalizerCtx := workflow.WithActivityOptions(ctx, finalizerOptions)
	if err := workflow.ExecuteActivity(
		finalizerCtx,
		FinalizePersonalMemoryCommandReceiptActivityName,
		FinalizePersonalMemoryCommandReceiptActivityInput{Command: input.Command, Result: result},
	).Get(ctx, &result); err != nil {
		return PersonalMemoryCommandWorkflowResult{}, err
	}
	callbackOptions := unlimitedFinalizerActivityOptions(15 * time.Second)
	callbackCtx := workflow.WithActivityOptions(ctx, callbackOptions)
	if err := workflow.ExecuteActivity(
		callbackCtx,
		WritePersonalMemoryCommandResultActivityName,
		result,
	).Get(ctx, nil); err != nil {
		return PersonalMemoryCommandWorkflowResult{}, err
	}
	return result, nil
}

func executePersonalMemoryTraceErase(
	ctx workflow.Context,
	command memoryruntime.PersonalMemoryCommandRequest,
) error {
	if err := workflow.Sleep(ctx, personalMemoryEraseExporterDrainDelay); err != nil {
		return err
	}
	return purgeAndVerifyPersonalMemoryTraces(ctx, command)
}

func purgeAndVerifyPersonalMemoryTraces(
	ctx workflow.Context,
	command memoryruntime.PersonalMemoryCommandRequest,
) error {
	options := boundedPersonalMemoryTraceMaintenanceActivityOptions()
	activityCtx := workflow.WithActivityOptions(ctx, options)
	input := PersonalMemoryTraceMaintenanceActivityInput{Command: command}
	for round := 1; round <= personalMemoryEraseMaxRounds; round++ {
		if err := workflow.ExecuteActivity(
			activityCtx,
			PurgePersonalMemoryTracesActivityName,
			input,
		).Get(ctx, nil); err != nil {
			return err
		}
		var verification PersonalMemoryTraceMaintenanceActivityOutput
		if err := workflow.ExecuteActivity(
			activityCtx,
			VerifyPersonalMemoryTracesActivityName,
			input,
		).Get(ctx, &verification); err != nil {
			return err
		}
		if verification.RemainingTraceCount == 0 {
			return nil
		}
		if round < personalMemoryEraseMaxRounds {
			if err := workflow.Sleep(ctx, personalMemoryEraseRetryDelay); err != nil {
				return err
			}
		}
	}
	return temporal.NewNonRetryableApplicationError(
		"Personal memory trace erase did not converge",
		"personal_memory_trace_erase_incomplete",
		nil,
	)
}

func boundedPersonalMemoryTraceMaintenanceActivityOptions() workflow.ActivityOptions {
	options := defaultActivityOptions()
	options.TaskQueue = ActivityTaskQueueCore
	options.StartToCloseTimeout = 2 * time.Minute
	options.ScheduleToCloseTimeout = 5 * time.Minute
	options.HeartbeatTimeout = 30 * time.Second
	options.RetryPolicy.MaximumAttempts = 3
	options.RetryPolicy.InitialInterval = 10 * time.Second
	options.RetryPolicy.MaximumInterval = 30 * time.Second
	options.RetryPolicy.NonRetryableErrorTypes = append(
		options.RetryPolicy.NonRetryableErrorTypes,
		"memory_command_invalid",
		"memory_trace_maintenance_invalid",
	)
	return options
}

func executePersonalMemoryCommandProvider(
	ctx workflow.Context,
	options workflow.ActivityOptions,
	command memoryruntime.PersonalMemoryCommandRequest,
	result *PersonalMemoryCommandActivityOutput,
) error {
	for {
		providerCtx := workflow.WithActivityOptions(ctx, options)
		err := workflow.ExecuteActivity(
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
	return workflow.ExecuteActivity(finalizerCtx, FinalizeExecutionFailureActivityName, FinalizeExecutionFailureActivityInput{
		FailureHash: workflowFailureHash(cause),
		FailureKind: workflowFailureKind(cause, fallbackKind),
		FailedAt:    workflow.Now(ctx).UTC(),
		RunID:       input.RunID,
		Stage:       stage,
		TraceID:     input.TraceID,
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
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(disconnectedCtx, options),
		FinalizeExecutionCancellationActivityName,
		FinalizeExecutionCancellationActivityInput{
			CanceledAt: workflow.Now(disconnectedCtx).UTC(),
			Reason:     reason,
			RunID:      input.RunID,
			TraceID:    input.TraceID,
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

func workflowFailureHash(cause error) string {
	if cause == nil {
		return ""
	}
	var applicationError *temporal.ApplicationError
	if errors.As(cause, &applicationError) && applicationError.HasDetails() {
		var failureHash string
		if err := applicationError.Details(&failureHash); err == nil && validFailureHash(failureHash) {
			return failureHash
		}
	}
	sum := sha256.Sum256([]byte(cause.Error()))
	return hex.EncodeToString(sum[:])
}

func validFailureHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
}

func executePrimaryAgent(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	groundingContext GroundingContext,
) (ExecutePrimaryAgentActivityOutput, error) {
	agentCtx := workflow.WithActivityOptions(ctx, primaryAgentActivityOptions(activityOptions))
	agentInput := ExecutePrimaryAgentActivityInput{
		AdmissionSnapshot: input.AdmissionSnapshot,
		ConversationID:    input.ConversationID,
		GroundingContext:  groundingContext,
		RequestID:         input.RequestID,
		RunID:             input.RunID,
		TraceID:           input.TraceID,
		TurnID:            input.TurnID,
		VisibleToolNames:  append([]string{}, input.AdmissionSnapshot.ExecutionStrategy.VisibleToolNames...),
	}
	var agent ExecutePrimaryAgentActivityOutput
	err := workflow.ExecuteActivity(agentCtx, ExecutePrimaryAgentActivityName, agentInput).Get(ctx, &agent)
	return agent, err
}

func prepareGroundingContext(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
) (PrepareGroundingContextActivityOutput, error) {
	options := activityOptions
	options.TaskQueue = ActivityTaskQueueAgent
	options.StartToCloseTimeout = 90 * time.Second
	options.HeartbeatTimeout = 30 * time.Second
	groundingCtx := workflow.WithActivityOptions(ctx, options)
	var output PrepareGroundingContextActivityOutput
	err := workflow.ExecuteActivity(
		groundingCtx,
		PrepareGroundingContextActivityName,
		PrepareGroundingContextActivityInput{
			AdmissionSnapshot:       input.AdmissionSnapshot,
			AdmissionSnapshotSHA256: input.AdmissionSnapshotSHA256,
			RunID:                   input.RunID,
			TraceID:                 input.TraceID,
		},
	).Get(ctx, &output)
	return output, err
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
	return workflow.ExecuteActivity(
		contextCtx,
		AppendConversationMemoryActivityName,
		AppendConversationMemoryActivityInput{
			RequestID: input.RequestID,
			RunID:     input.RunID,
			TraceID:   input.TraceID,
		},
	).Get(ctx, &appendResult)
}

func primaryAgentActivityOptions(base workflow.ActivityOptions) workflow.ActivityOptions {
	options := base
	options.TaskQueue = ActivityTaskQueueAgent
	options.StartToCloseTimeout = 180 * time.Second
	options.HeartbeatTimeout = 30 * time.Second
	if options.RetryPolicy == nil {
		options.RetryPolicy = &temporal.RetryPolicy{}
	} else {
		// ActivityOptions is copied by value, but RetryPolicy is a pointer. Keep
		// the provider-specific single-attempt policy from mutating the base
		// options later used by finalization and other activities.
		policy := *options.RetryPolicy
		policy.NonRetryableErrorTypes = append([]string{}, options.RetryPolicy.NonRetryableErrorTypes...)
		options.RetryPolicy = &policy
	}
	// Receipt fencing makes provider invocation single-shot. Retries are kept
	// unlimited so a completed receipt can repair downstream projections;
	// uncertain or deterministic failures are returned as non-retryable by the
	// activity implementation.
	options.RetryPolicy.MaximumAttempts = 0
	return options
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

func executeFinalization(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input WriteFinalizationActivityInput,
) (WriteFinalizationActivityOutput, error) {
	finalizationOptions := unlimitedFinalizerActivityOptions(30 * time.Second)
	finalizationCtx := workflow.WithActivityOptions(ctx, finalizationOptions)
	var finalization WriteFinalizationActivityOutput
	err := workflow.ExecuteActivity(finalizationCtx, WriteFinalizationActivityName, input).Get(ctx, &finalization)
	return finalization, err
}

func workflowResultFromFinalization(finalization WriteFinalizationActivityOutput) ToolExecutionWorkflowResult {
	return ToolExecutionWorkflowResult(finalization)
}

func ActivityTaskQueueForToolTarget(string) string {
	return ActivityTaskQueueAgent
}
