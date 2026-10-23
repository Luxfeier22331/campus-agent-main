package execution

import (
	"encoding/json"
	"time"
)

type LifecycleIntentState string

const (
	LifecycleIntentStatePending         LifecycleIntentState = "pending"
	LifecycleIntentStateLeased          LifecycleIntentState = "leased"
	LifecycleIntentStateConfirmed       LifecycleIntentState = "confirmed"
	LifecycleIntentStateSuperseded      LifecycleIntentState = "superseded"
	LifecycleIntentStatePermanentFailed LifecycleIntentState = "permanent_failed"
)

type DurableRunCreateIntent struct {
	Run                      DurableRun
	RequestFingerprintSHA256 string
	WorkflowID               string
	PayloadSHA256            string
	TaskQueue                string
	WorkflowInputJSON        json.RawMessage
	CreatedEvent             DurableRunEvent
}

type DurableRunCreateResult struct {
	Run     DurableRun
	Created bool
}

type WorkflowStartIntent struct {
	RequestID         string
	WorkflowID        string
	PayloadSHA256     string
	TaskQueue         string
	WorkflowInputJSON json.RawMessage
	State             LifecycleIntentState
	TemporalRunID     string
	AttemptCount      int
	DispatchAttempted bool
	NextAttemptAt     time.Time
	LeaseToken        string
	LeaseUntil        time.Time
	LastErrorCode     string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type LifecycleLeaseRequest struct {
	LeaseToken string
	Now        time.Time
	LeaseUntil time.Time
	Limit      int
}

type WorkflowStartIntentResult struct {
	RequestID     string
	LeaseToken    string
	TemporalRunID string
	Now           time.Time
	NextAttemptAt time.Time
	ErrorCode     string
}

type WorkflowStartExecutionBinding struct {
	RequestID     string
	WorkflowID    string
	TemporalRunID string
	Now           time.Time
}

type ActiveWorkflowRun struct {
	Run         DurableRun
	StartIntent WorkflowStartIntent
}

type RunCancellationCommand struct {
	RequestID     string
	WorkflowID    string
	Reason        string
	State         LifecycleIntentState
	AttemptCount  int
	NextAttemptAt time.Time
	LeaseToken    string
	LeaseUntil    time.Time
	LastErrorCode string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type RunCancellationCommandResult struct {
	RequestID     string
	LeaseToken    string
	Now           time.Time
	NextAttemptAt time.Time
	ErrorCode     string
}

type AgentInvocationReceiptState string

const (
	AgentInvocationReceiptStateStarted   AgentInvocationReceiptState = "started"
	AgentInvocationReceiptStateCompleted AgentInvocationReceiptState = "completed"
	AgentInvocationReceiptStateFailed    AgentInvocationReceiptState = "failed"
)

type AgentInvocationDisposition string

const (
	AgentInvocationDispositionClaimed   AgentInvocationDisposition = "claimed"
	AgentInvocationDispositionReplay    AgentInvocationDisposition = "replay"
	AgentInvocationDispositionAmbiguous AgentInvocationDisposition = "ambiguous"
)

type AgentInvocationReceipt struct {
	InvocationID string
	RequestID    string
	InputSHA256  string
	State        AgentInvocationReceiptState
	OutputJSON   json.RawMessage
	OutputSHA256 string
	CreatedAt    time.Time
	CompletedAt  time.Time
	UpdatedAt    time.Time
}

// MaxAgentInvocationOutputBytes bounds the recovery copy retained by a receipt.
// It is intentionally a typed operation result, never a provider raw response.
const MaxAgentInvocationOutputBytes = MaxAgentOperationPayloadBytes
