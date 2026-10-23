package execution

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

func validateLifecycleLeaseRequest(request LifecycleLeaseRequest) error {
	if strings.TrimSpace(request.LeaseToken) == "" || request.Now.IsZero() ||
		!request.LeaseUntil.After(request.Now) || request.Limit < 1 || request.Limit > 100 {
		return fmt.Errorf("%w: invalid lifecycle lease request", ErrLifecycleLeaseConflict)
	}
	return nil
}

func lifecycleIntentLeaseable(state LifecycleIntentState, next, leaseUntil, now time.Time) bool {
	if next.After(now) {
		return false
	}
	switch state {
	case LifecycleIntentStatePending:
		return true
	case LifecycleIntentStateLeased:
		return !leaseUntil.After(now)
	default:
		// Confirmed, superseded, and permanently failed intents are retired and
		// must never be leased again.
		return false
	}
}

func leasedWorkflowStartIntent(
	intents map[string]WorkflowStartIntent,
	result WorkflowStartIntentResult,
) (WorkflowStartIntent, error) {
	intent, exists := intents[result.RequestID]
	if !exists || intent.State != LifecycleIntentStateLeased || intent.LeaseToken != result.LeaseToken {
		return WorkflowStartIntent{}, fmt.Errorf("%w: workflow start request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	return intent, nil
}

func validateDurableRunCancellationRequest(request DurableRunCancellationRequest) error {
	if strings.TrimSpace(request.RequestID) == "" || request.Reason != "user_requested" || request.Now.IsZero() {
		return fmt.Errorf("%w: invalid cancellation request", ErrInvalidDurableRunCancel)
	}
	return nil
}

func validateAgentInvocationReceipt(receipt AgentInvocationReceipt, completed bool) error {
	if strings.TrimSpace(receipt.InvocationID) == "" || strings.TrimSpace(receipt.RequestID) == "" ||
		!validLowerHexSHA256(receipt.InputSHA256) || receipt.CreatedAt.IsZero() || receipt.UpdatedAt.IsZero() {
		return fmt.Errorf("%w: invalid invocation receipt", ErrAgentInvocationConflict)
	}
	if completed && (!validLowerHexSHA256(receipt.OutputSHA256) || !json.Valid(receipt.OutputJSON) || len(receipt.OutputJSON) > MaxAgentInvocationOutputBytes || receipt.CompletedAt.IsZero()) {
		return fmt.Errorf("%w: invalid completed invocation receipt", ErrAgentInvocationConflict)
	}
	return nil
}

func cloneRawMessage(value json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), value...)
}

func cloneWorkflowStartIntent(intent WorkflowStartIntent) WorkflowStartIntent {
	clone := intent
	clone.WorkflowInputJSON = cloneRawMessage(intent.WorkflowInputJSON)
	return clone
}

func cloneAgentInvocationReceipt(receipt AgentInvocationReceipt) AgentInvocationReceipt {
	clone := receipt
	clone.OutputJSON = cloneRawMessage(receipt.OutputJSON)
	return clone
}
