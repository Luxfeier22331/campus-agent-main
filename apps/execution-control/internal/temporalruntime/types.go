package temporalruntime

import (
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

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
	PayloadSHA256        string   `json:"payload_sha256"`
	RunID                string   `json:"run_id"`
	SchemaVersion        string   `json:"schema_version"`
	SkipReasons          []string `json:"skip_reasons"`
	SkippedCount         int      `json:"skipped_count"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id,omitempty"`
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
	ConversationID       string            `json:"conversation_id"`
	KnowledgeTargets     []KnowledgeTarget `json:"knowledge_targets,omitempty"`
	MemoryContext        *MemoryContext    `json:"memory_context,omitempty"`
	MemoryProjectionRefs []string          `json:"memory_projection_refs"`
	RequestID            string            `json:"request_id"`
	RequestedTool        string            `json:"requested_tool"`
	ToolChoice           string            `json:"tool_choice,omitempty"`
	RunID                string            `json:"run_id"`
	TraceID              string            `json:"trace_id"`
	TurnID               string            `json:"turn_id"`
	VisibleToolNames     []string          `json:"visible_tool_names"`
}

type KnowledgeTarget struct {
	Description string `json:"description"`
	Target      string `json:"target"`
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
	FinalOutput            string            `json:"final_output"`
	ModelName              string            `json:"model_name"`
	ModelProvider          string            `json:"model_provider"`
	PromptTrace            map[string]any    `json:"prompt_trace,omitempty"`
	ProviderResponseID     string            `json:"provider_response_id"`
	RunID                  string            `json:"run_id"`
	SelectedTools          []string          `json:"selected_tools"`
	StageTiming            map[string]any    `json:"stage_timing,omitempty"`
	Status                 string            `json:"status"`
	TerminalEnvelope       map[string]any    `json:"terminal_envelope,omitempty"`
	TerminalReason         string            `json:"terminal_reason"`
	ToolResults            []AgentToolResult `json:"tool_results"`
	ToolRuntimeFingerprint map[string]any    `json:"tool_runtime_fingerprint,omitempty"`
	Usage                  AgentUsageSummary `json:"usage"`
}

type AgentUsageSummary struct {
	ModelRequestCount int64 `json:"model_request_count"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type WriteFinalizationActivityInput struct {
	AgentResultRef string    `json:"agent_result_ref"`
	FinalizedAt    time.Time `json:"finalized_at"`
	RunID          string    `json:"run_id"`
	TraceID        string    `json:"trace_id"`
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

type PersonalMemoryCommandWorkflowInput struct {
	Command    memoryruntime.PersonalMemoryCommandRequest `json:"command"`
	WorkflowID string                                     `json:"workflow_id"`
}

type PersonalMemoryCommandActivityOutput struct {
	CommandID         string `json:"command_id"`
	ErrorCode         string `json:"error_code,omitempty"`
	ResultFingerprint string `json:"result_fingerprint"`
	Status            string `json:"status"`
}

type FinalizePersonalMemoryCommandReceiptActivityInput struct {
	Command memoryruntime.PersonalMemoryCommandRequest `json:"command"`
	Result  PersonalMemoryCommandActivityOutput        `json:"result"`
}

type PersonalMemoryTraceMaintenanceActivityInput struct {
	Command memoryruntime.PersonalMemoryCommandRequest `json:"command"`
}

type PersonalMemoryTraceMaintenanceActivityOutput struct {
	DeletedTraceCount   int `json:"deleted_trace_count,omitempty"`
	RemainingTraceCount int `json:"remaining_trace_count"`
}

type FinalizeExecutionFailureActivityInput struct {
	FailureHash string    `json:"failure_hash"`
	FailureKind string    `json:"failure_kind"`
	FailedAt    time.Time `json:"failed_at"`
	RunID       string    `json:"run_id"`
	Stage       string    `json:"stage"`
	TraceID     string    `json:"trace_id"`
}

type FinalizeExecutionFailureActivityOutput struct {
	CompletedAt time.Time `json:"completed_at"`
	RunID       string    `json:"run_id"`
	Status      string    `json:"status"`
}

type PersonalMemoryCommandWorkflowResult = PersonalMemoryCommandActivityOutput
