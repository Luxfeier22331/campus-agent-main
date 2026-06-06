package execution

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresDurableRuntimeStore) UpsertRunStep(
	ctx context.Context,
	step RunStepProjection,
) (RunStepProjection, error) {
	if err := validateRunStepProjection(step); err != nil {
		return RunStepProjection{}, err
	}
	payload, err := jsonMapToBytes(step.SanitizedPayload)
	if err != nil {
		return RunStepProjection{}, err
	}
	_, err = s.pool.Exec(
		ctx,
		`insert into runtime.agent_run_steps (
			step_id, run_id, conversation_id, step_kind, capability, parent_step_id,
			status, task_queue, worker_id, started_at, completed_at, updated_at,
			payload_schema_version, sanitized_payload_json
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		on conflict (run_id, step_id) do update set
			conversation_id = excluded.conversation_id,
			step_kind = excluded.step_kind,
			capability = excluded.capability,
			parent_step_id = excluded.parent_step_id,
			status = excluded.status,
			task_queue = excluded.task_queue,
			worker_id = excluded.worker_id,
			started_at = coalesce(excluded.started_at, runtime.agent_run_steps.started_at),
			completed_at = excluded.completed_at,
			updated_at = excluded.updated_at,
			payload_schema_version = excluded.payload_schema_version,
			sanitized_payload_json = excluded.sanitized_payload_json`,
		step.StepID,
		step.RunID,
		step.ConversationID,
		step.StepKind,
		step.Capability,
		step.ParentStepID,
		step.Status,
		step.TaskQueue,
		step.WorkerID,
		nullableTime(step.StartedAt),
		nullableTime(step.CompletedAt),
		step.UpdatedAt,
		step.PayloadSchemaVersion,
		payload,
	)
	if err != nil {
		return RunStepProjection{}, err
	}
	return step, nil
}

func (s *PostgresDurableRuntimeStore) UpsertStepAttempt(
	ctx context.Context,
	attempt StepAttemptProjection,
) (StepAttemptProjection, error) {
	if err := validateStepAttemptProjection(attempt); err != nil {
		return StepAttemptProjection{}, err
	}
	payload, err := jsonMapToBytes(attempt.SanitizedPayload)
	if err != nil {
		return StepAttemptProjection{}, err
	}
	_, err = s.pool.Exec(
		ctx,
		`insert into runtime.agent_step_attempts (
			attempt_id, step_id, run_id, attempt, status, task_queue, worker_id,
			started_at, completed_at, updated_at, payload_schema_version, sanitized_payload_json
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		on conflict (attempt_id) do update set
			step_id = excluded.step_id,
			run_id = excluded.run_id,
			attempt = excluded.attempt,
			status = excluded.status,
			task_queue = excluded.task_queue,
			worker_id = excluded.worker_id,
			started_at = coalesce(excluded.started_at, runtime.agent_step_attempts.started_at),
			completed_at = excluded.completed_at,
			updated_at = excluded.updated_at,
			payload_schema_version = excluded.payload_schema_version,
			sanitized_payload_json = excluded.sanitized_payload_json`,
		attempt.AttemptID,
		attempt.StepID,
		attempt.RunID,
		attempt.Attempt,
		attempt.Status,
		attempt.TaskQueue,
		attempt.WorkerID,
		nullableTime(attempt.StartedAt),
		nullableTime(attempt.CompletedAt),
		attempt.UpdatedAt,
		attempt.PayloadSchemaVersion,
		payload,
	)
	if err != nil {
		return StepAttemptProjection{}, err
	}
	return attempt, nil
}

func (s *PostgresDurableRuntimeStore) UpsertStepResult(
	ctx context.Context,
	result StepResultProjection,
) (StepResultProjection, error) {
	if err := validateStepResultProjection(result); err != nil {
		return StepResultProjection{}, err
	}
	payload, err := jsonMapToBytes(result.SanitizedPayload)
	if err != nil {
		return StepResultProjection{}, err
	}
	_, err = s.pool.Exec(
		ctx,
		`insert into runtime.agent_step_results (
			result_id, step_id, run_id, attempt_id, status, result_kind, projection_ref,
			created_at, payload_schema_version, sanitized_payload_json
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		on conflict (result_id) do update set
			step_id = excluded.step_id,
			run_id = excluded.run_id,
			attempt_id = excluded.attempt_id,
			status = excluded.status,
			result_kind = excluded.result_kind,
			projection_ref = excluded.projection_ref,
			created_at = excluded.created_at,
			payload_schema_version = excluded.payload_schema_version,
			sanitized_payload_json = excluded.sanitized_payload_json`,
		result.ResultID,
		result.StepID,
		result.RunID,
		result.AttemptID,
		result.Status,
		result.ResultKind,
		result.ProjectionRef,
		result.CreatedAt,
		result.PayloadSchemaVersion,
		payload,
	)
	if err != nil {
		return StepResultProjection{}, err
	}
	return result, nil
}

