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
	RunID             string
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
	RunID         string
	LeaseToken    string
	TemporalRunID string
	Now           time.Time
	NextAttemptAt time.Time
	ErrorCode     string
}

type WorkflowStartExecutionBinding struct {
	RunID         string
	WorkflowID    string
	TemporalRunID string
	Now           time.Time
}

type ActiveWorkflowRun struct {
	Run         DurableRun
	StartIntent WorkflowStartIntent
}

type RunCancellationCommand struct {
	RunID         string
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
	RunID         string
	LeaseToken    string
	Now           time.Time
	NextAttemptAt time.Time
	ErrorCode     string
}

type RunCleanup struct {
	RunID         string
	State         LifecycleIntentState
	AttemptCount  int
	NextAttemptAt time.Time
	LeaseToken    string
	LeaseUntil    time.Time
	LastErrorCode string
	CreatedAt     time.Time
	ConfirmedAt   time.Time
	UpdatedAt     time.Time
}

type RunCleanupResult struct {
	RunID         string
	LeaseToken    string
	Now           time.Time
	NextAttemptAt time.Time
	ErrorCode     string
}

type AgentInvocationReceiptState string

const (
	AgentInvocationReceiptStateStarted   AgentInvocationReceiptState = "started"
	AgentInvocationReceiptStateCompleted AgentInvocationReceiptState = "completed"
)

type AgentInvocationDisposition string

const (
	AgentInvocationDispositionClaimed   AgentInvocationDisposition = "claimed"
	AgentInvocationDispositionReplay    AgentInvocationDisposition = "replay"
	AgentInvocationDispositionAmbiguous AgentInvocationDisposition = "ambiguous"
)

type AgentInvocationReceipt struct {
	InvocationID string
	RunID        string
	InputSHA256  string
	State        AgentInvocationReceiptState
	OutputJSON   json.RawMessage
	OutputSHA256 string
	CreatedAt    time.Time
	CompletedAt  time.Time
	UpdatedAt    time.Time
}
