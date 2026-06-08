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

func validateDurableRunCancelRequest(request DurableRunCancelRequest) error {
	if request.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidDurableRunCancel)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidDurableRunCancel)
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
