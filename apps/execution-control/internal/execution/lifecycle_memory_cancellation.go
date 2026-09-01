package execution

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) RequestRunCancellation(
	_ context.Context,
	request DurableRunCancellationRequest,
) (DurableRun, error) {
	if err := validateDurableRunCancellationRequest(request); err != nil {
		return DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RequestID)
	}
	if run.Status == DurableRunStatusCanceled {
		s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RequestID, request.Now)
		return cloneDurableRun(run), nil
	}
	if durableRunStatusIsTerminal(run.Status) {
		return DurableRun{}, fmt.Errorf("%w: run status is %s", ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RequestID]; requested {
		if command.Reason != request.Reason {
			return DurableRun{}, fmt.Errorf("%w: cancellation reason differs", ErrDurableRunTerminalConflict)
		}
		s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RequestID, request.Now)
		return cloneDurableRun(run), nil
	}
	run.UpdatedAt = request.Now
	event := DurableRunEvent{
		EventID: run.RequestID + ":run-cancel-requested", RequestID: run.RequestID,
		ConversationID: run.ConversationID, EventType: DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}
	if err := s.appendRunEventLocked(run, event); err != nil {
		return DurableRun{}, err
	}
	s.runs[run.RequestID] = cloneDurableRun(run)
	s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
	s.cancellationCommands[run.RequestID] = RunCancellationCommand{
		RequestID: run.RequestID, WorkflowID: "campus-agent.chat." + run.RequestID,
		Reason: request.Reason, State: LifecycleIntentStatePending,
		NextAttemptAt: request.Now, CreatedAt: request.Now, UpdatedAt: request.Now,
	}
	return cloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) requeueConfirmedCancellationLocked(requestID string, now time.Time) {
	command, exists := s.cancellationCommands[requestID]
	if !exists || command.State != LifecycleIntentStateConfirmed {
		return
	}
	command.State = LifecycleIntentStatePending
	command.NextAttemptAt = now
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.LastErrorCode = "late_workflow_start"
	command.UpdatedAt = now
	s.cancellationCommands[requestID] = command
}

func (s *InMemoryRunProjectionStore) supersedeWorkflowStartIntentLocked(requestID string, now time.Time) {
	intent, exists := s.workflowStartIntents[requestID]
	if !exists {
		return
	}
	if intent.State != LifecycleIntentStatePending && intent.State != LifecycleIntentStateLeased {
		return
	}
	intent.State = LifecycleIntentStateSuperseded
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = now
	s.workflowStartIntents[requestID] = cloneWorkflowStartIntent(intent)
}

func (s *InMemoryRunProjectionStore) LeaseRunCancellationCommands(
	_ context.Context,
	request LifecycleLeaseRequest,
) ([]RunCancellationCommand, error) {
	if err := validateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.cancellationCommands))
	for key := range s.cancellationCommands {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	leased := make([]RunCancellationCommand, 0, request.Limit)
	for _, key := range keys {
		command := s.cancellationCommands[key]
		if !lifecycleIntentLeaseable(command.State, command.NextAttemptAt, command.LeaseUntil, request.Now) {
			continue
		}
		command.State = LifecycleIntentStateLeased
		command.LeaseToken = request.LeaseToken
		command.LeaseUntil = request.LeaseUntil
		command.AttemptCount++
		command.UpdatedAt = request.Now
		s.cancellationCommands[key] = command
		leased = append(leased, command)
		if len(leased) == request.Limit {
			break
		}
	}
	return leased, nil
}

func (s *InMemoryRunProjectionStore) ConfirmRunCancellationCommand(
	_ context.Context,
	result RunCancellationCommandResult,
) error {
	return s.updateCancellationCommand(result, LifecycleIntentStateConfirmed)
}

func (s *InMemoryRunProjectionStore) RetryRunCancellationCommand(
	_ context.Context,
	result RunCancellationCommandResult,
) error {
	return s.updateCancellationCommand(result, LifecycleIntentStatePending)
}

func (s *InMemoryRunProjectionStore) updateCancellationCommand(
	result RunCancellationCommandResult,
	state LifecycleIntentState,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	command, exists := s.cancellationCommands[result.RequestID]
	if !exists || command.State != LifecycleIntentStateLeased || command.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: cancellation command request_id=%s", ErrLifecycleLeaseConflict, result.RequestID)
	}
	command.State = state
	command.LastErrorCode = strings.TrimSpace(result.ErrorCode)
	command.NextAttemptAt = result.NextAttemptAt
	command.LeaseToken = ""
	command.LeaseUntil = time.Time{}
	command.UpdatedAt = result.Now
	s.cancellationCommands[result.RequestID] = command
	return nil
}
