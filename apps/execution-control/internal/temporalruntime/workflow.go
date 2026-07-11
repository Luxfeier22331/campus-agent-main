package temporalruntime

import (
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
	requestedTool := strings.TrimSpace(input.RequestedTool)
	memory, err := executeMemoryRecall(ctx, activityOptions, input, requestedTool)
	if err != nil {
		return ToolExecutionWorkflowResult{}, err
	}
	agent, err := executePrimaryAgent(ctx, activityOptions, input, memory, requestedTool)
	if err != nil {
		return ToolExecutionWorkflowResult{}, err
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
		AllowedKnowledgeScopes: nil,
		ConversationID:         input.ConversationID,
		MemoryContext:          memoryContext(memory),
		MemoryProjectionRefs:   memoryProjectionRefs(memory),
		RequestID:              input.RequestID,
		RequestedTool:          requestedTool,
		RunID:                  input.RunID,
		ToolChoice:             primaryAgentToolChoice(requestedTool),
		TraceID:                input.TraceID,
		TurnID:                 input.TurnID,
		VisibleToolNames:       append([]string{}, input.VisibleToolNames...),
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
	return options
}

func memoryActivityOptions(base workflow.ActivityOptions, timeoutSeconds float64) workflow.ActivityOptions {
	options := base
	options.TaskQueue = ActivityTaskQueueCore
	timeout := time.Duration(timeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = defaultPersonalMemoryActivityTimeoutSeconds * time.Second
	}
	options.StartToCloseTimeout = timeout
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
