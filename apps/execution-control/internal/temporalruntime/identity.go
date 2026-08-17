package temporalruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	commonpb "go.temporal.io/api/common/v1"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/converter"
)

var (
	ErrWorkflowIdentityUnknown  = errors.New("temporal workflow identity is not yet observable")
	ErrWorkflowIdentityConflict = errors.New("temporal workflow identity conflicts with durable intent")
	ErrWorkflowOwnershipUnsafe  = errors.New("temporal workflow execution ownership is unsafe to converge")
)

const (
	workflowMemoRunIDKey      = "campus_agent_run_id"
	workflowMemoWorkflowIDKey = "campus_agent_workflow_id"
	workflowMemoPayloadSHAKey = "campus_agent_payload_sha256"
	workflowMemoInputSHAKey   = "campus_agent_input_sha256"
)

type WorkflowExecutionInfo struct {
	Found           bool
	WorkflowID      string
	RunID           string
	FirstRunID      string
	Status          enumspb.WorkflowExecutionStatus
	CloseTime       time.Time
	ResetStateKnown bool
	LastResetTime   time.Time
	ResetRunID      string
	IdentityState   WorkflowIdentityState
	Identity        ToolExecutionWorkflowIdentity
}

type WorkflowIdentityState string

const (
	WorkflowIdentityUnknown WorkflowIdentityState = "unknown"
	WorkflowIdentityKnown   WorkflowIdentityState = "known"
	WorkflowIdentityInvalid WorkflowIdentityState = "invalid"
)

type ToolExecutionWorkflowIdentity struct {
	RunID               string
	WorkflowID          string
	PayloadSHA256       string
	WorkflowInputSHA256 string
}

func ToolExecutionWorkflowIdentityForInput(input ToolExecutionWorkflowInput) (ToolExecutionWorkflowIdentity, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return ToolExecutionWorkflowIdentity{}, fmt.Errorf("encode workflow input identity: %w", err)
	}
	digest := sha256.Sum256(encoded)
	identity := ToolExecutionWorkflowIdentity{
		RunID:               strings.TrimSpace(input.RunID),
		WorkflowID:          strings.TrimSpace(input.WorkflowID),
		PayloadSHA256:       strings.TrimSpace(input.PayloadSHA256),
		WorkflowInputSHA256: hex.EncodeToString(digest[:]),
	}
	if identity.RunID == "" || identity.WorkflowID == "" ||
		!validWorkflowIdentitySHA(identity.PayloadSHA256) ||
		!validWorkflowIdentitySHA(identity.WorkflowInputSHA256) {
		return ToolExecutionWorkflowIdentity{}, errors.New("workflow input identity is incomplete")
	}
	return identity, nil
}

func ValidateToolExecutionWorkflowIdentity(
	info WorkflowExecutionInfo,
	expected ToolExecutionWorkflowIdentity,
) error {
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

func toolExecutionWorkflowIdentityFromMemo(memo *commonpb.Memo) (ToolExecutionWorkflowIdentity, WorkflowIdentityState) {
	if memo == nil {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityUnknown
	}
	fields := memo.GetFields()
	keys := []string{workflowMemoRunIDKey, workflowMemoWorkflowIDKey, workflowMemoPayloadSHAKey, workflowMemoInputSHAKey}
	present := 0
	values := make([]string, len(keys))
	for index, key := range keys {
		payload, ok := fields[key]
		if !ok {
			continue
		}
		present++
		if err := converter.GetDefaultDataConverter().FromPayload(payload, &values[index]); err != nil {
			return ToolExecutionWorkflowIdentity{}, WorkflowIdentityInvalid
		}
		values[index] = strings.TrimSpace(values[index])
	}
	if present == 0 {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityUnknown
	}
	identity := ToolExecutionWorkflowIdentity{
		RunID: values[0], WorkflowID: values[1], PayloadSHA256: values[2], WorkflowInputSHA256: values[3],
	}
	if present != len(keys) || identity.RunID == "" || identity.WorkflowID == "" ||
		!validWorkflowIdentitySHA(identity.PayloadSHA256) ||
		!validWorkflowIdentitySHA(identity.WorkflowInputSHA256) {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityInvalid
	}
	return identity, WorkflowIdentityKnown
}

func validWorkflowIdentitySHA(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}
