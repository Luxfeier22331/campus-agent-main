package temporalruntime

import "github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"

const (
	WorkflowTaskQueue      = execution.AgentRuntimeWorkflowTaskQueue
	ActivityTaskQueueCore  = "campus-agent.agent.tool.v1"
	ActivityTaskQueueAgent = "campus-agent.agent.model.v1"

	ToolExecutionWorkflowType         = "ToolExecutionWorkflow"
	PersonalMemoryCommandWorkflowType = "PersonalMemoryCommandWorkflow"
)
