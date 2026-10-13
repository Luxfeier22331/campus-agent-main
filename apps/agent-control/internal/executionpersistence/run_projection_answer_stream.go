package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *InMemoryRunProjectionStore) StartRunAnswerStream(
	_ context.Context,
	request execution.RunAnswerStreamStartRequest,
) (execution.DurableRun, error) {
	request.RequestID = strings.TrimSpace(request.RequestID)
	s.mu.Lock()
	defer s.mu.Unlock()
	run, exists := s.runs[request.RequestID]
	if !exists {
		return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
	}
	if err := validateRunAnswerStreamStartRequest(run, request); err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusStreaming {
		return execution.CloneDurableRun(run), nil
	}
	if run.Status != execution.DurableRunStatusRunning {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusStreaming,
		)
	}

	updated := execution.CloneDurableRun(run)
	updated.Status = execution.DurableRunStatusStreaming
	updated.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&updated, execution.DurableRunStatusStreaming, request.Now)
	if err := execution.ValidateDurableRun(updated); err != nil {
		return execution.DurableRun{}, err
	}
	events := append([]execution.DurableRunEvent{}, s.runEvents[run.RequestID]...)
	prepared, err := prepareAnswerStreamEvents(events, request)
	if err != nil {
		return execution.DurableRun{}, err
	}
	s.runs[run.RequestID] = execution.CloneDurableRun(updated)
	s.runEvents[run.RequestID] = append(events, prepared...)
	s.notifyRunEventWaitersLocked(run.RequestID)
	return execution.CloneDurableRun(updated), nil
}

func (s *PostgresRunProjectionStore) StartRunAnswerStream(
	ctx context.Context,
	request execution.RunAnswerStreamStartRequest,
) (execution.DurableRun, error) {
	request.RequestID = strings.TrimSpace(request.RequestID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRun{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", request.RequestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRun{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, request.RequestID)
		}
		return execution.DurableRun{}, err
	}
	if err := validateRunAnswerStreamStartRequest(run, request); err != nil {
		return execution.DurableRun{}, err
	}
	if run.Status == execution.DurableRunStatusStreaming {
		return execution.CloneDurableRun(run), nil
	}
	if run.Status != execution.DurableRunStatusRunning {
		return execution.DurableRun{}, fmt.Errorf(
			"%w: %s -> %s",
			execution.ErrInvalidRunTransition,
			run.Status,
			execution.DurableRunStatusStreaming,
		)
	}
	run.Status = execution.DurableRunStatusStreaming
	run.UpdatedAt = request.Now
	execution.RecordDurableRunStatusTimestamp(&run, execution.DurableRunStatusStreaming, request.Now)
	if err := execution.ValidateDurableRun(run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := updateDurableRunStatusInTx(ctx, tx, run); err != nil {
		return execution.DurableRun{}, err
	}
	if err := insertDurableRunEventInTx(ctx, tx, run, request.AnswerStartedEvent); err != nil {
		return execution.DurableRun{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRun{}, err
	}
	return run, nil
}

func validateRunAnswerStreamStartRequest(run execution.DurableRun, request execution.RunAnswerStreamStartRequest) error {
	if request.RequestID == "" || request.RequestID != run.RequestID || request.Now.IsZero() {
		return fmt.Errorf("%w: answer stream identity is invalid", execution.ErrInvalidRunEvent)
	}
	started := request.AnswerStartedEvent
	if started.RequestID != run.RequestID ||
		started.ConversationID != run.ConversationID ||
		started.EventType != execution.DurableRunEventTypeRunAnswerStarted ||
		started.Sequence != 0 {
		return fmt.Errorf("%w: answer stream events are invalid", execution.ErrInvalidRunEvent)
	}
	started.Sequence = 1
	return execution.ValidateDurableRunEventBase(started)
}

func prepareAnswerStreamEvents(
	existing []execution.DurableRunEvent,
	request execution.RunAnswerStreamStartRequest,
) ([]execution.DurableRunEvent, error) {
	seen := make(map[string]struct{}, len(existing)+1)
	for _, event := range existing {
		seen[event.EventID] = struct{}{}
	}
	prepared := []execution.DurableRunEvent{request.AnswerStartedEvent}
	for index := range prepared {
		if _, duplicate := seen[prepared[index].EventID]; duplicate {
			return nil, fmt.Errorf("%w: event_id %s already exists", execution.ErrInvalidRunEvent, prepared[index].EventID)
		}
		seen[prepared[index].EventID] = struct{}{}
		prepared[index].Sequence = int64(len(existing) + index + 1)
		if err := execution.ValidateDurableRunEventBase(prepared[index]); err != nil {
			return nil, err
		}
		prepared[index] = execution.CloneDurableRunEvent(prepared[index])
	}
	return prepared, nil
}
