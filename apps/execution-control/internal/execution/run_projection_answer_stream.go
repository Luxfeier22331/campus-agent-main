package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *InMemoryRunProjectionStore) StartRunAnswerStream(
	_ context.Context,
	request RunAnswerStreamStartRequest,
) (DurableRun, error) {
	request.RunID = strings.TrimSpace(request.RunID)
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RunID]
	if !exists {
		return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
	}
	if run.Status != DurableRunStatusRunning {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusStreaming,
		)
	}
	if err := validateRunAnswerStreamStartRequest(run, request); err != nil {
		return DurableRun{}, err
	}

	updated := cloneDurableRun(run)
	updated.Status = DurableRunStatusStreaming
	updated.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&updated, DurableRunStatusStreaming, request.Now)
	if err := validateDurableRun(updated); err != nil {
		return DurableRun{}, err
	}
	events := append([]DurableRunEvent{}, s.runEvents[run.RunID]...)
	prepared, err := prepareAnswerStreamEvents(events, request)
	if err != nil {
		return DurableRun{}, err
	}
	s.runs[run.RunID] = cloneDurableRun(updated)
	s.runEvents[run.RunID] = append(events, prepared...)
	s.notifyRunEventWaitersLocked(run.RunID)
	return cloneDurableRun(updated), nil
}

func (s *PostgresRunProjectionStore) StartRunAnswerStream(
	ctx context.Context,
	request RunAnswerStreamStartRequest,
) (DurableRun, error) {
	request.RunID = strings.TrimSpace(request.RunID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRun{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", request.RunID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRun{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, request.RunID)
		}
		return DurableRun{}, err
	}
	if run.Status != DurableRunStatusRunning {
		return DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			ErrInvalidRunTransition,
			run.Status,
			DurableRunStatusStreaming,
		)
	}
	if err := validateRunAnswerStreamStartRequest(run, request); err != nil {
		return DurableRun{}, err
	}
	run.Status = DurableRunStatusStreaming
	run.UpdatedAt = request.Now
	recordDurableRunStatusTimestamp(&run, DurableRunStatusStreaming, request.Now)
	if err := validateDurableRun(run); err != nil {
		return DurableRun{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.AnswerStartedEvent); err != nil {
		return DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.FirstDeltaEvent); err != nil {
		return DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRun{}, err
	}
	return run, nil
}

func validateRunAnswerStreamStartRequest(run DurableRun, request RunAnswerStreamStartRequest) error {
	if request.RunID == "" || request.RunID != run.RunID || request.Now.IsZero() {
		return fmt.Errorf("%w: answer stream identity is invalid", ErrInvalidRunEvent)
	}
	started := request.AnswerStartedEvent
	delta := request.FirstDeltaEvent
	if started.RunID != run.RunID || delta.RunID != run.RunID ||
		started.ConversationID != run.ConversationID || delta.ConversationID != run.ConversationID ||
		started.EventType != DurableRunEventTypeRunAnswerStarted ||
		delta.EventType != DurableRunEventTypeRunAnswerDelta ||
		started.Sequence != 0 || delta.Sequence != 0 {
		return fmt.Errorf("%w: answer stream events are invalid", ErrInvalidRunEvent)
	}
	started.Sequence = 1
	delta.Sequence = 2
	if err := validateDurableRunEventBase(started); err != nil {
		return err
	}
	return validateDurableRunEventBase(delta)
}

func prepareAnswerStreamEvents(
	existing []DurableRunEvent,
	request RunAnswerStreamStartRequest,
) ([]DurableRunEvent, error) {
	seen := make(map[string]struct{}, len(existing)+2)
	for _, event := range existing {
		seen[event.EventID] = struct{}{}
	}
	prepared := []DurableRunEvent{request.AnswerStartedEvent, request.FirstDeltaEvent}
	for index := range prepared {
		if _, duplicate := seen[prepared[index].EventID]; duplicate {
			return nil, fmt.Errorf("%w: event_id %s already exists", ErrInvalidRunEvent, prepared[index].EventID)
		}
		seen[prepared[index].EventID] = struct{}{}
		prepared[index].Sequence = int64(len(existing) + index + 1)
		if err := validateDurableRunEventBase(prepared[index]); err != nil {
			return nil, err
		}
		prepared[index] = cloneDurableRunEvent(prepared[index])
	}
	return prepared, nil
}
