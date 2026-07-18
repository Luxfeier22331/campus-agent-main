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
	requestedTool := strings.TrimSpace(input.RequestedTool)
	memory, err := executeMemoryRecall(ctx, activityOptions, input, requestedTool)
	if err != nil {
		if finalizeErr := finalizeExecutionFailure(
			ctx,
			activityOptions,
			input,
			"memory.recall",
			"memory_recall_failed",
			err,
		); finalizeErr != nil {
			return ToolExecutionWorkflowResult{}, finalizeErr
		}
		return ToolExecutionWorkflowResult{}, err
	}
	agent, err := executePrimaryAgent(ctx, activityOptions, input, memory, requestedTool)
	if err != nil {
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
		AgentResultRef: agent.AgentResultRef,
		FinalizedAt:    workflow.Now(ctx).UTC(),
		RunID:          input.RunID,
		TraceID:        input.TraceID,
	})
	if err != nil {
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
	executeMemoryAppend(ctx, activityOptions, input, requestedTool)
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

func executeMemoryRecall(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	requestedTool string,
) (MemoryRecallActivityOutput, error) {
	contextCtx := workflow.WithActivityOptions(
		ctx,
		memoryActivityOptions(activityOptions, input.PersonalMemoryTimeoutSeconds),
	)
	var memory MemoryRecallActivityOutput
	err := workflow.ExecuteActivity(contextCtx, MemoryRecallActivityName, MemoryRecallActivityInput{
		RequestID:     input.RequestID,
		RequestedTool: requestedTool,
		RunID:         input.RunID,
		TraceID:       input.TraceID,
	}).Get(ctx, &memory)
	return memory, err
}

func executePrimaryAgent(
	ctx workflow.Context,
	activityOptions workflow.ActivityOptions,
	input ToolExecutionWorkflowInput,
	memory MemoryRecallActivityOutput,
	requestedTool string,
) (ExecutePrimaryAgentActivityOutput, error) {
	agentCtx := workflow.WithActivityOptions(ctx, primaryAgentActivityOptions(activityOptions))
	agentInput := ExecutePrimaryAgentActivityInput{
		ConversationID:       input.ConversationID,
		KnowledgeTargets:     nil,
		MemoryContext:        memoryContext(memory),
		MemoryProjectionRefs: memoryProjectionRefs(memory),
		RequestID:            input.RequestID,
		RequestedTool:        requestedTool,
		RunID:                input.RunID,
		ToolChoice:           primaryAgentToolChoice(requestedTool),
		TraceID:              input.TraceID,
		TurnID:               input.TurnID,
		VisibleToolNames:     append([]string{}, input.VisibleToolNames...),
	}
	var agent ExecutePrimaryAgentActivityOutput
	err := workflow.ExecuteActivity(agentCtx, ExecutePrimaryAgentActivityName, agentInput).Get(ctx, &agent)
	return agent, err
}

func primaryAgentToolChoice(requestedTool string) string {
	if strings.TrimSpace(requestedTool) == "knowledge_query" {
		return "knowledge_query"
	}
	return ""
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
	contextCtx := workflow.WithActivityOptions(
		ctx,
		memoryActivityOptions(activityOptions, input.PersonalMemoryTimeoutSeconds),
	)
	var appendResult AppendConversationMemoryActivityOutput
	_ = workflow.ExecuteActivity(
		contextCtx,
		AppendConversationMemoryActivityName,
		AppendConversationMemoryActivityInput{
			RequestID:     input.RequestID,
			RequestedTool: requestedTool,
			RunID:         input.RunID,
			TraceID:       input.TraceID,
		},
	).Get(ctx, &appendResult)
}

func primaryAgentActivityOptions(base workflow.ActivityOptions) workflow.ActivityOptions {
	options := base
	options.TaskQueue = ActivityTaskQueueAgent
	options.StartToCloseTimeout = 180 * time.Second
	options.HeartbeatTimeout = 30 * time.Second
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
			"memory_recall_request_invalid",
			"personal_memory_not_configured",
		},
	}
	return options
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

func ActivityTaskQueueForToolTarget(string) string {
	return ActivityTaskQueueAgent
}
