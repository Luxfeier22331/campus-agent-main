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
	ContextBlock        string `json:"context_block,omitempty"`
	MemoryRef           string `json:"memory_ref"`
	Provider            string `json:"provider,omitempty"`
	RetrievalMode       string `json:"retrieval_mode,omitempty"`
	RunID               string `json:"run_id"`
	SchemaVersion       string `json:"schema_version,omitempty"`
	SelectedMemoryChars int    `json:"selected_memory_chars"`
	SelectedMemoryCount int    `json:"selected_memory_count"`
	Status              string `json:"status"`
}

type AppendConversationMemoryActivityInput struct {
	RequestID           string `json:"request_id"`
	RequestedCapability string `json:"requested_capability"`
	RunID               string `json:"run_id"`
	TraceID             string `json:"trace_id"`
}

type AppendConversationMemoryActivityOutput struct {
	AppendedMessageCount int      `json:"appended_message_count"`
	PayloadSHA256        string   `json:"payload_sha256"`
	RunID                string   `json:"run_id"`
	SchemaVersion        string   `json:"schema_version"`
	SkipReasons          []string `json:"skip_reasons"`
	SkippedCount         int      `json:"skipped_count"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id,omitempty"`
}

type ExecutePrimaryAgentActivityInput struct {
	Attempt              int            `json:"attempt"`
	ConversationID       string         `json:"conversation_id"`
	InputRef             string         `json:"input_ref"`
	MemoryContext        *MemoryContext `json:"memory_context,omitempty"`
	MemoryProjectionRefs []string       `json:"memory_projection_refs"`
	ReplanReason         string         `json:"replan_reason"`
	RequestID            string         `json:"request_id"`
	RequestedCapability  string         `json:"requested_capability"`
	RunID                string         `json:"run_id"`
	TraceID              string         `json:"trace_id"`
	TurnID               string         `json:"turn_id"`
	VisibleCapabilities  []string       `json:"visible_capabilities"`
}

type MemoryContext struct {
	ContextBlock        string `json:"context_block"`
	MemoryRef           string `json:"memory_ref"`
	Provider            string `json:"provider,omitempty"`
	RetrievalMode       string `json:"retrieval_mode,omitempty"`
	SchemaVersion       string `json:"schema_version"`
	SelectedMemoryChars int    `json:"selected_memory_chars"`
	SelectedMemoryCount int    `json:"selected_memory_count"`
}

type AgentToolResult struct {
	ArgumentsJSON   map[string]any `json:"arguments_json"`
	Capability      string         `json:"capability"`
	FailCloseReason string         `json:"fail_close_reason"`
	PayloadKind     string         `json:"payload_kind"`
	Result          map[string]any `json:"result"`
	ResultRef       string         `json:"result_ref"`
	Status          string         `json:"status"`
	ToolName        string         `json:"tool_name"`
}

type ExecutePrimaryAgentActivityOutput struct {
	AgentResultRef     string            `json:"agent_result_ref"`
	FinalOutput        string            `json:"final_output"`
	ProviderResponseID string            `json:"provider_response_id"`
	RunID              string            `json:"run_id"`
	SDKTraceRef        string            `json:"sdk_trace_ref"`
	SelectedTools      []string          `json:"selected_tools"`
	Status             string            `json:"status"`
	TerminalReason     string            `json:"terminal_reason"`
	ToolResults        []AgentToolResult `json:"tool_results"`
	Usage              AgentUsageSummary `json:"usage"`
}

type AgentUsageSummary struct {
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	EstimatedCostMicroUSD int64 `json:"estimated_cost_micro_usd"`
	InputTokens           int64 `json:"input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
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
	AgentResultRef     string `json:"agent_result_ref"`
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
