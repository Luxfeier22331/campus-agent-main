package executionapplication

import (
	"context"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

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

type ExecutionFinalizationClient interface {
	WriteExecutionFinalization(context.Context, ExecutionFinalizationRequest) error
}

type ExecutionFinalizationRequest struct {
	RequestID   string
	CompletedAt time.Time
	Response    map[string]any
}