func (s *PostgresDurableRuntimeStore) ListRunSteps(
	ctx context.Context,
	runID string,
) ([]RunStepProjection, error) {
	rows, err := s.pool.Query(
		ctx,
		`select step_id, run_id, conversation_id, step_kind, capability, parent_step_id,
			status, task_queue, worker_id, started_at, completed_at, updated_at,
			payload_schema_version, sanitized_payload_json
		from runtime.agent_run_steps
		where run_id = $1
		order by started_at nulls last, step_id`,
		runID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	steps := []RunStepProjection{}
	for rows.Next() {
		step, err := scanRunStepProjection(rows)
		if err != nil {
			return nil, err
		}
		steps = append(steps, step)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(steps) == 0 {
		if _, err := s.GetRun(ctx, runID); err != nil {
			return nil, err
		}
	}
	return steps, nil
}

func (s *PostgresDurableRuntimeStore) ListStepAttempts(
	ctx context.Context,
	runID string,
) ([]StepAttemptProjection, error) {
	rows, err := s.pool.Query(
		ctx,
		`select attempt_id, step_id, run_id, attempt, status, task_queue, worker_id,
			started_at, completed_at, updated_at, payload_schema_version, sanitized_payload_json
		from runtime.agent_step_attempts
		where run_id = $1
		order by started_at nulls last, attempt_id`,
		runID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attempts := []StepAttemptProjection{}
	for rows.Next() {
		attempt, err := scanStepAttemptProjection(rows)
		if err != nil {
			return nil, err
		}
		attempts = append(attempts, attempt)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(attempts) == 0 {
		if _, err := s.GetRun(ctx, runID); err != nil {
			return nil, err
		}
	}
	return attempts, nil
}

func (s *PostgresDurableRuntimeStore) ListStepResults(
	ctx context.Context,
	runID string,
) ([]StepResultProjection, error) {
	rows, err := s.pool.Query(
		ctx,
		`select result_id, step_id, run_id, attempt_id, status, result_kind, projection_ref,
			created_at, payload_schema_version, sanitized_payload_json
		from runtime.agent_step_results
		where run_id = $1
		order by created_at, result_id`,
		runID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []StepResultProjection{}
	for rows.Next() {
		result, err := scanStepResultProjection(rows)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(results) == 0 {
		if _, err := s.GetRun(ctx, runID); err != nil {
			return nil, err
		}
	}
	return results, nil
}

func scanRunStepProjection(row pgx.Row) (RunStepProjection, error) {
	var step RunStepProjection
	var payloadRaw []byte
	var startedAt *time.Time
	var completedAt *time.Time
	if err := row.Scan(
		&step.StepID,
		&step.RunID,
		&step.ConversationID,
		&step.StepKind,
		&step.Capability,
		&step.ParentStepID,
		&step.Status,
		&step.TaskQueue,
		&step.WorkerID,
		&startedAt,
		&completedAt,
		&step.UpdatedAt,
		&step.PayloadSchemaVersion,
		&payloadRaw,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return RunStepProjection{}, fmt.Errorf("%w", ErrInvalidRunStep)
		}
		return RunStepProjection{}, err
	}
	if startedAt != nil {
		step.StartedAt = *startedAt
	}
	if completedAt != nil {
		step.CompletedAt = *completedAt
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return RunStepProjection{}, err
	}
	step.SanitizedPayload = payload
	return step, nil
}

func scanStepAttemptProjection(row pgx.Row) (StepAttemptProjection, error) {
	var attempt StepAttemptProjection
	var payloadRaw []byte
	var startedAt *time.Time
	var completedAt *time.Time
	if err := row.Scan(
		&attempt.AttemptID,
		&attempt.StepID,
		&attempt.RunID,
		&attempt.Attempt,
		&attempt.Status,
		&attempt.TaskQueue,
		&attempt.WorkerID,
		&startedAt,
		&completedAt,
		&attempt.UpdatedAt,
		&attempt.PayloadSchemaVersion,
		&payloadRaw,
	); err != nil {
		return StepAttemptProjection{}, err
	}
	if startedAt != nil {
		attempt.StartedAt = *startedAt
	}
	if completedAt != nil {
		attempt.CompletedAt = *completedAt
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return StepAttemptProjection{}, err
	}
	attempt.SanitizedPayload = payload
	return attempt, nil
}

func scanStepResultProjection(row pgx.Row) (StepResultProjection, error) {
	var result StepResultProjection
	var payloadRaw []byte
	if err := row.Scan(
		&result.ResultID,
		&result.StepID,
		&result.RunID,
		&result.AttemptID,
		&result.Status,
		&result.ResultKind,
		&result.ProjectionRef,
		&result.CreatedAt,
		&result.PayloadSchemaVersion,
		&payloadRaw,
	); err != nil {
		return StepResultProjection{}, err
	}
	payload, err := scanJSONMap(payloadRaw)
	if err != nil {
		return StepResultProjection{}, err
	}
	result.SanitizedPayload = payload
	return result, nil
}
