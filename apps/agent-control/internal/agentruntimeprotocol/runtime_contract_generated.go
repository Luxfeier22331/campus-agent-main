// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.
package agentruntimeprotocol

import (
	"encoding/json"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
	"time"
)

type AgentRuntimeResponse struct {
	Operation               string                                 `json:"operation"`
	SolveOutcome            string                                 `json:"solve_outcome,omitempty"`
	Status                  string                                 `json:"status"`
	Error                   AgentRuntimeError                      `json:"error,omitempty"`
	RequestID               string                                 `json:"request_id"`
	ContextUsage            map[string]any                         `json:"context_usage,omitempty"`
	FinalOutput             string                                 `json:"final_output,omitempty"`
	Plan                    *executioncontract.WorkflowTaskPlan    `json:"plan,omitempty"`
	Replan                  *executioncontract.WorkflowTaskReplan  `json:"replan,omitempty"`
	RemainingFacts          []string                               `json:"remaining_facts,omitempty"`
	Evidence                []map[string]any                       `json:"evidence,omitempty"`
	SourceAttempts          []map[string]any                       `json:"source_attempts,omitempty"`
	ModelName               string                                 `json:"model_name,omitempty"`
	ModelProvider           string                                 `json:"model_provider,omitempty"`
	ProviderResponseID      string                                 `json:"provider_response_id,omitempty"`
	StageTiming             map[string]any                         `json:"stage_timing,omitempty"`
	ToolResults             []AgentToolResult                      `json:"tool_results,omitempty"`
	TerminalReason          string                                 `json:"terminal_reason,omitempty"`
	ToolContractFingerprint map[string]any                         `json:"tool_contract_fingerprint,omitempty"`
	RuntimeRelease          string                                 `json:"runtime_release,omitempty"`
	Usage                   AgentRuntimeUsage                      `json:"usage,omitempty"`
	ModelOutputDiagnostic   json.RawMessage                        `json:"model_output_diagnostic,omitempty"`
	WebEvidence             []executioncontract.WebEvidence        `json:"web_evidence,omitempty"`
	WebSearchDiagnostic     *executioncontract.WebSearchDiagnostic `json:"web_search_diagnostic,omitempty"`
	Failure                 *executioncontract.ExecutionFailure    `json:"failure,omitempty"`
	AnswerStarted           bool                                   `json:"answer_started,omitempty"`
}

type AgentToolResult struct {
	ArgumentsJSON map[string]any                      `json:"arguments_json,omitempty"`
	StartedAt     *time.Time                          `json:"started_at,omitempty"`
	CompletedAt   *time.Time                          `json:"completed_at,omitempty"`
	DurationMS    float64                             `json:"duration_ms,omitempty"`
	Failure       *executioncontract.ExecutionFailure `json:"failure,omitempty"`
	InvocationID  string                              `json:"invocation_id"`
	Status        string                              `json:"status"`
	ToolName      string                              `json:"tool_name"`
	Result        map[string]any                      `json:"result"`
	Activity      *executioncontract.ActivityMetadata `json:"activity,omitempty"`
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
	Code         string          `json:"code,omitempty"`
	Message      string          `json:"message,omitempty"`
	Operation    string          `json:"operation,omitempty"`
	Detail       string          `json:"detail,omitempty"`
	HTTPStatus   int             `json:"http_status,omitempty"`
	InvocationID string          `json:"invocation_id,omitempty"`
}
