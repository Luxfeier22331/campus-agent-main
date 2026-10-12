package executioncontract

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
)

const (
	WorkflowTaskQueue      = execution.WorkflowTaskQueue
	ActivityTaskQueueCore  = "campus-agent.agent.tool.v1"
	ActivityTaskQueueAgent = "campus-agent.agent.model.v1"
)

const (
	MemoryAppendOperation      = "memory.append"
	AgentSolveOperation        = "agent.solve"
	AgentExecuteStepOperation  = "agent.execute_step"
	AgentReplanOperation       = "agent.replan"
	AgentSynthesizeOperation   = "agent.synthesize"
	FinalizationWriteOperation = "finalization.write"
)

type WorkflowOperation string

const (
	WorkflowOperationSolve       WorkflowOperation = "solve"
	WorkflowOperationExecuteStep WorkflowOperation = "execute_step"
	WorkflowOperationReplan      WorkflowOperation = "replan"
	WorkflowOperationSynthesize  WorkflowOperation = "synthesize"
)

type WorkflowSource string

const (
	WorkflowSourceCampusSearch         WorkflowSource = "campus_search"
	WorkflowSourceWebSearch            WorkflowSource = "web_search"
	WorkflowSourcePersonalMemoryRecall WorkflowSource = "personal_memory_recall"
)

func ActivityTaskQueueForToolTarget(string) string { return ActivityTaskQueueCore }
