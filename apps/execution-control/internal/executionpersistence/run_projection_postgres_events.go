package executionpersistence

import (
	"context"
	"errors"
	"fmt"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) AppendRunEvent(
	ctx context.Context,
	event execution.DurableRunEvent,
) (execution.DurableRunEvent, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return execution.DurableRunEvent{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where request_id = $1 for update", event.RequestID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return execution.DurableRunEvent{}, fmt.Errorf("%w: %s", execution.ErrDurableRunNotFound, event.RequestID)
		}
		return execution.DurableRunEvent{}, err
	}
	if event.ConversationID != run.ConversationID {
		return execution.DurableRunEvent{}, fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			execution.ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	var nextSequence int64
	if err := tx.QueryRow(
		ctx,
		`select coalesce(max(sequence), 0) + 1 from execution_control.agent_run_events where request_id = $1`,
		event.RequestID,
	).Scan(&nextSequence); err != nil {
		return execution.DurableRunEvent{}, err
	}
	if event.Sequence == 0 {
		event.Sequence = nextSequence
	}
	if event.Sequence != nextSequence {
		return execution.DurableRunEvent{}, fmt.Errorf(
			"%w: sequence %d, want %d",
			execution.ErrInvalidRunEvent,
			event.Sequence,
			nextSequence,
		)
	}
	if err := execution.ValidateDurableRunEventBase(event); err != nil {
		return execution.DurableRunEvent{}, err
	}
	payloadJSON, err := jsonMapToBytes(event.Payload)
	if err != nil {
		return execution.DurableRunEvent{}, err
	}
	_, err = tx.Exec(
		ctx,
		`insert into execution_control.agent_run_events (
			event_id, request_id, conversation_id, sequence, event_type, visibility,
			payload_schema_version, payload_json, occurred_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
		event.EventID,
		event.RequestID,
		event.ConversationID,
		event.Sequence,
		string(event.EventType),
		string(event.Visibility),
		event.PayloadSchemaVersion,
		payloadJSON,
		event.OccurredAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return execution.DurableRunEvent{}, fmt.Errorf("%w: event_id or sequence conflict", execution.ErrInvalidRunEvent)
		}
		return execution.DurableRunEvent{}, err
	}
	if err := notifyRunEventInTx(ctx, tx, event.RequestID); err != nil {
		return execution.DurableRunEvent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return execution.DurableRunEvent{}, err
	}
	return execution.CloneDurableRunEvent(event), nil
}

func (s *PostgresRunProjectionStore) ListRunEvents(
	ctx context.Context,
	requestID string,
) ([]execution.DurableRunEvent, error) {
	return s.ListRunEventsAfter(ctx, requestID, 0)
}

func (s *PostgresRunProjectionStore) ListRunEventsAfter(
	ctx context.Context,
	requestID string,
	afterSequence int64,
) ([]execution.DurableRunEvent, error) {
	if _, err := s.GetRun(ctx, requestID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(
		ctx,
		`select event_id, request_id, conversation_id, sequence, event_type, visibility,
			payload_schema_version, payload_json, occurred_at
		from execution_control.agent_run_events
		where request_id = $1 and sequence > $2
		order by sequence asc`,
		requestID,
		afterSequence,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []execution.DurableRunEvent{}
	for rows.Next() {
		event, err := scanDurableRunEvent(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func scanDurableRunEvent(row pgx.Row) (execution.DurableRunEvent, error) {
	var event execution.DurableRunEvent
	var eventType string
	var visibility string
	var payloadRaw []byte
	if err := row.Scan(
		&event.EventID,
		&event.RequestID,
		&event.ConversationID,
		&event.Sequence,
		&eventType,
		&visibility,
		&event.PayloadSchemaVersion,
		&payloadRaw,
		&event.OccurredAt,
	); err != nil {
		return execution.DurableRunEvent{}, err
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return execution.DurableRunEvent{}, err
	}
	event.EventType = execution.DurableRunEventType(eventType)
	event.Visibility = execution.DurableRunEventVisibility(visibility)
	event.Payload = payload
	return event, execution.ValidateDurableRunEventBase(event)
}
