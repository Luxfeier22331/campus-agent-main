package temporalruntime

const (
	WorkflowTaskQueue                   = "campus-agent.workflow"
	ActivityTaskQueueContext            = "campus-agent.activity.context"
	ActivityTaskQueueAgent              = "campus-agent.activity.agent"
	ActivityTaskQueueKnowledgePlan      = "campus-agent.activity.knowledge.plan"
	ActivityTaskQueueKnowledgeRetrieval = "campus-agent.activity.knowledge.retrieval"
	ActivityTaskQueueKnowledgeSynthesis = "campus-agent.activity.knowledge.synthesis"
	ActivityTaskQueueStructured         = "campus-agent.activity.structured"
	ActivityTaskQueueNotice             = "campus-agent.activity.notice"
	ActivityTaskQueueNavigation         = "campus-agent.activity.navigation"
	ActivityTaskQueueCampusService      = "campus-agent.activity.campus_services"
	ActivityTaskQueueFinalization       = "campus-agent.activity.finalization"
	ActivityTaskQueueProjection         = "campus-agent.activity.projection"

	CapabilityExecutionWorkflowType = "CapabilityExecutionWorkflow"
)
