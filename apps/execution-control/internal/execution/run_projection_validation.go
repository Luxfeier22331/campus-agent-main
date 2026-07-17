package execution

import (
	"crypto/sha256"
	"encoding/hex"
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
	if run.TaskQueue == "" {
		return fmt.Errorf("%w: task_queue is required", ErrInvalidDurableRun)
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
	if event.EventType == DurableRunEventTypeFinalizationCompleted &&
		event.Visibility == DurableRunEventVisibilityBrowser {
		for key := range event.Payload {
			if key != "request_id" && key != "trace_id" {
				return fmt.Errorf("%w: browser finalization.completed payload must contain only request_id and trace_id", ErrInvalidRunEvent)
			}
		}
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

func validateDurableRunCompleteRequest(request DurableRunCompleteRequest) error {
	if request.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidDurableRunComplete)
	}
	if request.TerminalReason == "" {
		return fmt.Errorf("%w: terminal_reason is required", ErrInvalidDurableRunComplete)
	}
	if request.FinalResponseRef == "" {
		return fmt.Errorf("%w: final_response_ref is required", ErrInvalidDurableRunComplete)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidDurableRunComplete)
	}
	return nil
}

func validateDurableRunFailRequest(request DurableRunFailRequest) error {
	if request.RunID == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidDurableRun)
	}
	if request.TerminalReason == "" {
		return fmt.Errorf("%w: terminal_reason is required", ErrInvalidDurableRun)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidDurableRun)
	}
	event := request.TerminalEvent
	if event.Sequence != 0 {
		return fmt.Errorf("%w: terminal event sequence must be store-assigned", ErrInvalidDurableRun)
	}
	if event.EventID != request.RunID+":run-failed" {
		return fmt.Errorf("%w: terminal event id must be <run_id>:run-failed", ErrInvalidDurableRun)
	}
	if event.RunID != request.RunID {
		return fmt.Errorf("%w: terminal event run_id must match request run_id", ErrInvalidDurableRun)
	}
	if event.EventType != DurableRunEventTypeRunFailed {
		return fmt.Errorf("%w: terminal event type must be run.failed", ErrInvalidDurableRun)
	}
	if event.Visibility != DurableRunEventVisibilityBrowser {
		return fmt.Errorf("%w: terminal event visibility must be browser", ErrInvalidDurableRun)
	}
	if event.OccurredAt.IsZero() {
		return fmt.Errorf("%w: terminal event occurred_at is required", ErrInvalidDurableRun)
	}
	if !event.OccurredAt.Equal(request.Now) {
		return fmt.Errorf("%w: terminal event occurred_at must equal now", ErrInvalidDurableRun)
	}
	event.Sequence = 1
	if err := validateDurableRunEventBase(event); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidDurableRun, err)
	}
	if _, err := durableRunEventPayloadFingerprint(event.Payload); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidDurableRun, err)
	}
	return nil
}

func canonicalizeDurableRunFailRequest(request DurableRunFailRequest) DurableRunFailRequest {
	request.Now = request.Now.UTC().Truncate(time.Microsecond)
	request.TerminalEvent.OccurredAt = request.TerminalEvent.OccurredAt.UTC().Truncate(time.Microsecond)
	return request
}

func validateDurableRunFailureEventForRun(run DurableRun, event DurableRunEvent) error {
	if event.RunID != run.RunID || event.ConversationID != run.ConversationID {
		return fmt.Errorf(
			"%w: terminal event identity does not match run",
			ErrDurableRunFailureConflict,
		)
	}
	return nil
}

func validateDurableRunFailureReplay(
	run DurableRun,
	request DurableRunFailRequest,
	storedEvent DurableRunEvent,
) error {
	requestedEvent := request.TerminalEvent
	expectedSelectedTool := run.SelectedTool
	if request.SelectedTool != "" {
		expectedSelectedTool = request.SelectedTool
	}
	if run.Status != DurableRunStatusFailed ||
		run.TerminalReason != request.TerminalReason ||
		run.SelectedTool != expectedSelectedTool ||
		storedEvent.EventID != requestedEvent.EventID ||
		storedEvent.RunID != requestedEvent.RunID ||
		storedEvent.ConversationID != requestedEvent.ConversationID ||
		storedEvent.EventType != requestedEvent.EventType ||
		storedEvent.Visibility != requestedEvent.Visibility ||
		storedEvent.PayloadSchemaVersion != requestedEvent.PayloadSchemaVersion ||
		!storedEvent.OccurredAt.Equal(requestedEvent.OccurredAt) {
		return fmt.Errorf("%w: terminal run or event identity differs", ErrDurableRunFailureConflict)
	}
	storedFingerprint, err := durableRunEventPayloadFingerprint(storedEvent.Payload)
	if err != nil {
		return fmt.Errorf("%w: stored terminal event payload is invalid: %v", ErrDurableRunFailureConflict, err)
	}
	requestedFingerprint, err := durableRunEventPayloadFingerprint(requestedEvent.Payload)
	if err != nil {
		return fmt.Errorf("%w: requested terminal event payload is invalid: %v", ErrDurableRunFailureConflict, err)
	}
	if storedFingerprint != requestedFingerprint {
		return fmt.Errorf("%w: terminal event payload fingerprint differs", ErrDurableRunFailureConflict)
	}
	return nil
}

func durableRunEventPayloadFingerprint(payload map[string]any) (string, error) {
	payloadJSON, err := jsonMapToBytes(payload)
	if err != nil {
		return "", fmt.Errorf("encode terminal event payload: %w", err)
	}
	sum := sha256.Sum256(payloadJSON)
	return hex.EncodeToString(sum[:]), nil
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
