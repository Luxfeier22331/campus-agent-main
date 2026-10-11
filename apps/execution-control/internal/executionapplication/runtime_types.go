package executionapplication

import (
	"encoding/json"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executioncontract"
)

type AgentRuntimeResult struct {
	Operation               string
	SolveOutcome            string
	Status                  string
	Error                   AgentRuntimeError
	RequestID               string
	ContextUsage            map[string]any
	FinalOutput             string
	Plan                    *executioncontract.WorkflowTaskPlan
	Replan                  *executioncontract.WorkflowTaskReplan
	RemainingFacts          []string
	Evidence                []map[string]any
	SourceAttempts          []map[string]any
	ModelName               string
	ModelProvider           string
	ProviderResponseID      string
	StageTiming             map[string]any
	ToolResults             []AgentToolResult
	TerminalReason          string
	ToolContractFingerprint map[string]any
	RuntimeRelease          string
	Usage                   AgentRuntimeUsage
	ModelOutputDiagnostic   json.RawMessage
	WebEvidence             []executioncontract.WebEvidence
	WebSearchDiagnostic     *executioncontract.WebSearchDiagnostic
	Failure                 *executioncontract.ExecutionFailure
	AnswerStarted           bool
}

type AgentToolResult struct {
	ArgumentsJSON map[string]any
	StartedAt     *time.Time
	CompletedAt   *time.Time
	DurationMS    float64
	Failure       *executioncontract.ExecutionFailure
	InvocationID  string
	Status        string
	ToolName      string
	Result        map[string]any
}

type AgentRuntimeUsage struct {
	ModelRequestCount int64
	InputTokens       int64
	OutputTokens      int64
	CachedInputTokens int64
	UsageObserved     bool
}

type AgentRuntimeError struct {
	Reason       string
	Citation     json.RawMessage
	Code         string
	Message      string
	Operation    string
	Detail       string
	HTTPStatus   int
	InvocationID string
}

type AgentRuntimeEvent struct {
	Event        string
	Retrieval    RuntimeRetrievalStatus
	Decision     SolveDecision
	Delta        AnswerDelta
	Invalidation AnswerInvalidation
	Result       AgentRuntimeResult
	Failure      AgentRuntimeFailure
}
type RuntimeRetrievalStatus struct {
	Source     string
	Status     string
	OccurredAt time.Time
}
type SolveDecision struct {
	Outcome string
}
type AnswerDelta struct {
	Delta       string
	Provisional *bool
}
type AnswerInvalidation struct {
	Reason string
}

// AgentRuntimeFailure is a classified invocation failure. HTTPStatus is bounded
// diagnostic evidence; application control flow uses Kind, never HTTP status.
type AgentRuntimeFailure struct {
	SafeMessage    string
	Kind           string
	Code           string
	Reason         string
	Citation       json.RawMessage
	Operation      string
	Detail         string
	HTTPStatus     int
	InvocationID   string
	RuntimeRelease string
}

func (e AgentRuntimeFailure) Error() string {
	if e.SafeMessage != "" {
		return e.SafeMessage
	}
	return "The agent runtime could not complete the request."
}
