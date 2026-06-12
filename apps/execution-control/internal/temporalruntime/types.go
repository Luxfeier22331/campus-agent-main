package temporalruntime

import "time"

type CapabilityExecutionWorkflowInput struct {
	ConversationID      string            `json:"conversation_id"`
	Namespace           string            `json:"namespace"`
	PayloadSHA256       string            `json:"payload_sha256"`
	PolicyVersions      map[string]string `json:"policy_versions"`
	RequestID           string            `json:"request_id"`
	RequestedCapability string            `json:"requested_capability"`
	RunID               string            `json:"run_id"`
	TaskQueue           string            `json:"task_queue"`
	TraceID             string            `json:"trace_id"`
	TurnID              string            `json:"turn_id"`
	WorkflowID          string            `json:"workflow_id"`
}

type CapabilityExecutionWorkflowResult struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type MemoryRecallActivityInput struct {
	RequestID           string `json:"request_id"`
	RequestedCapability string `json:"requested_capability"`
	RunID               string `json:"run_id"`
	TraceID             string `json:"trace_id"`
}

type MemoryRecallActivityOutput struct {
	MemoryRef           string `json:"memory_ref"`
	RunID               string `json:"run_id"`
	SelectedMemoryChars int    `json:"selected_memory_chars"`
	SelectedMemoryCount int    `json:"selected_memory_count"`
	Status              string `json:"status"`
}

type PlanRouteActivityInput struct {
	ConversationID      string            `json:"conversation_id"`
	MemoryRef           string            `json:"memory_ref"`
	Namespace           string            `json:"namespace"`
	PayloadSHA256       string            `json:"payload_sha256"`
	PolicyVersions      map[string]string `json:"policy_versions"`
	RequestID           string            `json:"request_id"`
	RequestedCapability string            `json:"requested_capability"`
	RunID               string            `json:"run_id"`
	SelectedMemoryChars int               `json:"selected_memory_chars"`
	SelectedMemoryCount int               `json:"selected_memory_count"`
	TraceID             string            `json:"trace_id"`
	TurnID              string            `json:"turn_id"`
	WorkflowID          string            `json:"workflow_id"`
}

type PlanRouteActivityOutput struct {
	AllowedCapabilities []string               `json:"allowed_capabilities"`
	AllowedTools        []string               `json:"allowed_tools"`
	Capability          string                 `json:"capability"`
	MaxReplans          int                    `json:"max_replans"`
	Payload             map[string]any         `json:"payload"`
	PayloadKind         string                 `json:"payload_kind"`
	PlanRef             string                 `json:"plan_ref"`
	RunID               string                 `json:"run_id"`
	Status              string                 `json:"status"`
	Steps               []CapabilityBranchStep `json:"steps"`
	ToolName            string                 `json:"tool_name"`
	WorkerRole          string                 `json:"worker_role"`
	WorkflowMode        string                 `json:"workflow_mode"`
}

type CapabilityBranchStep struct {
	AllowedTools []string       `json:"allowed_tools"`
	Capability   string         `json:"capability"`
	Payload      map[string]any `json:"payload"`
	PayloadKind  string         `json:"payload_kind"`
	StepID       string         `json:"step_id"`
	ToolName     string         `json:"tool_name"`
	WorkerRole   string         `json:"worker_role"`
}

type PlanReplanActivityInput struct {
	AllowedCapabilities []string `json:"allowed_capabilities"`
	AllowedTools        []string `json:"allowed_tools"`
	FailureSummary      string   `json:"failure_summary"`
	PreviousPlanRef     string   `json:"previous_plan_ref"`
	PreviousStepID      string   `json:"previous_step_id"`
	Reason              string   `json:"reason"`
	ReplanCount         int      `json:"replan_count"`
	RunID               string   `json:"run_id"`
	TraceID             string   `json:"trace_id"`
}

type PlanReplanActivityOutput struct {
	AllowedCapabilities []string               `json:"allowed_capabilities"`
	NewPlanRef          string                 `json:"new_plan_ref"`
	RunID               string                 `json:"run_id"`
	Status              string                 `json:"status"`
	Steps               []CapabilityBranchStep `json:"steps"`
}

type PlanRAGActivityInput struct {
	DependencyResultRefs []string `json:"dependency_result_refs"`
	RunID                string   `json:"run_id"`
	TraceID              string   `json:"trace_id"`
	WorkflowPlanRef      string   `json:"workflow_plan_ref"`
}

type PlanRAGActivityOutput struct {
	PlanRef string `json:"plan_ref"`
	RunID   string `json:"run_id"`
	Status  string `json:"status"`
}

