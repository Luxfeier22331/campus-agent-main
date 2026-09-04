package temporalruntime

import "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"

const (
	WorkflowTaskQueue      = execution.WorkflowTaskQueue
	ActivityTaskQueueCore  = "campus-agent.activity.core.v3"
	ActivityTaskQueueAgent = "campus-agent.activity.agent.v3"

	ToolExecutionWorkflowType         = "ToolExecutionWorkflow"
	PersonalMemoryCommandWorkflowType = "PersonalMemoryCommandWorkflow"
)
