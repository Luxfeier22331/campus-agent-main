package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"sort"
	"strings"
	"time"
)

func (s *InMemoryRunProjectionStore) RequestRunCancellation(
	_ context.Context,
	request execution.DurableRunCancellationRequest,
) (execution.DurableRun, error) {
	if err := execution.ValidateDurableRunCancellationRequest(request); err != nil {
		return execution.DurableRun{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
	}
	if run.Status == execution.DurableRunStatusCanceled {
		s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RequestID, request.Now)
		return execution.CloneDurableRun(run), nil
	}
	if execution.DurableRunStatusIsTerminal(run.Status) {
		return execution.DurableRun{}, fmt.Errorf("%w: run status is %s", execution.ErrDurableRunTerminalConflict, run.Status)
	}
	if command, requested := s.cancellationCommands[run.RequestID]; requested {
		if command.Reason != request.Reason {
			return execution.DurableRun{}, fmt.Errorf("%w: cancellation reason differs", execution.ErrDurableRunTerminalConflict)
		}
		s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
		s.requeueConfirmedCancellationLocked(run.RequestID, request.Now)
		return execution.CloneDurableRun(run), nil
	}
	run.UpdatedAt = request.Now
	event := execution.DurableRunEvent{
		EventID: run.RequestID + ":run-cancel-requested", RequestID: run.RequestID,
		ConversationID: run.ConversationID, EventType: execution.DurableRunEventTypeRunCancelRequested,
		OccurredAt: request.Now, Visibility: execution.DurableRunEventVisibilityInternal,
		PayloadSchemaVersion: "run-event-v1",
		Payload:              map[string]any{"status": "cancel_requested"},
	}
	if err := s.appendRunEventLocked(run, event); err != nil {
		return execution.DurableRun{}, err
	}
	s.runs[run.RequestID] = execution.CloneDurableRun(run)
	s.supersedeWorkflowStartIntentLocked(run.RequestID, request.Now)
	s.cancellationCommands[run.RequestID] = execution.RunCancellationCommand{
		RequestID: run.RequestID, WorkflowID: "campus-agent.chat." + run.RequestID,
		Reason: request.Reason, State: execution.LifecycleIntentStatePending,
		NextAttemptAt: request.Now, CreatedAt: request.Now, UpdatedAt: request.Now,
	}
	return execution.CloneDurableRun(run), nil
}

func (s *InMemoryRunProjectionStore) requeueConfirmedCancellationLocked(requestID string, now time.Time) {
	command, exists := s.cancellationCommands[requestID]
	if !exists || command.State != execution.LifecycleIntentStateConfirmed {
		return
	}
	command.State = execution.LifecycleIntentStatePending
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
	if intent.State != execution.LifecycleIntentStatePending && intent.State != execution.LifecycleIntentStateLeased {
		return
	}
	intent.State = execution.LifecycleIntentStateSuperseded
	intent.LeaseToken = ""
	intent.LeaseUntil = time.Time{}
	intent.UpdatedAt = now
	s.workflowStartIntents[requestID] = execution.CloneWorkflowStartIntent(intent)
}

func (s *InMemoryRunProjectionStore) LeaseRunCancellationCommands(
	_ context.Context,
	request execution.LifecycleLeaseRequest,
) ([]execution.RunCancellationCommand, error) {
	if err := execution.ValidateLifecycleLeaseRequest(request); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	keys := make([]string, 0, len(s.cancellationCommands))
	for key := range s.cancellationCommands {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	leased := make([]execution.RunCancellationCommand, 0, request.Limit)
	for _, key := range keys {
		command := s.cancellationCommands[key]
		if !execution.LifecycleIntentLeaseable(command.State, command.NextAttemptAt, command.LeaseUntil, request.Now) {
			continue
		}
		command.State = execution.LifecycleIntentStateLeased
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
	result execution.RunCancellationCommandResult,
) error {
	return s.updateCancellationCommand(result, execution.LifecycleIntentStateConfirmed)
}

func (s *InMemoryRunProjectionStore) RetryRunCancellationCommand(
	_ context.Context,
	result execution.RunCancellationCommandResult,
) error {
	return s.updateCancellationCommand(result, execution.LifecycleIntentStatePending)
}

func (s *InMemoryRunProjectionStore) updateCancellationCommand(
	result execution.RunCancellationCommandResult,
	state execution.LifecycleIntentState,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	command, exists := s.cancellationCommands[result.RequestID]
	if !exists || command.State != execution.LifecycleIntentStateLeased || command.LeaseToken != result.LeaseToken {
		return fmt.Errorf("%w: cancellation command request_id=%s", execution.ErrLifecycleLeaseConflict, result.RequestID)
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
