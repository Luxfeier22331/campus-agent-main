package executionapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

// AgentRuntimeClient delivers decoded results and synchronous ordered stream events.
type AgentRuntimeClient interface {
	Prepare(AgentRuntimeRequest) (string, error)
	Execute(context.Context, AgentRuntimeRequest, func(AgentRuntimeEvent) error) (AgentRuntimeResult, error)
}

type AgentRuntimeRequest struct {
	RequestID                string
	ConversationID           string
	UserID                   string
	DeadlineAt               time.Time
	ActivityAttempt          int
	Operation                executioncontract.WorkflowOperation
	Input                    map[string]any
	VisibleFunctionToolNames []string
	Limits                   RuntimeLimits
	ModelTargetSHA256        string
	ToolContractFingerprint  map[string]any
	PriorEvidence            []executioncontract.WorkflowEvidence
	PriorSourceAttempts      []executioncontract.WorkflowSourceAttempt
	ConversationContext      map[string]any
	StreamModelAnswer        bool
	Stream                   bool
}
type RuntimeLimits struct {
	AgentDeadlineMS       int
	ContextCharLimit      int
	CurrentInputCharLimit int
	MaxOutputTokens       int
	MaxFunctionToolCalls  int
	MaxTurns              int
	MaxPlanSteps          int
	MaxReplans            int
}

// AgentRuntimeRequestError keeps request construction failures distinct from
// transport failures without exposing HTTP implementation details to the
// Temporal activity.
type AgentRuntimeRequestError struct {
	Build bool
	Cause error
}

func (err *AgentRuntimeRequestError) Error() string {
	if err == nil || err.Cause == nil {
		return "agent runtime request failed"
	}
	return "agent runtime request failed"
}

func (err *AgentRuntimeRequestError) Unwrap() error {
	if err == nil {
		return nil
	}
	return err.Cause
}

type ExecutionFinalizationClient interface {
	WriteExecutionFinalization(context.Context, ExecutionFinalizationRequest) error
}

type ExecutionFinalizationRequest struct {
	RequestID   string
	CompletedAt time.Time
	Response    map[string]any
}
