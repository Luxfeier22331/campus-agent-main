package executionapplication

import (
	"encoding/json"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
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
	Activity      *executioncontract.ActivityMetadata
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
