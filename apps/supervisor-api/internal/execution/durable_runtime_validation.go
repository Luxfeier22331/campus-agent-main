package execution

import (
	"fmt"
	"time"
)

func validateDurableRun(run DurableRun) error {
	if run.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidDurableRun)
	}
	if run.ConversationID == "" {
		return fmt.Errorf("%w: conversation_id is required", ErrInvalidDurableRun)
	}
	if run.TurnID == "" {
		return fmt.Errorf("%w: turn_id is required", ErrInvalidDurableRun)
	}
	if run.RequestID == "" {
		return fmt.Errorf("%w: request_id is required", ErrInvalidDurableRun)
	}
	if run.OwnerUserID == "" {
		return fmt.Errorf("%w: owner_user_id is required", ErrInvalidDurableRun)
	}
	if run.Surface == "" {
		return fmt.Errorf("%w: surface is required", ErrInvalidDurableRun)
	}
	if !durableLaneValid(run.Lane) {
		return fmt.Errorf("%w: unsupported lane %q", ErrInvalidDurableRun, run.Lane)
	}
	if !durableRunStatusValid(run.Status) {
		return fmt.Errorf("%w: unsupported status %q", ErrInvalidDurableRun, run.Status)
	}
	if durableRunStatusIsTerminal(run.Status) && run.TerminalReason == "" {
		return fmt.Errorf("%w: terminal_reason is required for %s", ErrInvalidDurableRun, run.Status)
	}
	if !durableRunStatusIsTerminal(run.Status) && !run.CompletedAt.IsZero() {
		return fmt.Errorf("%w: active run must not set completed_at", ErrInvalidDurableRun)
	}
	return nil
}

func validateDurableRunEventBase(event DurableRunEvent) error {
	if event.EventID == "" {
		return fmt.Errorf("%w: event_id is required", ErrInvalidRunEvent)
	}
	if event.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidRunEvent)
	}
	if event.ConversationID == "" {
		return fmt.Errorf("%w: conversation_id is required", ErrInvalidRunEvent)
	}
	if event.Sequence < 1 {
		return fmt.Errorf("%w: sequence must start at 1", ErrInvalidRunEvent)
	}
	if event.EventType == "" {
		return fmt.Errorf("%w: event_type is required", ErrInvalidRunEvent)
	}
	if event.Visibility == "" {
		return fmt.Errorf("%w: visibility is required", ErrInvalidRunEvent)
	}
	if event.PayloadSchemaVersion == "" {
		return fmt.Errorf("%w: payload_schema_version is required", ErrInvalidRunEvent)
	}
	if event.Payload == nil {
		return fmt.Errorf("%w: payload is required", ErrInvalidRunEvent)
	}
	return nil
}

func validateExecutionLeaseRequest(request ExecutionLeaseRequest) error {
	if request.LeaseID == "" {
		return fmt.Errorf("%w: lease_id is required", ErrInvalidExecutionLease)
	}
	if request.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidExecutionLease)
	}
	if request.StepID == "" {
		return fmt.Errorf("%w: step_id is required", ErrInvalidExecutionLease)
	}
	if !durableLaneValid(request.Lane) {
		return fmt.Errorf("%w: unsupported lane %q", ErrInvalidExecutionLease, request.Lane)
	}
	if request.WorkerID == "" {
		return fmt.Errorf("%w: worker_id is required", ErrInvalidExecutionLease)
	}
	if request.Attempt < 1 {
		return fmt.Errorf("%w: attempt must be positive", ErrInvalidExecutionLease)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidExecutionLease)
	}
	if !request.ExpiresAt.After(request.Now) {
		return fmt.Errorf("%w: expires_at must be after acquired_at", ErrInvalidExecutionLease)
	}
	return nil
}

