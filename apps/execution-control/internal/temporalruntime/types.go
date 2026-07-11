package temporalruntime

import "time"

type ToolExecutionWorkflowInput struct {
	ConversationID               string            `json:"conversation_id"`
	Namespace                    string            `json:"namespace"`
	PayloadSHA256                string            `json:"payload_sha256"`
	PolicyVersions               map[string]string `json:"policy_versions"`
	PersonalMemoryTimeoutSeconds float64           `json:"personal_memory_timeout_seconds"`
	RequestID                    string            `json:"request_id"`
	RequestedTool                string            `json:"requested_tool"`
	RunID                        string            `json:"run_id"`
	TaskQueue                    string            `json:"task_queue"`
	TraceID                      string            `json:"trace_id"`
	TurnID                       string            `json:"turn_id"`
	VisibleToolNames             []string          `json:"visible_tool_names"`
	WorkflowID                   string            `json:"workflow_id"`
}

type ToolExecutionWorkflowResult struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type MemoryRecallActivityInput struct {
	RequestID     string `json:"request_id"`
	RequestedTool string `json:"requested_tool"`
	RunID         string `json:"run_id"`
	TraceID       string `json:"trace_id"`
}

type MemoryRecallActivityOutput struct {
	ContextBlock        string   `json:"context_block,omitempty"`
	MemoryRef           string   `json:"memory_ref"`
	Provider            string   `json:"provider,omitempty"`
	RetrievalMode       string   `json:"retrieval_mode,omitempty"`
	RunID               string   `json:"run_id"`
	SchemaVersion       string   `json:"schema_version,omitempty"`
	SelectedMemoryChars int      `json:"selected_memory_chars"`
	SelectedMemoryCount int      `json:"selected_memory_count"`
	SkipReasons         []string `json:"skip_reasons"`
	SkippedCount        int      `json:"skipped_count"`
	Status              string   `json:"status"`
}

type AppendConversationMemoryActivityInput struct {
	RequestID     string `json:"request_id"`
	RequestedTool string `json:"requested_tool"`
	RunID         string `json:"run_id"`
	TraceID       string `json:"trace_id"`
}

type AppendConversationMemoryActivityOutput struct {
	AppendedMessageCount int      `json:"appended_message_count"`
	OperationID          string   `json:"operation_id,omitempty"`
	OperationStatusRef   string   `json:"operation_status_ref,omitempty"`
	PayloadSHA256        string   `json:"payload_sha256"`
	RuntimeDocumentRef   string   `json:"runtime_document_ref,omitempty"`
	RunID                string   `json:"run_id"`
	SchemaVersion        string   `json:"schema_version"`
	SkipReasons          []string `json:"skip_reasons"`
	SkippedCount         int      `json:"skipped_count"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id,omitempty"`
}

type MemoryOperationStatusActivityInput struct {
	OperationID string `json:"operation_id"`
	RequestID   string `json:"request_id"`
	RunID       string `json:"run_id"`
	TraceID     string `json:"trace_id"`
}

type MemoryOperationStatusActivityOutput struct {
	CompletedAt         string         `json:"completed_at,omitempty"`
	CreatedAt           string         `json:"created_at,omitempty"`
	ErrorKind           string         `json:"error_kind,omitempty"`
	OperationID         string         `json:"operation_id"`
	OperationRef        string         `json:"operation_ref,omitempty"`
	OperationType       string         `json:"operation_type,omitempty"`
	PayloadSHA256       string         `json:"payload_sha256"`
	ResultMetadataHash  string         `json:"result_metadata_hash,omitempty"`
	ResultMetadataShape map[string]any `json:"result_metadata_shape,omitempty"`
	RetryCount          int            `json:"retry_count,omitempty"`
	RunID               string         `json:"run_id"`
	SchemaVersion       string         `json:"schema_version"`
	Status              string         `json:"status"`
	UpdatedAt           string         `json:"updated_at,omitempty"`
}

type MemoryReflectActivityInput struct {
	Context        string            `json:"context,omitempty"`
	IncludeBasedOn bool              `json:"include_based_on"`
	Query          string            `json:"query"`
	RequestID      string            `json:"request_id"`
	RunID          string            `json:"run_id"`
	SessionSlots   map[string]string `json:"session_slots,omitempty"`
	TraceID        string            `json:"trace_id"`
}

