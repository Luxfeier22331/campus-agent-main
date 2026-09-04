package execution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

const WorkflowTaskQueue = "campus-agent.workflow.v3"

var (
	ErrWorkflowIdentityUnknown  = errors.New("workflow identity is not yet observable")
	ErrWorkflowIdentityConflict = errors.New("workflow identity conflicts with durable intent")
	ErrWorkflowOwnershipUnsafe  = errors.New("workflow execution ownership is unsafe to converge")
)

type WorkflowStartInput struct {
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

func DecodeAndValidateWorkflowStartInput(
	intent WorkflowStartIntent,
	run DurableRun,
) (WorkflowStartInput, error) {
	var input WorkflowStartInput
	if err := json.Unmarshal(intent.WorkflowInputJSON, &input); err != nil {
		return input, fmt.Errorf("workflow input JSON is invalid: %w", err)
	}
	if input.RequestID != run.RequestID || input.ConversationID != run.ConversationID {
		return input, errors.New("workflow input identity does not match durable run")
	}
	wantWorkflowID := "campus-agent.chat." + run.RequestID
	if input.WorkflowID != wantWorkflowID || intent.WorkflowID != wantWorkflowID {
		return input, errors.New("workflow identity is not canonical")
	}
	if input.TaskQueue != WorkflowTaskQueue || intent.TaskQueue != WorkflowTaskQueue {
		return input, errors.New("workflow task queue is not v3")
	}
	if input.PayloadSHA256 != intent.PayloadSHA256 || !validWorkflowIdentitySHA(input.PayloadSHA256) {
		return input, errors.New("workflow input payload hash is invalid")
	}
	if input.AdmissionSnapshotSHA256 != SHA256JSONRef(input.AdmissionSnapshot) {
		return input, errors.New("workflow admission snapshot hash is invalid")
	}
	if err := ValidateAdmissionSnapshotForVisibleTools(
		input.AdmissionSnapshot,
		input.AdmissionSnapshot.ExecutionStrategy.VisibleFunctionToolNames,
	); err != nil {
		return input, fmt.Errorf("workflow admission snapshot is invalid: %w", err)
	}
	return input, nil
}

type WorkflowCancelInput struct {
	Reason        string `json:"reason"`
	RequestID     string `json:"request_id"`
	TemporalRunID string `json:"temporal_run_id"`
	WorkflowID    string `json:"workflow_id"`
}

type ExecutionCancellationFinalizationInput struct {
	CanceledAt time.Time `json:"canceled_at"`
	Reason     string    `json:"reason"`
	RequestID  string    `json:"request_id"`
}

type ExecutionCancellationFinalizationOutput struct {
	RequestID string `json:"request_id"`
	Status    string `json:"status"`
}

type WorkflowExecutionStatus string

const (
	WorkflowExecutionStatusUnknown        WorkflowExecutionStatus = "unknown"
	WorkflowExecutionStatusRunning        WorkflowExecutionStatus = "running"
	WorkflowExecutionStatusCompleted      WorkflowExecutionStatus = "completed"
	WorkflowExecutionStatusFailed         WorkflowExecutionStatus = "failed"
	WorkflowExecutionStatusCanceled       WorkflowExecutionStatus = "canceled"
	WorkflowExecutionStatusTerminated     WorkflowExecutionStatus = "terminated"
	WorkflowExecutionStatusContinuedAsNew WorkflowExecutionStatus = "continued_as_new"
	WorkflowExecutionStatusTimedOut       WorkflowExecutionStatus = "timed_out"
)

func (s WorkflowExecutionStatus) String() string { return string(s) }

func (s WorkflowExecutionStatus) Terminal() bool {
	switch s {
	case WorkflowExecutionStatusCompleted,
		WorkflowExecutionStatusFailed,
		WorkflowExecutionStatusCanceled,
		WorkflowExecutionStatusTerminated,
		WorkflowExecutionStatusContinuedAsNew,
		WorkflowExecutionStatusTimedOut:
		return true
	default:
		return false
	}
}

type WorkflowIdentityState string

const (
	WorkflowIdentityUnknown WorkflowIdentityState = "unknown"
	WorkflowIdentityKnown   WorkflowIdentityState = "known"
	WorkflowIdentityInvalid WorkflowIdentityState = "invalid"
)

type WorkflowIdentity struct {
	RequestID           string
	WorkflowID          string
	PayloadSHA256       string
	WorkflowInputSHA256 string
}

func (i WorkflowIdentity) Valid() bool {
	return strings.TrimSpace(i.RequestID) != "" &&
		strings.TrimSpace(i.WorkflowID) != "" &&
		validWorkflowIdentitySHA(i.PayloadSHA256) &&
		validWorkflowIdentitySHA(i.WorkflowInputSHA256)
}

type WorkflowExecutionInfo struct {
	Found           bool
	WorkflowID      string
	RunID           string
	FirstRunID      string
	Status          WorkflowExecutionStatus
	CloseTime       time.Time
	ResetStateKnown bool
	LastResetTime   time.Time
	ResetRunID      string
	IdentityState   WorkflowIdentityState
	Identity        WorkflowIdentity
}

func WorkflowIdentityForInput(input WorkflowStartInput) (WorkflowIdentity, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return WorkflowIdentity{}, fmt.Errorf("encode workflow input identity: %w", err)
	}
	digest := sha256.Sum256(encoded)
	identity := WorkflowIdentity{
		RequestID:           strings.TrimSpace(input.RequestID),
		WorkflowID:          strings.TrimSpace(input.WorkflowID),
		PayloadSHA256:       strings.TrimSpace(input.PayloadSHA256),
		WorkflowInputSHA256: hex.EncodeToString(digest[:]),
	}
	if !identity.Valid() {
		return WorkflowIdentity{}, errors.New("workflow input identity is incomplete")
	}
	return identity, nil
}