func validateNextExecutionLeaseRequest(request NextExecutionLeaseRequest) error {
	if request.LeaseID == "" {
		return fmt.Errorf("%w: lease_id is required", ErrInvalidExecutionLease)
	}
	if request.StepID == "" {
		return fmt.Errorf("%w: step_id is required", ErrInvalidExecutionLease)
	}
	if !durableLaneValid(request.Lane) {
		return fmt.Errorf("%w: unsupported lane %q", ErrInvalidExecutionLease, request.Lane)
	}
	if request.WorkerID == "" {
		return fmt.Errorf("%w: worker_id is required", ErrInvalidExecutionLease)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidExecutionLease)
	}
	if !request.ExpiresAt.After(request.Now) {
		return fmt.Errorf("%w: expires_at must be after acquired_at", ErrInvalidExecutionLease)
	}
	return nil
}

func validateExecutionLease(lease ExecutionLease) error {
	if lease.LeaseID == "" {
		return fmt.Errorf("%w: lease_id is required", ErrInvalidExecutionLease)
	}
	if lease.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidExecutionLease)
	}
	if lease.StepID == "" {
		return fmt.Errorf("%w: step_id is required", ErrInvalidExecutionLease)
	}
	if !durableLaneValid(lease.Lane) {
		return fmt.Errorf("%w: unsupported lane %q", ErrInvalidExecutionLease, lease.Lane)
	}
	if lease.WorkerID == "" {
		return fmt.Errorf("%w: worker_id is required", ErrInvalidExecutionLease)
	}
	if lease.Attempt < 1 {
		return fmt.Errorf("%w: attempt must be positive", ErrInvalidExecutionLease)
	}
	if lease.Status == "" {
		return fmt.Errorf("%w: status is required", ErrInvalidExecutionLease)
	}
	if lease.Status == ExecutionLeaseStatusLeased && !lease.ExpiresAt.After(lease.HeartbeatAt) {
		return fmt.Errorf("%w: expires_at must be after heartbeat_at", ErrInvalidExecutionLease)
	}
	return nil
}

func validateExpiredLeaseRecoveryRequest(request ExpiredLeaseRecoveryRequest) error {
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidExpiredLeaseRecovery)
	}
	if request.ReleaseReason == "" {
		return fmt.Errorf("%w: release_reason is required", ErrInvalidExpiredLeaseRecovery)
	}
	if request.TerminalReason == "" {
		return fmt.Errorf("%w: terminal_reason is required", ErrInvalidExpiredLeaseRecovery)
	}
	if request.TerminalReason != DurableTerminalReasonLeaseExpired {
		return fmt.Errorf(
			"%w: unsupported terminal_reason %q",
			ErrInvalidExpiredLeaseRecovery,
			request.TerminalReason,
		)
	}
	if request.MaxRetryAttempts < 1 {
		return fmt.Errorf("%w: max_retry_attempts must be positive", ErrInvalidExpiredLeaseRecovery)
	}
	return nil
}

func validateTimedOutRunRecoveryRequest(request TimedOutRunRecoveryRequest) error {
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidTimedOutRunRecovery)
	}
	return nil
}

func validateDurableRunCancelRequest(request DurableRunCancelRequest) error {
	if request.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidDurableRunCancel)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidDurableRunCancel)
	}
	if request.ReleaseReason == "" {
		return fmt.Errorf("%w: release_reason is required", ErrInvalidDurableRunCancel)
	}
	return nil
}

