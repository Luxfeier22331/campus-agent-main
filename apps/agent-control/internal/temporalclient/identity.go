package temporalclient

import (
	"encoding/json"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
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

const (
	WorkflowIdentityUnknown = execution.WorkflowIdentityUnknown
	WorkflowIdentityKnown   = execution.WorkflowIdentityKnown
	WorkflowIdentityInvalid = execution.WorkflowIdentityInvalid
)

func ToolExecutionWorkflowIdentityForInput(input ToolExecutionWorkflowInput) (execution.WorkflowIdentity, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return execution.WorkflowIdentity{}, err
	}
	return execution.WorkflowIdentityForPayload(input.RequestID, input.WorkflowID, input.PayloadSHA256, encoded)
}

func ValidateToolExecutionWorkflowIdentity(
	info execution.WorkflowExecutionInfo,
	expected execution.WorkflowIdentity,
) error {
	return execution.ValidateWorkflowIdentity(info, expected)
}

func toolExecutionWorkflowIdentityFromMemo(memo *commonpb.Memo) (execution.WorkflowIdentity, execution.WorkflowIdentityState) {
	if memo == nil {
		return execution.WorkflowIdentity{}, WorkflowIdentityUnknown
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
			return execution.WorkflowIdentity{}, WorkflowIdentityInvalid
		}
		values[index] = strings.TrimSpace(values[index])
	}
	if present == 0 {
		return execution.WorkflowIdentity{}, WorkflowIdentityUnknown
	}
	identity := execution.WorkflowIdentity{
		RequestID: values[0], WorkflowID: values[1], PayloadSHA256: values[2], WorkflowInputSHA256: values[3],
	}
	if present != len(keys) || !identity.Valid() {
		return execution.WorkflowIdentity{}, WorkflowIdentityInvalid
	}
	return identity, WorkflowIdentityKnown
}