type RetrieveIndexedLookupActivityInput struct {
	RAGPlanRef string `json:"rag_plan_ref"`
	RunID      string `json:"run_id"`
	TraceID    string `json:"trace_id"`
}

type RetrieveIndexedLookupActivityOutput struct {
	LookupRef string `json:"lookup_ref"`
	RunID     string `json:"run_id"`
	Status    string `json:"status"`
}

type ExpandOrRescueRetrievalActivityInput struct {
	LookupRef  string `json:"lookup_ref"`
	RAGPlanRef string `json:"rag_plan_ref"`
	RunID      string `json:"run_id"`
	TraceID    string `json:"trace_id"`
}

type ExpandOrRescueRetrievalActivityOutput struct {
	LookupRef string `json:"lookup_ref"`
	RescueRef string `json:"rescue_ref"`
	RunID     string `json:"run_id"`
	Status    string `json:"status"`
}

type SelectEvidenceActivityInput struct {
	LookupRef  string `json:"lookup_ref"`
	RAGPlanRef string `json:"rag_plan_ref"`
	RescueRef  string `json:"rescue_ref"`
	RunID      string `json:"run_id"`
	TraceID    string `json:"trace_id"`
}

type SelectEvidenceActivityOutput struct {
	EvidenceRef string `json:"evidence_ref"`
	RunID       string `json:"run_id"`
	Status      string `json:"status"`
}

type SynthesizeRAGAnswerActivityInput struct {
	EvidenceRef string `json:"evidence_ref"`
	RAGPlanRef  string `json:"rag_plan_ref"`
	RunID       string `json:"run_id"`
	TraceID     string `json:"trace_id"`
}

type SynthesizeRAGAnswerActivityOutput struct {
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
	SynthesisRef string `json:"synthesis_ref"`
}

type VerifyGroundingActivityInput struct {
	EvidenceRef  string `json:"evidence_ref"`
	RunID        string `json:"run_id"`
	SynthesisRef string `json:"synthesis_ref"`
	TraceID      string `json:"trace_id"`
}

type VerifyGroundingActivityOutput struct {
	GroundingRef string `json:"grounding_ref"`
	RunID        string `json:"run_id"`
	Status       string `json:"status"`
}

type ExecuteTypedToolActivityInput struct {
	AllowedTools []string       `json:"allowed_tools"`
	Capability   string         `json:"capability"`
	Payload      map[string]any `json:"payload"`
	PayloadKind  string         `json:"payload_kind"`
	RoutePlanRef string         `json:"route_plan_ref"`
	RunID        string         `json:"run_id"`
	ToolName     string         `json:"tool_name"`
	TraceID      string         `json:"trace_id"`
	WorkerRole   string         `json:"worker_role"`
}

type ExecuteTypedToolActivityOutput struct {
	Capability  string `json:"capability"`
	PayloadKind string `json:"payload_kind"`
	ResultRef   string `json:"result_ref"`
	RunID       string `json:"run_id"`
	Status      string `json:"status"`
	ToolName    string `json:"tool_name"`
}

type ExecuteAgentAsToolActivityInput struct {
	AdmittedAgentID       string   `json:"admitted_agent_id"`
	AllowedTools          []string `json:"allowed_tools"`
	BudgetRef             string   `json:"budget_ref"`
	ContextProjectionRefs []string `json:"context_projection_refs"`
	RunID                 string   `json:"run_id"`
	StepID                string   `json:"step_id"`
	TimeoutRef            string   `json:"timeout_ref"`
	TraceID               string   `json:"trace_id"`
}

type ExecuteAgentAsToolActivityOutput struct {
	AdmittedAgentID string `json:"admitted_agent_id"`
	ResultRef       string `json:"result_ref"`
	RunID           string `json:"run_id"`
	Status          string `json:"status"`
	StepID          string `json:"step_id"`
}

type WriteFinalizationActivityInput struct {
	GroundingRef       string `json:"grounding_ref"`
	RunID              string `json:"run_id"`
	SelectedCapability string `json:"selected_capability"`
	SelectedTool       string `json:"selected_tool"`
	SynthesisRef       string `json:"synthesis_ref"`
	ToolResultRef      string `json:"tool_result_ref"`
	TraceID            string `json:"trace_id"`
}

type WriteFinalizationActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type CapabilityExecutionWorkflowCancelInput struct {
	Reason     string `json:"reason"`
	RunID      string `json:"run_id"`
	WorkflowID string `json:"workflow_id"`
}
