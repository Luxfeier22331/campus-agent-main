//go:build retired_pg_lease

package execution

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *PostgresDurableRuntimeStore) UpsertLaneBudget(
	ctx context.Context,
	budget LaneBudget,
) error {
	if err := validateLaneBudget(budget); err != nil {
		return err
	}
	_, err := s.pool.Exec(
		ctx,
		`insert into runtime.lane_budgets (
			lane, max_active_leases, max_queued_runs, queue_timeout_ms, run_timeout_ms,
			lease_timeout_ms, worker_heartbeat_timeout_ms, enabled, updated_at
		) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		on conflict (lane) do update set
			max_active_leases = excluded.max_active_leases,
			max_queued_runs = excluded.max_queued_runs,
			queue_timeout_ms = excluded.queue_timeout_ms,
			run_timeout_ms = excluded.run_timeout_ms,
			lease_timeout_ms = excluded.lease_timeout_ms,
			worker_heartbeat_timeout_ms = excluded.worker_heartbeat_timeout_ms,
			enabled = excluded.enabled,
			updated_at = excluded.updated_at`,
		string(budget.Lane),
		budget.MaxActiveLeases,
		budget.MaxQueuedRuns,
		budget.QueueTimeout.Milliseconds(),
		budget.RunTimeout.Milliseconds(),
		budget.LeaseTimeout.Milliseconds(),
		budget.WorkerHeartbeatTimeout.Milliseconds(),
		budget.Enabled,
		budget.UpdatedAt,
	)
	return err
}

func (s *PostgresDurableRuntimeStore) UpsertWorkerHeartbeat(
	ctx context.Context,
	heartbeat WorkerHeartbeat,
) error {
	if err := validateWorkerHeartbeat(heartbeat); err != nil {
		return err
	}
	lanesJSON, err := jsonDurableLanes(heartbeat.Lanes)
	if err != nil {
		return err
	}
	metadataJSON, err := jsonMapToBytes(heartbeat.Metadata)
	if err != nil {
		return err
	}
	_, err = s.pool.Exec(
		ctx,
		`insert into runtime.worker_heartbeats (
			worker_id, worker_kind, lanes_json, runtime_version, status, heartbeat_at,
			started_at, metadata_json
		) values ($1,$2,$3::jsonb,$4,$5,$6,$7,$8::jsonb)
		on conflict (worker_id) do update set
			worker_kind = excluded.worker_kind,
			lanes_json = excluded.lanes_json,
			runtime_version = excluded.runtime_version,
			status = excluded.status,
			heartbeat_at = excluded.heartbeat_at,
			started_at = excluded.started_at,
			metadata_json = excluded.metadata_json`,
		heartbeat.WorkerID,
		heartbeat.WorkerKind,
		lanesJSON,
		heartbeat.RuntimeVersion,
		string(heartbeat.Status),
		heartbeat.HeartbeatAt,
		heartbeat.StartedAt,
		metadataJSON,
	)
	return err
}

func (s *PostgresDurableRuntimeStore) getLaneBudgetLocked(
	ctx context.Context,
	tx pgxQueryer,
	lane DurableLane,
) (LaneBudget, error) {
	var budget LaneBudget
	var laneText string
	var queueTimeoutMs int64
	var runTimeoutMs int64
	var leaseTimeoutMs int64
	var workerHeartbeatTimeoutMs int64
	err := tx.QueryRow(
		ctx,
		`select lane, max_active_leases, max_queued_runs, queue_timeout_ms, run_timeout_ms,
			lease_timeout_ms, worker_heartbeat_timeout_ms, enabled, updated_at
		from runtime.lane_budgets
		where lane = $1
		for update`,
		string(lane),
	).Scan(
		&laneText,
		&budget.MaxActiveLeases,
		&budget.MaxQueuedRuns,
		&queueTimeoutMs,
		&runTimeoutMs,
		&leaseTimeoutMs,
		&workerHeartbeatTimeoutMs,
		&budget.Enabled,
		&budget.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return LaneBudget{}, fmt.Errorf("%w: %s", ErrLaneBudgetNotFound, lane)
		}
		return LaneBudget{}, err
	}
	budget.Lane = DurableLane(laneText)
	budget.QueueTimeout = time.Duration(queueTimeoutMs) * time.Millisecond
	budget.RunTimeout = time.Duration(runTimeoutMs) * time.Millisecond
	budget.LeaseTimeout = time.Duration(leaseTimeoutMs) * time.Millisecond
	budget.WorkerHeartbeatTimeout = time.Duration(workerHeartbeatTimeoutMs) * time.Millisecond
	return budget, validateLaneBudget(budget)
}

func (s *PostgresDurableRuntimeStore) getWorkerHeartbeatLocked(
	ctx context.Context,
	tx pgxQueryer,
	workerID string,
) (WorkerHeartbeat, error) {
	var heartbeat WorkerHeartbeat
	var lanesRaw []byte
	var metadataRaw []byte
	var status string
	err := tx.QueryRow(
		ctx,
		`select worker_id, worker_kind, lanes_json, runtime_version, status, heartbeat_at,
			started_at, metadata_json
		from runtime.worker_heartbeats
		where worker_id = $1
		for update`,
		workerID,
	).Scan(
		&heartbeat.WorkerID,
		&heartbeat.WorkerKind,
		&lanesRaw,
		&heartbeat.RuntimeVersion,
		&status,
		&heartbeat.HeartbeatAt,
		&heartbeat.StartedAt,
		&metadataRaw,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkerHeartbeat{}, fmt.Errorf("%w: %s", ErrWorkerHeartbeatNotFound, workerID)
		}
		return WorkerHeartbeat{}, err
	}
	if err := json.Unmarshal(lanesRaw, &heartbeat.Lanes); err != nil {
		return WorkerHeartbeat{}, err
	}
	metadata, err := scanJSONMap(metadataRaw)
	if err != nil {
		return WorkerHeartbeat{}, err
	}
	heartbeat.Status = WorkerHeartbeatStatus(status)
	heartbeat.Metadata = metadata
	return heartbeat, validateWorkerHeartbeat(heartbeat)
}
