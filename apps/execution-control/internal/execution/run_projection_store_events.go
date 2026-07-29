package execution

import (
	"context"
	"fmt"
)

func (s *InMemoryRunProjectionStore) AppendRunEvent(
	_ context.Context,
	event DurableRunEvent,
) (DurableRunEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[event.RunID]
	if !exists {
		return DurableRunEvent{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, event.RunID)
	}
	if event.ConversationID != run.ConversationID {
		return DurableRunEvent{}, fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	events := s.runEvents[event.RunID]
	expectedSequence := int64(len(events) + 1)
	if event.Sequence == 0 {
		event.Sequence = expectedSequence
	}
	if event.Sequence != expectedSequence {
		return DurableRunEvent{}, fmt.Errorf(
			"%w: sequence %d, want %d",
			ErrInvalidRunEvent,
			event.Sequence,
			expectedSequence,
		)
	}
	if err := validateDurableRunEventBase(event); err != nil {
		return DurableRunEvent{}, err
	}
	for _, existing := range events {
		if existing.EventID == event.EventID {
			return DurableRunEvent{}, fmt.Errorf(
				"%w: event_id %s already exists",
				ErrInvalidRunEvent,
				event.EventID,
			)
		}
	}
	eventClone := cloneDurableRunEvent(event)
	s.runEvents[event.RunID] = append(events, eventClone)
	s.notifyRunEventWaitersLocked(event.RunID)
	return cloneDurableRunEvent(eventClone), nil
}

func (s *InMemoryRunProjectionStore) appendRunEventLocked(
	run DurableRun,
	event DurableRunEvent,
) error {
	events := s.runEvents[run.RunID]
	event.Sequence = int64(len(events) + 1)
	if event.ConversationID != run.ConversationID {
		return fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	if err := validateDurableRunEventBase(event); err != nil {
		return err
	}
	for _, existing := range events {
		if existing.EventID == event.EventID {
			return fmt.Errorf("%w: event_id %s already exists", ErrInvalidRunEvent, event.EventID)
		}
	}
	s.runEvents[run.RunID] = append(events, cloneDurableRunEvent(event))
	s.notifyRunEventWaitersLocked(run.RunID)
	return nil
}

func (s *InMemoryRunProjectionStore) ListRunEvents(
	_ context.Context,
	runID string,
) ([]DurableRunEvent, error) {
	return s.ListRunEventsAfter(context.Background(), runID, 0)
}

func (s *InMemoryRunProjectionStore) ListRunEventsAfter(
	_ context.Context,
	runID string,
	afterSequence int64,
) ([]DurableRunEvent, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, exists := s.runs[runID]; !exists {
		return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	events := s.runEvents[runID]
	cloned := make([]DurableRunEvent, 0, len(events))
	for _, event := range events {
		if event.Sequence <= afterSequence {
			continue
		}
		cloned = append(cloned, cloneDurableRunEvent(event))
	}
	return cloned, nil
}

func (s *InMemoryRunProjectionStore) WaitForRunEventsAfter(
	ctx context.Context,
	runID string,
	afterSequence int64,
) ([]DurableRunEvent, error) {
	waiter := make(chan struct{}, 1)
	s.mu.Lock()
	if _, exists := s.runs[runID]; !exists {
		s.mu.Unlock()
		return nil, fmt.Errorf("%w: %s", ErrDurableRunNotFound, runID)
	}
	if events := cloneRunEventsAfter(s.runEvents[runID], afterSequence); len(events) > 0 {
		s.mu.Unlock()
		return events, nil
	}
	if s.runEventWaiters[runID] == nil {
		s.runEventWaiters[runID] = map[chan struct{}]struct{}{}
	}
	s.runEventWaiters[runID][waiter] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.runEventWaiters[runID], waiter)
		if len(s.runEventWaiters[runID]) == 0 {
			delete(s.runEventWaiters, runID)
		}
		s.mu.Unlock()
	}()

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-waiter:
			events, err := s.ListRunEventsAfter(ctx, runID, afterSequence)
			if err != nil || len(events) > 0 {
				return events, err
			}
		}
	}
}

func cloneRunEventsAfter(events []DurableRunEvent, afterSequence int64) []DurableRunEvent {
	cloned := make([]DurableRunEvent, 0, len(events))
	for _, event := range events {
		if event.Sequence > afterSequence {
			cloned = append(cloned, cloneDurableRunEvent(event))
		}
	}
	return cloned
}

func (s *InMemoryRunProjectionStore) notifyRunEventWaitersLocked(runID string) {
	for waiter := range s.runEventWaiters[runID] {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
}
