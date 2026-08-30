package temporalruntime

import (
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

type ToolExecutionWorkflowInput struct {
	AdmissionSnapshot            AgentAdmissionSnapshot `json:"admission_snapshot"`
	AdmissionSnapshotSHA256      string                 `json:"admission_snapshot_sha256"`
	ConversationID               string                 `json:"conversation_id"`
	Namespace                    string                 `json:"namespace"`
	PayloadSHA256                string                 `json:"payload_sha256"`
	PersonalMemoryTimeoutSeconds float64                `json:"personal_memory_timeout_seconds"`
	RequestID                    string                 `json:"request_id"`
	TaskQueue                    string                 `json:"task_queue"`
	TraceParent                  string                 `json:"traceparent,omitempty"`
	WorkflowID                   string                 `json:"workflow_id"`
}

// AgentAdmissionSnapshot contains only bounded, non-secret execution policy
// inputs. Provider credentials and model responses are deliberately excluded.
type AgentAdmissionSnapshot struct {
	AgentLimits             AgentRuntimeLimitsSnapshot `json:"agent_limits"`
	AgentLimitsSHA256       string                     `json:"agent_limits_sha256"`
	ExecutionStrategy       ExecutionStrategySnapshot  `json:"execution_strategy"`
	ExecutionStrategySHA256 string                     `json:"execution_strategy_sha256"`
	// PrimaryAgentTargetSHA256 is the opaque Model Config target hash frozen
	// for this run. The JSON name stays stable for persisted Temporal history.
	PrimaryAgentTargetSHA256      string                          `json:"provider_config_sha256"`
	ToolContractFingerprint       ToolContractFingerprintSnapshot `json:"tool_contract_fingerprint"`
	ToolContractFingerprintSHA256 string                          `json:"tool_contract_fingerprint_sha256"`
}

type ExecutionStrategySnapshot struct {
	Kind             string   `json:"kind"`
	MaxModelTurns    int      `json:"max_model_turns"`
	MaxToolCalls     int      `json:"max_tool_calls"`
	SchemaVersion    string   `json:"schema_version"`
	VisibleToolNames []string `json:"visible_tool_names"`
}

// ToolContractFingerprintSnapshot binds an admitted run to the exact tool
// registry and function schemas expected from agent-runtime. It contains no
// credentials or model data.
type ToolContractFingerprintSnapshot struct {
	FunctionSchemaSHA256 string `json:"function_schema_sha256"`
	SchemaVersion        string `json:"schema_version"`
	ToolsSHA256          string `json:"tools_sha256"`
}

type AgentRuntimeLimitsSnapshot struct {
	AgentDeadlineMS       int `json:"agent_deadline_ms"`
	ContextCharLimit      int `json:"context_char_limit"`
	CurrentInputCharLimit int `json:"current_input_char_limit"`
	MaxOutputTokens       int `json:"max_output_tokens"`
}

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
	AdmissionSnapshot AgentAdmissionSnapshot `json:"admission_snapshot"`
	ConversationID    string                 `json:"conversation_id"`
	RequestID         string                 `json:"request_id"`
	TraceParent       string                 `json:"traceparent,omitempty"`
	VisibleToolNames  []string               `json:"visible_tool_names"`
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

type ExecutePrimaryAgentActivityOutput struct {
	AgentResultRef          string            `json:"agent_result_ref"`
	ContextUsage            map[string]any    `json:"context_usage"`
	FinalOutput             string            `json:"final_output"`
	ModelName               string            `json:"model_name"`
	ModelProvider           string            `json:"model_provider"`
	PromptTrace             map[string]any    `json:"prompt_trace"`
	ProviderResponseID      string            `json:"provider_response_id"`
	RequestID               string            `json:"request_id"`
	StageTiming             map[string]any    `json:"stage_timing,omitempty"`
	Status                  string            `json:"status"`
	TerminalReason          string            `json:"terminal_reason"`
	ToolResults             []AgentToolResult `json:"tool_results"`
	ToolContractFingerprint map[string]any    `json:"tool_contract_fingerprint"`
	RuntimeRelease          string            `json:"runtime_release"`
	Usage                   AgentUsageSummary `json:"usage"`
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
	AdmissionSnapshot AgentAdmissionSnapshot            `json:"admission_snapshot"`
	FinalizedAt       time.Time                         `json:"finalized_at"`
	RequestID         string                            `json:"request_id"`
}

type WriteFinalizationActivityOutput struct {
	CompletedAt   time.Time `json:"completed_at"`
	ProjectionRef string    `json:"projection_ref"`
	RequestID     string    `json:"request_id"`
	Status        string    `json:"status"`
}

type FinalizeExecutionCancellationActivityOutput struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

type FinalizeExecutionCancellationActivityInput struct {
	CanceledAt time.Time `json:"canceled_at"`
	Reason     string    `json:"reason"`
	RequestID  string    `json:"request_id"`
}

type ToolExecutionWorkflowCancelInput struct {
	Reason        string `json:"reason"`
	RequestID     string `json:"request_id"`
	TemporalRunID string `json:"temporal_run_id"`
	WorkflowID    string `json:"workflow_id"`
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
