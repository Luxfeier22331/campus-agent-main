package execution

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func updateDurableRunStatusInTx(ctx context.Context, tx pgx.Tx, run DurableRun) error {
	_, err := tx.Exec(
		ctx,
		`update runtime.agent_runs
		set status = $2, terminal_reason = $3, queued_at = $4, admitted_at = $5,
			started_at = $6, streaming_started_at = $7, completed_at = $8, updated_at = $9
		where run_id = $1`,
		run.RunID,
		string(run.Status),
		string(run.TerminalReason),
		nullableTime(run.QueuedAt),
		nullableTime(run.AdmittedAt),
		nullableTime(run.StartedAt),
		nullableTime(run.StreamingStartedAt),
		nullableTime(run.CompletedAt),
		run.UpdatedAt,
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
		`select coalesce(max(sequence), 0) + 1 from runtime.agent_run_events where run_id = $1`,
		run.RunID,
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
	if err != nil && isUniqueViolation(err) {
		return fmt.Errorf("%w: event_id or sequence conflict", ErrInvalidRunEvent)
	}
	return err
}
