package execution

import "time"

// The exported rule functions are the narrow seam used by the persistence
// adapter. Keeping these operations here makes validation and lifecycle
// invariants owned by the runtime-neutral execution package rather than by a
// particular storage implementation.

func ValidateDurableRun(run DurableRun) error { return validateDurableRun(run) }
func ValidateDurableRunEventBase(event DurableRunEvent) error {
	return validateDurableRunEventBase(event)
}
func ValidateDurableRunCancelRequest(request DurableRunCancelRequest) error {
	return validateDurableRunCancelRequest(request)
}
func ValidateDurableRunCompleteRequest(request DurableRunCompleteRequest) error {
	return validateDurableRunCompleteRequest(request)
}
func ValidateDurableRunFailRequest(request DurableRunFailRequest) error {
	return validateDurableRunFailRequest(request)
}
func ValidateDurableRunExpireRequest(request DurableRunExpireRequest) error {
	return validateDurableRunExpireRequest(request)
}
func CanonicalizeDurableRunFailRequest(request DurableRunFailRequest) DurableRunFailRequest {
	return canonicalizeDurableRunFailRequest(request)
}
func DurableRunExpiredEvent(run DurableRun, expiredAt time.Time) DurableRunEvent {
	return durableRunExpiredEvent(run, expiredAt)
}
func ValidateDurableRunExpiryReplay(run DurableRun, request DurableRunExpireRequest, storedEvent DurableRunEvent) error {
	return validateDurableRunExpiryReplay(run, request, storedEvent)
}
func ValidateDurableRunFailureEventForRun(run DurableRun, event DurableRunEvent) error {
	return validateDurableRunFailureEventForRun(run, event)
}
func ValidateDurableRunFailureReplay(run DurableRun, request DurableRunFailRequest, storedEvent DurableRunEvent) error {
	return validateDurableRunFailureReplay(run, request, storedEvent)
}
func DurableRunStatusIsActive(status DurableRunStatus) bool { return durableRunStatusIsActive(status) }
func DurableRunStatusIsTerminal(status DurableRunStatus) bool {
	return durableRunStatusIsTerminal(status)
}
func DurableRunTransitionAllowed(from DurableRunStatus, to DurableRunStatus) bool {
	return durableRunTransitionAllowed(from, to)
}
func RecordDurableRunStatusTimestamp(run *DurableRun, status DurableRunStatus, now time.Time) {
	recordDurableRunStatusTimestamp(run, status, now)
}
func CloneDurableRun(run DurableRun) DurableRun                  { return cloneDurableRun(run) }
func CloneDurableRunEvent(event DurableRunEvent) DurableRunEvent { return cloneDurableRunEvent(event) }
func ValidLowerHexSHA256(value string) bool                      { return validLowerHexSHA256(value) }

func ValidateLifecycleLeaseRequest(request LifecycleLeaseRequest) error {
	return validateLifecycleLeaseRequest(request)
}
func LifecycleIntentLeaseable(state LifecycleIntentState, next, leaseUntil, now time.Time) bool {
	return lifecycleIntentLeaseable(state, next, leaseUntil, now)
}
func LeasedWorkflowStartIntent(intents map[string]WorkflowStartIntent, result WorkflowStartIntentResult) (WorkflowStartIntent, error) {
	return leasedWorkflowStartIntent(intents, result)
}
func ValidateDurableRunCancellationRequest(request DurableRunCancellationRequest) error {
	return validateDurableRunCancellationRequest(request)
}
func ValidateAgentInvocationReceipt(receipt AgentInvocationReceipt, completed bool) error {
	return validateAgentInvocationReceipt(receipt, completed)
}
func CloneWorkflowStartIntent(intent WorkflowStartIntent) WorkflowStartIntent {
	return cloneWorkflowStartIntent(intent)
}
func CloneAgentInvocationReceipt(receipt AgentInvocationReceipt) AgentInvocationReceipt {
	return cloneAgentInvocationReceipt(receipt)
}

func CanonicalizeRunProjectionFinalizeRequest(
	request RunProjectionFinalizeRequest,
) (RunProjectionFinalizeRequest, error) {
	return canonicalizeRunProjectionFinalizeRequest(request)
}
func ValidateCanonicalFinalizationRecords(
	run DurableRun,
	completion DurableRunCompleteRequest,
	step RunStepProjection,
	attempt StepAttemptProjection,
	result StepResultProjection,
	fingerprint string,
) error {
	return validateCanonicalFinalizationRecords(run, completion, step, attempt, result, fingerprint)
}
func CompleteDurableRunForFinalization(
	run DurableRun,
	completion DurableRunCompleteRequest,
) (DurableRun, error) {
	return completeDurableRunForFinalization(run, completion)
}
func DurableRunFinalizationReplayMatches(
	run DurableRun,
	completion DurableRunCompleteRequest,
) bool {
	return durableRunFinalizationReplayMatches(run, completion)
}
func CompletionWonCancellationCommand(
	command RunCancellationCommand,
	now time.Time,
) (RunCancellationCommand, error) {
	return completionWonCancellationCommand(command, now)
}
func RunFinalizationConflict(format string, args ...any) error {
	return runFinalizationConflict(format, args...)
}