func validateLaneBudget(budget LaneBudget) error {
	if !durableLaneValid(budget.Lane) {
		return fmt.Errorf("%w: unsupported lane %q", ErrInvalidLaneBudget, budget.Lane)
	}
	if budget.MaxActiveLeases < 1 {
		return fmt.Errorf("%w: max_active_leases must be positive", ErrInvalidLaneBudget)
	}
	if budget.MaxQueuedRuns < 0 {
		return fmt.Errorf("%w: max_queued_runs must not be negative", ErrInvalidLaneBudget)
	}
	if budget.QueueTimeout <= 0 {
		return fmt.Errorf("%w: queue_timeout must be positive", ErrInvalidLaneBudget)
	}
	if budget.RunTimeout <= 0 {
		return fmt.Errorf("%w: run_timeout must be positive", ErrInvalidLaneBudget)
	}
	if budget.LeaseTimeout <= 0 {
		return fmt.Errorf("%w: lease_timeout must be positive", ErrInvalidLaneBudget)
	}
	if budget.WorkerHeartbeatTimeout <= 0 {
		return fmt.Errorf("%w: worker_heartbeat_timeout must be positive", ErrInvalidLaneBudget)
	}
	return nil
}

func validateWorkerHeartbeat(heartbeat WorkerHeartbeat) error {
	if heartbeat.WorkerID == "" {
		return fmt.Errorf("%w: worker_id is required", ErrWorkerHeartbeatInvalid)
	}
	if heartbeat.WorkerKind == "" {
		return fmt.Errorf("%w: worker_kind is required", ErrWorkerHeartbeatInvalid)
	}
	if len(heartbeat.Lanes) == 0 {
		return fmt.Errorf("%w: lanes are required", ErrWorkerHeartbeatInvalid)
	}
	for _, lane := range heartbeat.Lanes {
		if !durableLaneValid(lane) {
			return fmt.Errorf("%w: unsupported lane %q", ErrWorkerHeartbeatInvalid, lane)
		}
	}
	switch heartbeat.Status {
	case WorkerHeartbeatStatusReady, WorkerHeartbeatStatusDraining, WorkerHeartbeatStatusOffline:
	default:
		return fmt.Errorf("%w: unsupported status %q", ErrWorkerHeartbeatInvalid, heartbeat.Status)
	}
	if heartbeat.HeartbeatAt.IsZero() {
		return fmt.Errorf("%w: heartbeat_at is required", ErrWorkerHeartbeatInvalid)
	}
	if heartbeat.StartedAt.IsZero() {
		return fmt.Errorf("%w: started_at is required", ErrWorkerHeartbeatInvalid)
	}
	return nil
}

func validateWorkerCanLease(
	heartbeat WorkerHeartbeat,
	lane DurableLane,
	now time.Time,
	budget LaneBudget,
) error {
	if heartbeat.Status != WorkerHeartbeatStatusReady {
		return fmt.Errorf(
			"%w: worker %s status is %s",
			ErrWorkerHeartbeatInvalid,
			heartbeat.WorkerID,
			heartbeat.Status,
		)
	}
	if !workerHeartbeatHasLane(heartbeat, lane) {
		return fmt.Errorf(
			"%w: worker %s does not serve lane %s",
			ErrWorkerHeartbeatInvalid,
			heartbeat.WorkerID,
			lane,
		)
	}
	if now.Sub(heartbeat.HeartbeatAt) > budget.WorkerHeartbeatTimeout {
		return fmt.Errorf(
			"%w: worker %s heartbeat is stale",
			ErrWorkerHeartbeatInvalid,
			heartbeat.WorkerID,
		)
	}
	return nil
}

func durableRunStatusValid(status DurableRunStatus) bool {
	switch status {
	case DurableRunStatusCreated, DurableRunStatusQueued, DurableRunStatusAdmitted,
		DurableRunStatusRunning, DurableRunStatusStreaming, DurableRunStatusCompleted,
		DurableRunStatusFailed, DurableRunStatusCanceled, DurableRunStatusExpired:
		return true
	default:
		return false
	}
}

func durableRunStatusIsActive(status DurableRunStatus) bool {
	switch status {
	case DurableRunStatusCreated, DurableRunStatusQueued, DurableRunStatusAdmitted,
		DurableRunStatusRunning, DurableRunStatusStreaming:
		return true
	default:
		return false
	}
}

