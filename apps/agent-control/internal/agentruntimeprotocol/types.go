package agentruntimeprotocol

import (
	"encoding/json"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

type AgentRuntimeResponse struct {
	Operation               string                                 `json:"operation"`
	SolveOutcome            string                                 `json:"solve_outcome"`
	Status                  string                                 `json:"status"`
	Error                   AgentRuntimeError                      `json:"error"`
	RequestID               string                                 `json:"request_id"`
	ContextUsage            map[string]any                         `json:"context_usage"`
	FinalOutput             string                                 `json:"final_output"`
	Plan                    *executioncontract.WorkflowTaskPlan    `json:"plan,omitempty"`
	Replan                  *executioncontract.WorkflowTaskReplan  `json:"replan,omitempty"`
	RemainingFacts          []string                               `json:"remaining_facts,omitempty"`
	Evidence                []map[string]any                       `json:"evidence"`
	SourceAttempts          []map[string]any                       `json:"source_attempts"`
	ModelName               string                                 `json:"model_name"`
	ModelProvider           string                                 `json:"model_provider"`
	ProviderResponseID      string                                 `json:"provider_response_id"`
	StageTiming             map[string]any                         `json:"stage_timing"`
	ToolResults             []AgentToolResult                      `json:"tool_results"`
	TerminalReason          string                                 `json:"terminal_reason"`
	ToolContractFingerprint map[string]any                         `json:"tool_contract_fingerprint"`
	RuntimeRelease          string                                 `json:"runtime_release"`
	Usage                   AgentRuntimeUsage                      `json:"usage"`
	ModelOutputDiagnostic   json.RawMessage                        `json:"model_output_diagnostic"`
	WebEvidence             []executioncontract.WebEvidence        `json:"web_evidence"`
	WebSearchDiagnostic     *executioncontract.WebSearchDiagnostic `json:"web_search_diagnostic"`
	Failure                 *executioncontract.ExecutionFailure    `json:"failure"`
	AnswerStarted           bool                                   `json:"answer_started"`
}

type AgentToolResult struct {
	ArgumentsJSON map[string]any                      `json:"arguments_json"`
	StartedAt     *time.Time                          `json:"started_at"`
	CompletedAt   *time.Time                          `json:"completed_at"`
	DurationMS    float64                             `json:"duration_ms"`
	Failure       *executioncontract.ExecutionFailure `json:"failure"`
	InvocationID  string                              `json:"invocation_id"`
	Status        string                              `json:"status"`
	ToolName      string                              `json:"tool_name"`
	Result        map[string]any                      `json:"result"`
}

type AgentRuntimeUsage struct {
	ModelRequestCount int64 `json:"model_request_count"`
	InputTokens       int64 `json:"input_tokens"`
	OutputTokens      int64 `json:"output_tokens"`
	CachedInputTokens int64 `json:"cached_input_tokens"`
	UsageObserved     bool  `json:"usage_observed"`
}

type AgentRuntimeError struct {
	Reason       string          `json:"reason,omitempty"`
	Citation     json.RawMessage `json:"citation,omitempty"`
	Code         string          `json:"code"`
	Message      string          `json:"message"`
	Operation    string          `json:"operation"`
	Detail       string          `json:"detail"`
	HTTPStatus   int             `json:"http_status"`
	InvocationID string          `json:"invocation_id"`
}

type Event struct {
	Event        string
	Retrieval    RetrievalStatus
	Decision     SolveDecision
	Delta        AnswerDelta
	Invalidation AnswerInvalidation
	Result       AgentRuntimeResponse
	Failure      StreamFailure
}
type RetrievalStatus struct {
	SchemaVersion string    `json:"schema_version"`
	Source        string    `json:"source"`
	Status        string    `json:"status"`
	OccurredAt    time.Time `json:"occurred_at"`
}
type SolveDecision struct {
	SchemaVersion string `json:"schema_version"`
	Outcome       string `json:"outcome"`
}
type AnswerDelta struct {
	SchemaVersion string `json:"schema_version"`
	Delta         string `json:"delta"`
	Provisional   *bool  `json:"provisional"`
}
type AnswerInvalidation struct {
	SchemaVersion string `json:"schema_version"`
	Reason        string `json:"reason"`
}
type StreamFailure struct {
	AgentRuntimeError
	RuntimeRelease string `json:"runtime_release"`
}
