package temporalruntime

import (
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type ToolExecutionWorkflowInput = execution.WorkflowStartInput

type ToolExecutionWorkflowResult struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RequestID     string    `json:"request_id"`
	Status        string    `json:"status"`
}

type AppendConversationMemoryActivityInput struct {
	RequestID string `json:"request_id"`
}

type AppendConversationMemoryActivityOutput struct {
	AppendedMessageCount int      `json:"appended_message_count"`
	RequestID            string   `json:"request_id"`
	SchemaVersion        string   `json:"schema_version"`
	SkipReasons          []string `json:"skip_reasons"`
	SkippedCount         int      `json:"skipped_count"`
	Status               string   `json:"status"`
	ThreadID             string   `json:"thread_id,omitempty"`
}

type ExecutePrimaryAgentActivityInput struct {
	AdmissionSnapshot        execution.AgentAdmissionSnapshot `json:"admission_snapshot"`
	ConversationID           string                           `json:"conversation_id"`
	RequestID                string                           `json:"request_id"`
	TraceParent              string                           `json:"traceparent,omitempty"`
	VisibleFunctionToolNames []string                         `json:"visible_function_tool_names"`
}

type ExecutionFailure struct {
	Code         string `json:"code"`
	Operation    string `json:"operation"`
	Detail       string `json:"detail,omitempty"`
	HTTPStatus   int    `json:"http_status,omitempty"`
	InvocationID string `json:"invocation_id,omitempty"`
}

type AgentToolResult struct {
	ArgumentsJSON map[string]any    `json:"arguments_json"`
	DurationMS    float64           `json:"duration_ms"`
	Failure       *ExecutionFailure `json:"failure,omitempty"`
	InvocationID  string            `json:"invocation_id"`
	Result        map[string]any    `json:"result"`
	Status        string            `json:"status"`
	ToolName      string            `json:"tool_name"`
}

type AgentWebCitation struct {
	EndIndex   int    `json:"end_index"`
	StartIndex int    `json:"start_index"`
	Title      string `json:"title"`
	URL        string `json:"url"`
}

type ExecutePrimaryAgentActivityOutput struct {
	AgentResultRef          string             `json:"agent_result_ref"`
	ContextUsage            map[string]any     `json:"context_usage"`
	FinalOutput             string             `json:"final_output"`
	ModelName               string             `json:"model_name"`
	ModelProvider           string             `json:"model_provider"`
	PromptTrace             map[string]any     `json:"prompt_trace"`
	ProviderResponseID      string             `json:"provider_response_id"`
	RequestID               string             `json:"request_id"`
	StageTiming             map[string]any     `json:"stage_timing,omitempty"`
	Status                  string             `json:"status"`
	TerminalReason          string             `json:"terminal_reason"`
	ToolResults             []AgentToolResult  `json:"tool_results"`
	ToolContractFingerprint map[string]any     `json:"tool_contract_fingerprint"`
	RuntimeRelease          string             `json:"runtime_release"`
	Usage                   AgentUsageSummary  `json:"usage"`
	WebCitations            []AgentWebCitation `json:"web_citations"`
	WebSearchUsed           bool               `json:"web_search_used"`
}

type AgentUsageSummary struct {
	ModelRequestCount int64 `json:"model_request_count"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type WriteFinalizationActivityInput struct {
	AgentResult       ExecutePrimaryAgentActivityOutput `json:"agent_result"`
	AdmissionSnapshot execution.AgentAdmissionSnapshot  `json:"admission_snapshot"`
	FinalizedAt       time.Time                         `json:"finalized_at"`
	RequestID         string                            `json:"request_id"`
}

type WriteFinalizationActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RequestID     string    `json:"request_id"`
	Status        string    `json:"status"`
}

type FinalizeExecutionCancellationActivityOutput = execution.ExecutionCancellationFinalizationOutput

type FinalizeExecutionCancellationActivityInput = execution.ExecutionCancellationFinalizationInput

type ToolExecutionWorkflowCancelInput = execution.WorkflowCancelInput

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

type FinalizeExecutionFailureActivityInput struct {
	FailureKind string    `json:"failure_kind"`
	FailedAt    time.Time `json:"failed_at"`
	RequestID   string    `json:"request_id"`
	Stage       string    `json:"stage"`
}

type FinalizeExecutionFailureActivityOutput struct {
	CompletedAt time.Time `json:"completed_at"`
	RequestID   string    `json:"request_id"`
	Status      string    `json:"status"`
}

type PersonalMemoryCommandWorkflowResult = PersonalMemoryCommandActivityOutput
