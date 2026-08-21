package execution

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
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
	if err := validateDurableRunMetadata(run); err != nil {
		return err
	}
	if run.RequestFingerprintSHA256 != "" && !validLowerHexSHA256(run.RequestFingerprintSHA256) {
		return fmt.Errorf("%w: request fingerprint must be a lowercase SHA-256", ErrInvalidDurableRun)
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

func validateDurableRunMetadata(run DurableRun) error {
	if len(run.Metadata) != 3 {
		return fmt.Errorf("%w: metadata must contain only execution input references", ErrInvalidDurableRun)
	}
	for key := range run.Metadata {
		switch key {
		case "execution_contract_version", "execution_input_ref", "execution_input_sha256":
		default:
			return fmt.Errorf("%w: metadata field %s is forbidden", ErrInvalidDurableRun, key)
		}
	}
	contractVersion, ok := run.Metadata["execution_contract_version"].(string)
	if !ok {
		return fmt.Errorf("%w: metadata.execution_contract_version must be a string", ErrInvalidDurableRun)
	}
	inputRef, ok := run.Metadata["execution_input_ref"].(string)
	if !ok {
		return fmt.Errorf("%w: metadata.execution_input_ref must be a string", ErrInvalidDurableRun)
	}
	inputSHA256, ok := run.Metadata["execution_input_sha256"].(string)
	if !ok {
		return fmt.Errorf("%w: metadata.execution_input_sha256 must be a string", ErrInvalidDurableRun)
	}
	metadata := contracts.ExecutionRunMetadataWire{
		ExecutionContractVersion: contractVersion,
		ExecutionInputRef:        inputRef,
		ExecutionInputSHA256:     inputSHA256,
	}
	if err := metadata.Validate(run.RunID); err != nil {
		return fmt.Errorf("%w: metadata: %v", ErrInvalidDurableRun, err)
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
	if event.EventType == DurableRunEventTypeRunProgress {
		if event.Visibility != DurableRunEventVisibilityBrowser {
			return fmt.Errorf("%w: run.progress visibility must be browser", ErrInvalidRunEvent)
		}
		for key := range event.Payload {
			switch key {
			case "phase", "request_id", "trace_id":
			default:
				return fmt.Errorf("%w: browser run.progress payload contains forbidden field %s", ErrInvalidRunEvent, key)
			}
		}
		phase, phaseOK := event.Payload["phase"].(string)
		requestID, requestIDOK := event.Payload["request_id"].(string)
		traceID, traceIDOK := event.Payload["trace_id"].(string)
		if !phaseOK || !durableRunProgressPhaseValid(DurableRunProgressPhase(phase)) {
			return fmt.Errorf("%w: browser run.progress phase is invalid", ErrInvalidRunEvent)
		}
		if !requestIDOK || strings.TrimSpace(requestID) == "" || !traceIDOK || strings.TrimSpace(traceID) == "" {
			return fmt.Errorf("%w: browser run.progress request_id and trace_id are required", ErrInvalidRunEvent)
		}
		if event.EventID != event.RunID+":progress:"+phase {
			return fmt.Errorf("%w: browser run.progress event_id is invalid", ErrInvalidRunEvent)
		}
	}
	if event.EventType == DurableRunEventTypeFinalizationCompleted &&
		event.Visibility == DurableRunEventVisibilityBrowser {
		for key := range event.Payload {
			if key != "request_id" && key != "trace_id" {
				return fmt.Errorf("%w: browser finalization.completed payload must contain only request_id and trace_id", ErrInvalidRunEvent)
			}
		}
	}
	if event.EventType == DurableRunEventTypeRunCanceled &&
		event.Visibility == DurableRunEventVisibilityBrowser {
		for key := range event.Payload {
			switch key {
			case "request_id", "trace_id", "status", "terminal_reason":
			default:
				return fmt.Errorf("%w: browser run.canceled payload contains forbidden field %s", ErrInvalidRunEvent, key)
			}
		}
	}
	return nil
}

func durableRunProgressPhaseValid(phase DurableRunProgressPhase) bool {
	switch phase {
	case DurableRunProgressPhaseGenerating,
		DurableRunProgressPhaseFinalizing:
		return true
	default:
		return false
	}
}

func validLowerHexSHA256(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return false
	}
	return true
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
	request.FailCloseReason = strings.TrimSpace(request.FailCloseReason)
	request.Now = request.Now.UTC().Truncate(time.Microsecond)
	request.TerminalEvent.OccurredAt = request.TerminalEvent.OccurredAt.UTC().Truncate(time.Microsecond)
	return request
}

func validateDurableRunExpireRequest(request DurableRunExpireRequest) error {
	if strings.TrimSpace(request.RunID) == "" {
		return fmt.Errorf("%w: run_id is required", ErrInvalidDurableRun)
	}
	if request.Now.IsZero() {
		return fmt.Errorf("%w: now is required", ErrInvalidDurableRun)
	}
	return nil
}

func durableRunExpiredEvent(run DurableRun, expiredAt time.Time) DurableRunEvent {
	return DurableRunEvent{
		EventID:              run.RunID + ":run-expired",
		RunID:                run.RunID,
		ConversationID:       run.ConversationID,
		EventType:            DurableRunEventTypeRunExpired,
		OccurredAt:           expiredAt,
		Visibility:           DurableRunEventVisibilityBrowser,
		PayloadSchemaVersion: "run-event-v1",
		Payload: map[string]any{
			"error": map[string]any{
				"code": "execution_timeout", "message": "The execution exceeded its workflow timeout.", "retryable": true,
			},
			"request_id":      run.RequestID,
			"status":          string(DurableRunStatusExpired),
			"terminal_reason": string(DurableTerminalReasonRunTimeout),
			"timeout_outcome": string(TimeoutOutcomeWorkflowTimeout),
			"trace_id":        run.TraceID,
		},
	}
}

func validateDurableRunExpiryReplay(
	run DurableRun,
	request DurableRunExpireRequest,
	storedEvent DurableRunEvent,
) error {
	expected := durableRunExpiredEvent(run, request.Now)
	if run.Status != DurableRunStatusExpired ||
		run.TerminalReason != DurableTerminalReasonRunTimeout ||
		!run.CompletedAt.Equal(request.Now) ||
		storedEvent.EventID != expected.EventID || storedEvent.RunID != expected.RunID ||
		storedEvent.ConversationID != expected.ConversationID || storedEvent.EventType != expected.EventType ||
		storedEvent.Visibility != expected.Visibility ||
		storedEvent.PayloadSchemaVersion != expected.PayloadSchemaVersion ||
		!storedEvent.OccurredAt.Equal(expected.OccurredAt) {
		return fmt.Errorf("%w: terminal run or event identity differs", ErrDurableRunExpiryConflict)
	}
	storedFingerprint, storedErr := durableRunEventPayloadFingerprint(storedEvent.Payload)
	expectedFingerprint, expectedErr := durableRunEventPayloadFingerprint(expected.Payload)
	if storedErr != nil || expectedErr != nil || storedFingerprint != expectedFingerprint {
		return fmt.Errorf("%w: terminal event payload differs", ErrDurableRunExpiryConflict)
	}
	return nil
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
	if run.Status != DurableRunStatusFailed ||
		run.TerminalReason != request.TerminalReason ||
		run.FailCloseReason != request.FailCloseReason ||
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