func durableRunStatusIsTerminal(status DurableRunStatus) bool {
	switch status {
	case DurableRunStatusCompleted, DurableRunStatusFailed, DurableRunStatusCanceled,
		DurableRunStatusExpired:
		return true
	default:
		return false
	}
}

func durableRunTransitionAllowed(from DurableRunStatus, to DurableRunStatus) bool {
	if !durableRunStatusValid(from) || !durableRunStatusValid(to) {
		return false
	}
	if durableRunStatusIsTerminal(from) {
		return false
	}
	switch from {
	case DurableRunStatusCreated:
		return to == DurableRunStatusQueued ||
			to == DurableRunStatusCanceled ||
			to == DurableRunStatusFailed ||
			to == DurableRunStatusExpired
	case DurableRunStatusQueued:
		return to == DurableRunStatusAdmitted ||
			to == DurableRunStatusCanceled ||
			to == DurableRunStatusFailed ||
			to == DurableRunStatusExpired
	case DurableRunStatusAdmitted:
		return to == DurableRunStatusRunning ||
			to == DurableRunStatusCanceled ||
			to == DurableRunStatusFailed ||
			to == DurableRunStatusExpired
	case DurableRunStatusRunning:
		return to == DurableRunStatusStreaming ||
			to == DurableRunStatusQueued ||
			to == DurableRunStatusCompleted ||
			to == DurableRunStatusCanceled ||
			to == DurableRunStatusFailed ||
			to == DurableRunStatusExpired
	case DurableRunStatusStreaming:
		return to == DurableRunStatusQueued ||
			to == DurableRunStatusCompleted ||
			to == DurableRunStatusCanceled ||
			to == DurableRunStatusFailed ||
			to == DurableRunStatusExpired
	default:
		return false
	}
}

func durableLaneValid(lane DurableLane) bool {
	switch lane {
	case DurableLaneRAG, DurableLaneNotice, DurableLaneNavigation, DurableLaneCampusServices,
		DurableLaneDefault:
		return true
	default:
		return false
	}
}

func recordDurableRunStatusTimestamp(run *DurableRun, status DurableRunStatus, now time.Time) {
	switch status {
	case DurableRunStatusQueued:
		run.QueuedAt = now
	case DurableRunStatusAdmitted:
		run.AdmittedAt = now
	case DurableRunStatusRunning:
		run.StartedAt = now
	case DurableRunStatusStreaming:
		run.StreamingStartedAt = now
	case DurableRunStatusCompleted, DurableRunStatusFailed, DurableRunStatusCanceled,
		DurableRunStatusExpired:
		run.CompletedAt = now
	}
}

func executionLeaseActiveKey(runID string, stepID string) string {
	return runID + "\x00" + stepID
}

func activeLeaseCountForLane(leases map[string]ExecutionLease, lane DurableLane) int {
	count := 0
	for _, lease := range leases {
		if lease.Lane == lane && lease.Status == ExecutionLeaseStatusLeased {
			count++
		}
	}
	return count
}

func workerHeartbeatHasLane(heartbeat WorkerHeartbeat, lane DurableLane) bool {
	for _, workerLane := range heartbeat.Lanes {
		if workerLane == lane {
			return true
		}
	}
	return false
}

func cloneDurableRun(run DurableRun) DurableRun {
	clone := run
	clone.RuntimeVersions = cloneAnyMap(run.RuntimeVersions)
	clone.Metadata = cloneAnyMap(run.Metadata)
	return clone
}

func cloneDurableRunEvent(event DurableRunEvent) DurableRunEvent {
	clone := event
	clone.Payload = cloneAnyMap(event.Payload)
	return clone
}

func cloneWorkerHeartbeat(heartbeat WorkerHeartbeat) WorkerHeartbeat {
	clone := heartbeat
	clone.Lanes = append([]DurableLane{}, heartbeat.Lanes...)
	clone.Metadata = cloneAnyMap(heartbeat.Metadata)
	return clone
}
