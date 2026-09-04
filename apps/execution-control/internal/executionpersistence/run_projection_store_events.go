package executionpersistence

import (
	"context"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func (s *InMemoryRunProjectionStore) AppendRunEvent(
	_ context.Context,
	event execution.DurableRunEvent,
) (execution.DurableRunEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[event.RequestID]
	if !exists {
		return execution.DurableRunEvent{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, event.RequestID)
	}
	if event.ConversationID != run.ConversationID {
		return execution.DurableRunEvent{}, fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			execution.ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	events := s.runEvents[event.RequestID]
	expectedSequence := int64(len(events) + 1)
	if event.Sequence == 0 {
		event.Sequence = expectedSequence
	}
	if event.Sequence != expectedSequence {
		return execution.DurableRunEvent{}, fmt.Errorf(
			"%w: sequence %d, want %d",
			execution.ErrInvalidRunEvent,
			event.Sequence,
			expectedSequence,
		)
	}
	if err := execution.ValidateDurableRunEventBase(event); err != nil {
		return execution.DurableRunEvent{}, err
	}
	for _, existing := range events {
		if existing.EventID == event.EventID {
			return execution.DurableRunEvent{}, fmt.Errorf(
				"%w: event_id %s already exists",
				execution.ErrInvalidRunEvent,
				event.EventID,
			)
		}
	}
	eventClone := execution.CloneDurableRunEvent(event)
	s.runEvents[event.RequestID] = append(events, eventClone)
	s.notifyRunEventWaitersLocked(event.RequestID)
	return execution.CloneDurableRunEvent(eventClone), nil
}

func (s *InMemoryRunProjectionStore) appendRunEventLocked(
	run execution.DurableRun,
	event execution.DurableRunEvent,
) error {
	events := s.runEvents[run.RequestID]
	event.Sequence = int64(len(events) + 1)
	if event.ConversationID != run.ConversationID {
		return fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			execution.ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	if err := execution.ValidateDurableRunEventBase(event); err != nil {
		return err
	}
	for _, existing := range events {
		if existing.EventID == event.EventID {
			return fmt.Errorf("%w: event_id %s already exists", execution.ErrInvalidRunEvent, event.EventID)
		}
	}
	s.runEvents[run.RequestID] = append(events, execution.CloneDurableRunEvent(event))
	s.notifyRunEventWaitersLocked(run.RequestID)
	return nil
}

func (s *InMemoryRunProjectionStore) ListRunEvents(
	_ context.Context,
	requestID string,
) ([]execution.DurableRunEvent, error) {
	return s.ListRunEventsAfter(context.Background(), requestID, 0)
}

func (s *InMemoryRunProjectionStore) ListRunEventsAfter(
	_ context.Context,
	requestID string,
	afterSequence int64,
) ([]execution.DurableRunEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[requestID]; !exists {
		return nil, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	events := s.runEvents[requestID]
	cloned := make([]execution.DurableRunEvent, 0, len(events))
	for _, event := range events {
		if event.Sequence <= afterSequence {
			continue
		}
		cloned = append(cloned, execution.CloneDurableRunEvent(event))
	}
	return cloned, nil
}

func (s *InMemoryRunProjectionStore) WaitForRunEventsAfter(
	ctx context.Context,
	requestID string,
	afterSequence int64,
) ([]execution.DurableRunEvent, error) {
	waiter := make(chan struct{}, 1)
	s.mu.Lock()
	if _, exists := s.runs[requestID]; !exists {
		s.mu.Unlock()
		return nil, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, requestID)
	}
	if events := cloneRunEventsAfter(s.runEvents[requestID], afterSequence); len(events) > 0 {
		s.mu.Unlock()
		return events, nil
	}
	if s.runEventWaiters[requestID] == nil {
		s.runEventWaiters[requestID] = map[chan struct{}]struct{}{}
	}
	s.runEventWaiters[requestID][waiter] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.runEventWaiters[requestID], waiter)
		if len(s.runEventWaiters[requestID]) == 0 {
			delete(s.runEventWaiters, requestID)
		}
		s.mu.Unlock()
	}()

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-waiter:
			events, err := s.ListRunEventsAfter(ctx, requestID, afterSequence)
			if err != nil || len(events) > 0 {
				return events, err
			}
		}
	}
}

func cloneRunEventsAfter(events []execution.DurableRunEvent, afterSequence int64) []execution.DurableRunEvent {
	cloned := make([]execution.DurableRunEvent, 0, len(events))
	for _, event := range events {
		if event.Sequence > afterSequence {
			cloned = append(cloned, execution.CloneDurableRunEvent(event))
		}
	}
	return cloned
}

func (s *InMemoryRunProjectionStore) notifyRunEventWaitersLocked(requestID string) {
	for waiter := range s.runEventWaiters[requestID] {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
}
