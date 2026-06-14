package temporalruntime

const (
	MemoryRecallActivityName            = "MemoryRecallActivity"
	ExtractMemoryCandidatesActivityName = "ExtractMemoryCandidatesActivity"
	UpsertInferredMemoryActivityName    = "UpsertInferredMemoryActivity"
	ExecutePrimaryAgentActivityName     = "ExecutePrimaryAgentActivity"
	PlanRouteActivityName               = "PlanRouteActivity"
	PlanReplanActivityName              = "PlanReplanActivity"
	PlanRAGActivityName                 = "KnowledgePlanRAGActivity"
	RetrieveIndexedLookupActivityName   = "KnowledgeRetrieveIndexedLookupActivity"
	ExpandOrRescueRetrievalActivityName = "KnowledgeExpandOrRescueRetrievalActivity"
	SelectEvidenceActivityName          = "KnowledgeSelectEvidenceActivity"
	SynthesizeRAGAnswerActivityName     = "KnowledgeSynthesizeAnswerActivity"
	VerifyGroundingActivityName         = "KnowledgeVerifyGroundingActivity"
	ExecuteTypedToolActivityName        = "ExecuteTypedToolActivity"
	ExecuteAgentAsToolActivityName      = "ExecuteAgentAsToolActivity"
	WriteFinalizationActivityName       = "WriteFinalizationActivity"
)
