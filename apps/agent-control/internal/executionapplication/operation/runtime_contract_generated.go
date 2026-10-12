// Code generated from agent-runtime-control.v1.schema.json. DO NOT EDIT.
package operation

import (
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executioncontract"
)

type OperationRequest struct {
	PriorEvidence       []executioncontract.WorkflowEvidence      `json:"prior_evidence,omitempty"`
	PriorSourceAttempts []executioncontract.WorkflowSourceAttempt `json:"prior_source_attempts,omitempty"`
	AdmissionSnapshot   execution.AgentAdmissionSnapshot          `json:"admission_snapshot"`
	CompletedSteps      []executioncontract.WorkflowCompletedStep `json:"completed_steps,omitempty"`
	ConversationID      string                                    `json:"conversation_id"`
	CitationStart       int                                       `json:"citation_start,omitempty"`
	Evidence            []executioncontract.WorkflowEvidence      `json:"evidence,omitempty"`
	Mode                string                                    `json:"mode,omitempty"`
	RecoveryReason      string                                    `json:"recovery_reason,omitempty"`
	SourceAttempts      []executioncontract.WorkflowSourceAttempt `json:"source_attempts,omitempty"`
	Goal                string                                    `json:"goal,omitempty"`
	MaxSteps            int                                       `json:"max_steps,omitempty"`
	MaxRemainingSteps   int                                       `json:"max_remaining_steps,omitempty"`
	Operation           executioncontract.WorkflowOperation       `json:"operation"`
	Payload             map[string]any                            `json:"payload"`
	Plan                *executioncontract.WorkflowTaskPlan       `json:"plan,omitempty"`
	RemainingSteps      []executioncontract.WorkflowTaskPlanStep  `json:"remaining_steps,omitempty"`
	RequestID           string                                    `json:"request_id"`
	ReplanIndex         int                                       `json:"replan_index,omitempty"`
	StepID              string                                    `json:"step_id"`
	StepKind            string                                    `json:"step_kind"`
	Stream              bool                                      `json:"stream,omitempty"`
	Step                *executioncontract.WorkflowTaskPlanStep   `json:"step,omitempty"`
	TraceParent         string                                    `json:"traceparent,omitempty"`
}
