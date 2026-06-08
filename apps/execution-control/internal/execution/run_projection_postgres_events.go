package execution

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) AppendRunEvent(
	ctx context.Context,
	event DurableRunEvent,
) (DurableRunEvent, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DurableRunEvent{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	run, err := scanDurableRun(
		tx.QueryRow(ctx, durableRunSelectSQL+" where run_id = $1 for update", event.RunID),
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return DurableRunEvent{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, event.RunID)
		}
		return DurableRunEvent{}, err
	}
	if event.ConversationID != run.ConversationID {
		return DurableRunEvent{}, fmt.Errorf(
			"%w: event conversation_id %s does not match run conversation_id %s",
			ErrInvalidRunEvent,
			event.ConversationID,
			run.ConversationID,
		)
	}
	var nextSequence int64
	if err := tx.QueryRow(
		ctx,
		`select coalesce(max(sequence), 0) + 1 from runtime.agent_run_events where run_id = $1`,
		event.RunID,
	).Scan(&nextSequence); err != nil {
		return DurableRunEvent{}, err
	}
	if event.Sequence == 0 {
		event.Sequence = nextSequence
	}
	if event.Sequence != nextSequence {
		return DurableRunEvent{}, fmt.Errorf(
			"%w: sequence %d, want %d",
			ErrInvalidRunEvent,
			event.Sequence,
			nextSequence,
		)
	}
	if err := validateDurableRunEventBase(event); err != nil {
		return DurableRunEvent{}, err
	}
	payloadJSON, err := jsonMapToBytes(event.Payload)
	if err != nil {
		return DurableRunEvent{}, err
	}
	_, err = tx.Exec(
		ctx,
		`insert into runtime.agent_run_events (
			event_id, run_id, conversation_id, sequence, event_type, visibility,
			payload_schema_version, payload_json, occurred_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
		event.EventID,
		event.RunID,
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
			return DurableRunEvent{}, fmt.Errorf("%w: event_id or sequence conflict", ErrInvalidRunEvent)
		}
		return DurableRunEvent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DurableRunEvent{}, err
	}
	return cloneDurableRunEvent(event), nil
}

func (s *PostgresRunProjectionStore) ListRunEvents(
	ctx context.Context,
	runID string,
) ([]DurableRunEvent, error) {
	return s.ListRunEventsAfter(ctx, runID, 0)
}

func (s *PostgresRunProjectionStore) ListRunEventsAfter(
	ctx context.Context,
	runID string,
	afterSequence int64,
) ([]DurableRunEvent, error) {
	if _, err := s.GetRun(ctx, runID); err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(
		ctx,
		`select event_id, run_id, conversation_id, sequence, event_type, visibility,
			payload_schema_version, payload_json, occurred_at
		from runtime.agent_run_events
		where run_id = $1 and sequence > $2
		order by sequence asc`,
		runID,
		afterSequence,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []DurableRunEvent{}
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

func scanDurableRunEvent(row pgx.Row) (DurableRunEvent, error) {
	var event DurableRunEvent
	var eventType string
	var visibility string
	var payloadRaw []byte
	if err := row.Scan(
		&event.EventID,
		&event.RunID,
		&event.ConversationID,
		&event.Sequence,
		&eventType,
		&visibility,
		&event.PayloadSchemaVersion,
		&payloadRaw,
		&event.OccurredAt,
	); err != nil {
		return DurableRunEvent{}, err
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return DurableRunEvent{}, err
	}
	event.EventType = DurableRunEventType(eventType)
	event.Visibility = DurableRunEventVisibility(visibility)
	event.Payload = payload
	return event, validateDurableRunEventBase(event)
}
