package temporalruntime

import (
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/sdk/converter"
)

var (
	ErrWorkflowIdentityUnknown  = execution.ErrWorkflowIdentityUnknown
	ErrWorkflowIdentityConflict = execution.ErrWorkflowIdentityConflict
	ErrWorkflowOwnershipUnsafe  = execution.ErrWorkflowOwnershipUnsafe
)

const (
	workflowMemoRequestIDKey  = "campus_agent_request_id"
	workflowMemoWorkflowIDKey = "campus_agent_workflow_id"
	workflowMemoPayloadSHAKey = "campus_agent_payload_sha256"
	workflowMemoInputSHAKey   = "campus_agent_input_sha256"
)

type WorkflowExecutionInfo = execution.WorkflowExecutionInfo

type WorkflowIdentityState = execution.WorkflowIdentityState

const (
	WorkflowIdentityUnknown = execution.WorkflowIdentityUnknown
	WorkflowIdentityKnown   = execution.WorkflowIdentityKnown
	WorkflowIdentityInvalid = execution.WorkflowIdentityInvalid
)

type ToolExecutionWorkflowIdentity = execution.WorkflowIdentity

func ToolExecutionWorkflowIdentityForInput(input ToolExecutionWorkflowInput) (ToolExecutionWorkflowIdentity, error) {
	return execution.WorkflowIdentityForInput(input)
}

func ValidateToolExecutionWorkflowIdentity(
	info WorkflowExecutionInfo,
	expected ToolExecutionWorkflowIdentity,
) error {
	return execution.ValidateWorkflowIdentity(info, expected)
}

func toolExecutionWorkflowIdentityFromMemo(memo *commonpb.Memo) (ToolExecutionWorkflowIdentity, WorkflowIdentityState) {
	if memo == nil {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityUnknown
	}
	fields := memo.GetFields()
	keys := []string{workflowMemoRequestIDKey, workflowMemoWorkflowIDKey, workflowMemoPayloadSHAKey, workflowMemoInputSHAKey}
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
		RequestID: values[0], WorkflowID: values[1], PayloadSHA256: values[2], WorkflowInputSHA256: values[3],
	}
	if present != len(keys) || !identity.Valid() {
		return ToolExecutionWorkflowIdentity{}, WorkflowIdentityInvalid
	}
	return identity, WorkflowIdentityKnown
}