func ValidateWorkflowIdentity(info WorkflowExecutionInfo, expected WorkflowIdentity) error {
	if !info.Found {
		return ErrWorkflowIdentityUnknown
	}
	if strings.TrimSpace(info.WorkflowID) != expected.WorkflowID {
		return fmt.Errorf("%w: workflow id differs", ErrWorkflowIdentityConflict)
	}
	switch info.IdentityState {
	case WorkflowIdentityUnknown, "":
		return ErrWorkflowIdentityUnknown
	case WorkflowIdentityInvalid:
		return fmt.Errorf("%w: workflow memo identity is invalid", ErrWorkflowIdentityConflict)
	case WorkflowIdentityKnown:
	default:
		return ErrWorkflowIdentityUnknown
	}
	if info.Identity != expected {
		return fmt.Errorf("%w: workflow memo identity differs", ErrWorkflowIdentityConflict)
	}
	if !info.ResetStateKnown {
		return fmt.Errorf("%w: workflow reset state is unavailable", ErrWorkflowIdentityUnknown)
	}
	if !info.LastResetTime.IsZero() || strings.TrimSpace(info.ResetRunID) != "" {
		return fmt.Errorf("%w: workflow execution has reset evidence", ErrWorkflowOwnershipUnsafe)
	}
	return nil
}

func validWorkflowIdentitySHA(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}

type WorkflowStarter interface {
	CancelToolExecutionWorkflow(context.Context, WorkflowCancelInput) error
	StartToolExecutionWorkflow(context.Context, WorkflowStartInput) (string, error)
}

type WorkflowControl interface {
	DescribeToolExecutionWorkflow(context.Context, string, string) (WorkflowExecutionInfo, error)
}

type WorkflowCancellationRecoveryStarter interface {
	EnsureToolExecutionWorkflowForCancellation(context.Context, WorkflowStartInput) (string, error)
}

type WorkflowFinalizer interface {
	FailWorkflowStart(context.Context, DurableRun, string, error) error
	FinalizeExecutionCancellation(
		context.Context,
		ExecutionCancellationFinalizationInput,
	) (ExecutionCancellationFinalizationOutput, error)
	FinalizeWorkflowClosure(context.Context, DurableRun, time.Time, string) error
	FinalizeWorkflowTimeout(context.Context, DurableRun, time.Time) error
}
