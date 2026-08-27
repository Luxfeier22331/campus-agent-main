package execution

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func updateDurableRunStatusInTx(ctx context.Context, tx pgx.Tx, run DurableRun) error {
	_, err := tx.Exec(
		ctx,
		`update execution_control.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9,
			retryable = $10
		where request_id = $1`,
		run.RequestID,
		string(run.Status),
		string(run.TerminalReason),
		nullableTime(run.QueuedAt),
		nullableTime(run.AdmittedAt),
		nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt),
		nullableTime(run.CompletedAt),
		run.UpdatedAt,
		run.Retryable,
	)
	return err
}

func insertDurableRunEventInTx(
	ctx context.Context,
	tx pgx.Tx,
	run DurableRun,
	event DurableRunEvent,
) error {
	var nextSequence int64
	if err := tx.QueryRow(
		ctx,
		`select coalesce(max(sequence), 0) + 1 from execution_control.agent_run_events where request_id = $1`,
		run.RequestID,
	).Scan(&nextSequence); err != nil {
		return err
	}
	event.Sequence = nextSequence
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
	payloadJSON, err := jsonMapToBytes(event.Payload)
	if err != nil {
		return err
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
	if err != nil && isUniqueViolation(err) {
		return fmt.Errorf("%w: event_id or sequence conflict", ErrInvalidRunEvent)
	}
	if err != nil {
		return err
	}
	return notifyRunEventInTx(ctx, tx, run.RequestID)
}

const runEventNotificationChannel = "campus_agent_run_events"

func notifyRunEventInTx(ctx context.Context, tx pgx.Tx, requestID string) error {
	_, err := tx.Exec(ctx, `select pg_notify($1, $2)`, runEventNotificationChannel, requestID)
	return err
}

func durableRunEventByIDInTx(
	ctx context.Context,
	tx pgx.Tx,
	eventID string,
) (DurableRunEvent, error) {
	return scanDurableRunEvent(tx.QueryRow(
		ctx,
		`select event_id, request_id, conversation_id, sequence, event_type, visibility,
			payload_schema_version, payload_json, occurred_at
		from execution_control.agent_run_events
		where event_id = $1`,
		eventID,
	))
}

func runCancellationRequestedInTx(ctx context.Context, tx pgx.Tx, requestID string) (bool, error) {
	var requested bool
	err := tx.QueryRow(
		ctx,
		`select exists(
			select 1 from execution_control.agent_run_cancellations
			where request_id = $1 and state <> 'confirmed'
		)`,
		requestID,
	).Scan(&requested)
	return requested, err
}
