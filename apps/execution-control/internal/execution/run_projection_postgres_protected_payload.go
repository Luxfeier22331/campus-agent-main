package execution

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresRunProjectionStore) PutProtectedPayload(
	ctx context.Context,
	payload ProtectedPayload,
) (ProtectedPayload, error) {
	if err := validateProtectedPayload(payload); err != nil {
		return ProtectedPayload{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProtectedPayload{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var status string
	if err := tx.QueryRow(ctx,
		`select status from runtime.agent_runs where run_id = $1 for update`,
		payload.RunID,
	).Scan(&status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ProtectedPayload{}, fmt.Errorf("%w: %s", ErrDurableRunNotFound, payload.RunID)
		}
		return ProtectedPayload{}, err
	}
	if !durableRunStatusIsActive(DurableRunStatus(status)) {
		return ProtectedPayload{}, fmt.Errorf("%w: %s", ErrProtectedPayloadRunClosed, payload.RunID)
	}
	tag, err := tx.Exec(ctx, `insert into runtime.agent_protected_payloads (
		run_id, payload_ref, kind, ciphertext, payload_sha256, created_at
	) values ($1,$2,$3,$4,$5,$6)
	on conflict (run_id, payload_ref, kind) do nothing`,
		payload.RunID, payload.PayloadRef, payload.Kind, payload.Ciphertext,
		payload.PayloadSHA256, payload.CreatedAt,
	)
	if err != nil {
		return ProtectedPayload{}, err
	}
	if tag.RowsAffected() == 1 {
		if err := tx.Commit(ctx); err != nil {
			return ProtectedPayload{}, err
		}
		return cloneProtectedPayload(payload), nil
	}
	existing, err := scanProtectedPayload(tx.QueryRow(ctx, `select run_id, payload_ref, kind, ciphertext,
		payload_sha256, created_at from runtime.agent_protected_payloads
		where run_id = $1 and payload_ref = $2 and kind = $3 for update`,
		payload.RunID, payload.PayloadRef, payload.Kind,
	))
	if err != nil {
		return ProtectedPayload{}, err
	}
	if !strings.EqualFold(existing.PayloadSHA256, payload.PayloadSHA256) {
		return ProtectedPayload{}, fmt.Errorf("%w: %s", ErrProtectedPayloadConflict, payload.PayloadRef)
	}
	if err := tx.Commit(ctx); err != nil {
		return ProtectedPayload{}, err
	}
	return existing, nil
}

func (s *PostgresRunProjectionStore) GetProtectedPayload(
	ctx context.Context,
	runID string,
	payloadRef string,
	kind string,
) (ProtectedPayload, error) {
	payload, err := scanProtectedPayload(s.pool.QueryRow(ctx, `select run_id, payload_ref, kind, ciphertext,
		payload_sha256, created_at
		from runtime.agent_protected_payloads
		where run_id = $1 and payload_ref = $2 and kind = $3`, runID, payloadRef, kind))
	if err != nil {
		if err == pgx.ErrNoRows {
			return ProtectedPayload{}, fmt.Errorf("%w: %s", ErrProtectedPayloadNotFound, payloadRef)
		}
		return ProtectedPayload{}, err
	}
	if err := validateProtectedPayload(payload); err != nil {
		return ProtectedPayload{}, err
	}
	return payload, nil
}

func scanProtectedPayload(row pgx.Row) (ProtectedPayload, error) {
	var payload ProtectedPayload
	if err := row.Scan(
		&payload.RunID,
		&payload.PayloadRef,
		&payload.Kind,
		&payload.Ciphertext,
		&payload.PayloadSHA256,
		&payload.CreatedAt,
	); err != nil {
		return ProtectedPayload{}, err
	}
	return payload, nil
}

func (s *PostgresRunProjectionStore) DeleteProtectedPayloads(ctx context.Context, runID string) error {
	_, err := s.pool.Exec(ctx, `delete from runtime.agent_protected_payloads where run_id = $1`, runID)
	return err
}