type MemoryReflectActivityOutput struct {
	BasedOnMemoryItems []MemoryReflectContextItem `json:"based_on_memory_context_items,omitempty"`
	PayloadSHA256      string                     `json:"payload_sha256"`
	Provider           string                     `json:"provider,omitempty"`
	ReflectRef         string                     `json:"reflect_ref"`
	RunID              string                     `json:"run_id"`
	SchemaVersion      string                     `json:"schema_version"`
	Status             string                     `json:"status"`
	StructuredOutput   map[string]any             `json:"structured_output,omitempty"`
	Text               string                     `json:"text,omitempty"`
	ThreadID           string                     `json:"thread_id,omitempty"`
	Usage              MemoryReflectTokenUsage    `json:"usage,omitempty"`
}

type MemoryReflectContextItem struct {
	Tool        string  `json:"tool"`
	CompactText string  `json:"compact_text"`
	MemoryID    string  `json:"memory_id"`
	MemoryType  string  `json:"memory_type"`
	Score       float64 `json:"score,omitempty"`
	UpdatedAt   string  `json:"updated_at"`
}

type MemoryReflectTokenUsage struct {
	CachedTokens int `json:"cached_tokens,omitempty"`
	InputTokens  int `json:"input_tokens,omitempty"`
	OutputTokens int `json:"output_tokens,omitempty"`
	TotalTokens  int `json:"total_tokens,omitempty"`
}

type ExecutePrimaryAgentActivityInput struct {
	AllowedKnowledgeScopes []AllowedKnowledgeScope `json:"allowed_knowledge_scopes,omitempty"`
	ConversationID         string                  `json:"conversation_id"`
	MemoryContext          *MemoryContext          `json:"memory_context,omitempty"`
	MemoryProjectionRefs   []string                `json:"memory_projection_refs"`
	RequestID              string                  `json:"request_id"`
	RequestedTool          string                  `json:"requested_tool"`
	ToolChoice             string                  `json:"tool_choice,omitempty"`
	RunID                  string                  `json:"run_id"`
	TraceID                string                  `json:"trace_id"`
	TurnID                 string                  `json:"turn_id"`
	VisibleToolNames       []string                `json:"visible_tool_names"`
}

type AllowedKnowledgeScope struct {
	AllowedQueryModes []string `json:"allowed_query_modes"`
	Description       string   `json:"description"`
	Scope             string   `json:"scope"`
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
	FailCloseReason string         `json:"fail_close_reason"`
	PayloadKind     string         `json:"payload_kind"`
	Result          map[string]any `json:"result"`
	ResultRef       string         `json:"result_ref"`
	Status          string         `json:"status"`
	ToolName        string         `json:"tool_name"`
}

type ExecutePrimaryAgentActivityOutput struct {
	AgentResultRef         string            `json:"agent_result_ref"`
	DebugTraceRefs         []DebugTraceRef   `json:"debug_trace_refs,omitempty"`
	FinalOutput            string            `json:"final_output"`
	ModelName              string            `json:"model_name"`
	ModelProvider          string            `json:"model_provider"`
	PromptTrace            map[string]any    `json:"prompt_trace,omitempty"`
	ProviderResponseID     string            `json:"provider_response_id"`
	RunID                  string            `json:"run_id"`
	SDKTraceRef            string            `json:"sdk_trace_ref"`
	SelectedTools          []string          `json:"selected_tools"`
	StageTiming            map[string]any    `json:"stage_timing,omitempty"`
	Status                 string            `json:"status"`
	TerminalEnvelope       map[string]any    `json:"terminal_envelope,omitempty"`
	TerminalReason         string            `json:"terminal_reason"`
	ToolResults            []AgentToolResult `json:"tool_results"`
	ToolRuntimeFingerprint map[string]any    `json:"tool_runtime_fingerprint,omitempty"`
	Usage                  AgentUsageSummary `json:"usage"`
}

type DebugTraceRef struct {
	Sink     string `json:"sink"`
	TraceID  string `json:"trace_id,omitempty"`
	TraceRef string `json:"trace_ref"`
	URL      string `json:"url,omitempty"`
}

type AgentUsageSummary struct {
	CachedInputTokens     int64 `json:"cached_input_tokens"`
	EstimatedCostMicroUSD int64 `json:"estimated_cost_micro_usd"`
	InputTokens           int64 `json:"input_tokens"`
	OutputTokens          int64 `json:"output_tokens"`
}

type WriteFinalizationActivityInput struct {
	AgentResultRef string `json:"agent_result_ref"`
	RunID          string `json:"run_id"`
	TraceID        string `json:"trace_id"`
}

type WriteFinalizationActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RunID         string    `json:"run_id"`
	Status        string    `json:"status"`
}

type ToolExecutionWorkflowCancelInput struct {
	Reason     string `json:"reason"`
	RunID      string `json:"run_id"`
	WorkflowID string `json:"workflow_id"`
}
