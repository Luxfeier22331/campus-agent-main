package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errInvalidOptions = errors.New("invalid durable runtime proof options")

type proofOptions struct {
	DatabaseURL  string
	EvidencePath string
	Prefix       string
	Now          time.Time
}

type proofReport struct {
	GeneratedAt  string                  `json:"generated_at"`
	MultiWorker  multiWorkerProofReport  `json:"multi_worker"`
	Passed       bool                    `json:"passed"`
	Prefix       string                  `json:"prefix"`
	Recovery     recoveryProofReport     `json:"recovery"`
	Store        string                  `json:"store"`
	Verification verificationProofReport `json:"verification"`
}

type multiWorkerProofReport struct {
	EmptyQueueCount      int      `json:"empty_queue_count"`
	Events               []string `json:"events"`
	LeasedRunID          string   `json:"leased_run_id"`
	SuccessfulLeaseCount int      `json:"successful_lease_count"`
	WorkerIDs            []string `json:"worker_ids"`
}

type recoveryProofReport struct {
	Events               []string `json:"events"`
	FirstLeaseAttempt    int      `json:"first_lease_attempt"`
	FirstRecoveryStatus  string   `json:"first_recovery_status"`
	SecondLeaseAttempt   int      `json:"second_lease_attempt"`
	SecondRecoveryStatus string   `json:"second_recovery_status"`
	TerminalReason       string   `json:"terminal_reason"`
}

type verificationProofReport struct {
	CleanupVerified bool `json:"cleanup_verified"`
	SchemaReady     bool `json:"schema_ready"`
}

func main() {
	options, err := parseOptions(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	report, err := runProof(context.Background(), options)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoded, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(string(encoded))
}

func parseOptions(args []string) (proofOptions, error) {
	flags := flag.NewFlagSet("durable-runtime-proof", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var options proofOptions
	flags.StringVar(&options.DatabaseURL, "database-url", "", "explicit Postgres durable runtime database URL")
	flags.StringVar(&options.EvidencePath, "evidence-path", "", "path to write durable runtime proof evidence JSON")
	flags.StringVar(&options.Prefix, "prefix", "", "proof artifact prefix; must start with proof-")
	if err := flags.Parse(args); err != nil {
		return proofOptions{}, err
	}
	options.DatabaseURL = strings.TrimSpace(options.DatabaseURL)
	options.EvidencePath = strings.TrimSpace(options.EvidencePath)
	options.Prefix = strings.TrimSpace(options.Prefix)
	if options.DatabaseURL == "" {
		return proofOptions{}, fmt.Errorf("%w: --database-url is required", errInvalidOptions)
	}
	if options.EvidencePath == "" {
		return proofOptions{}, fmt.Errorf("%w: --evidence-path is required", errInvalidOptions)
	}
	if options.Prefix == "" {
		options.Prefix = "proof-" + time.Now().UTC().Format("20060102T150405.000000000")
	}
	if err := validateProofPrefix(options.Prefix); err != nil {
		return proofOptions{}, err
	}
	return options, nil
}

func validateProofPrefix(prefix string) error {
	trimmed := strings.TrimSpace(prefix)
	if trimmed != prefix || !strings.HasPrefix(prefix, "proof-") || len(prefix) <= len("proof-") {
		return fmt.Errorf("%w: prefix must start with proof- and include a unique suffix", errInvalidOptions)
	}
	if strings.ContainsAny(prefix, "*/\\ \t\r\n") {
		return fmt.Errorf("%w: prefix must be an exact key prefix without glob, slash or whitespace", errInvalidOptions)
	}
	return nil
}

func runProof(ctx context.Context, options proofOptions) (proofReport, error) {
	if err := validateProofPrefix(options.Prefix); err != nil {
		return proofReport{}, err
	}
	now := options.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	store, err := execution.NewPostgresDurableRuntimeStore(ctx, execution.PostgresDurableRuntimeStoreOptions{
		DatabaseURL: options.DatabaseURL,
		AutoMigrate: true,
	})
	if err != nil {
		return proofReport{}, err
	}
	defer store.Close()
	if err := store.HealthCheck(ctx); err != nil {
		return proofReport{}, err
	}

	if err := cleanupProofArtifacts(ctx, options.DatabaseURL, options.Prefix); err != nil {
		return proofReport{}, err
	}
	defer func() {
		_ = cleanupProofArtifacts(context.Background(), options.DatabaseURL, options.Prefix)
	}()
	originalRAGBudget, hadOriginalRAGBudget, err := readLaneBudget(ctx, options.DatabaseURL, execution.DurableLaneRAG)
	if err != nil {
		return proofReport{}, err
	}
	defer func() {
		if hadOriginalRAGBudget {
			_ = restoreLaneBudget(context.Background(), options.DatabaseURL, originalRAGBudget)
		}
	}()

	activeRAGLeases, err := readActiveLeaseCount(ctx, options.DatabaseURL, execution.DurableLaneRAG)
	if err != nil {
		return proofReport{}, err
	}

	multiWorker, err := proveMultiWorkerLease(ctx, store, options.Prefix, now, activeRAGLeases)
	if err != nil {
		return proofReport{}, err
	}
	recovery, err := proveExpiredLeaseRecovery(ctx, store, options.Prefix, now.Add(time.Minute), activeRAGLeases)
	if err != nil {
		return proofReport{}, err
	}

	if err := cleanupProofArtifacts(ctx, options.DatabaseURL, options.Prefix); err != nil {
		return proofReport{}, err
	}
	if hadOriginalRAGBudget {
		if err := restoreLaneBudget(ctx, options.DatabaseURL, originalRAGBudget); err != nil {
			return proofReport{}, err
		}
	}
	cleanupVerified, err := proofArtifactsCleaned(ctx, store, options.Prefix)
	if err != nil {
		return proofReport{}, err
	}
	if !cleanupVerified {
		return proofReport{}, fmt.Errorf("durable proof cleanup did not remove prefix %s", options.Prefix)
	}

	report := proofReport{
		GeneratedAt: now.Format(time.RFC3339Nano),
		MultiWorker: multiWorker,
		Passed:      true,
		Prefix:      options.Prefix,
		Recovery:    recovery,
		Store:       "postgres",
		Verification: verificationProofReport{
			CleanupVerified: true,
			SchemaReady:     true,
		},
	}
	if err := writeProofReport(options.EvidencePath, report); err != nil {
		return proofReport{}, err
	}
	return report, nil
}

func proveMultiWorkerLease(
	ctx context.Context,
	store execution.DurableRuntimeStore,
	prefix string,
	now time.Time,
	activeLeaseOffset int,
) (multiWorkerProofReport, error) {
	workerIDs := []string{prefix + "-worker-1", prefix + "-worker-2"}
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        activeLeaseOffset + 2,
		MaxQueuedRuns:          8,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		return multiWorkerProofReport{}, err
	}
	for _, workerID := range workerIDs {
		if err := store.UpsertWorkerHeartbeat(ctx, execution.WorkerHeartbeat{
			WorkerID:       workerID,
			WorkerKind:     "durable-runtime-proof",
			Lanes:          []execution.DurableLane{execution.DurableLaneRAG},
			RuntimeVersion: "proof",
			Status:         execution.WorkerHeartbeatStatusReady,
			HeartbeatAt:    now,
			StartedAt:      now.Add(-time.Second),
		}); err != nil {
			return multiWorkerProofReport{}, err
		}
	}
	runID := prefix + "-multi-run"
	if _, err := store.CreateRun(ctx, execution.DurableRun{
		RunID:          runID,
		ConversationID: prefix + "-multi-conversation",
		TurnID:         prefix + "-multi-turn",
		RequestID:      prefix + "-multi-request",
		TraceID:        prefix + "-multi-trace",
		OwnerUserID:    prefix + "-user",
		Surface:        "durable-runtime-proof",
		Lane:           execution.DurableLaneRAG,
		CreatedAt:      now.Add(time.Second),
	}); err != nil {
		return multiWorkerProofReport{}, err
	}
	if _, err := store.TransitionRun(ctx, runID, execution.DurableRunStatusQueued, "", now.Add(2*time.Second)); err != nil {
		return multiWorkerProofReport{}, err
	}

	type acquireResult struct {
		Lease execution.ExecutionLease
		Err   error
	}
	start := make(chan struct{})
	results := make(chan acquireResult, len(workerIDs))
	var wg sync.WaitGroup
	for index, workerID := range workerIDs {
		wg.Add(1)
		go func(index int, workerID string) {
			defer wg.Done()
			<-start
			lease, err := store.AcquireNextExecutionLease(ctx, execution.NextExecutionLeaseRequest{
				LeaseID:   prefix + "-multi-lease-" + workerID,
				StepID:    "handoff:rag-agent:rag_request",
				Lane:      execution.DurableLaneRAG,
				WorkerID:  workerID,
				Now:       now.Add(time.Duration(index+3) * time.Second),
				ExpiresAt: now.Add(time.Duration(index+33) * time.Second),
			})
			results <- acquireResult{Lease: lease, Err: err}
		}(index, workerID)
	}
	close(start)
	wg.Wait()
	close(results)

	successes := []execution.ExecutionLease{}
	emptyQueueCount := 0
	for result := range results {
		if result.Err == nil {
			successes = append(successes, result.Lease)
			continue
		}
		if errors.Is(result.Err, execution.ErrNoQueuedDurableRun) {
			emptyQueueCount++
			continue
		}
		return multiWorkerProofReport{}, result.Err
	}
	if len(successes) != 1 || emptyQueueCount != 1 {
		return multiWorkerProofReport{}, fmt.Errorf(
			"multi-worker proof expected one lease and one empty queue, got leases=%d empty=%d",
			len(successes),
			emptyQueueCount,
		)
	}
	if successes[0].RunID != runID {
		return multiWorkerProofReport{}, fmt.Errorf("multi-worker proof leased run %s, want %s", successes[0].RunID, runID)
	}
	events, err := store.ListRunEvents(ctx, runID)
	if err != nil {
		return multiWorkerProofReport{}, err
	}
	eventTypes := durableEventTypes(events)
	if err := requireEventTypes(eventTypes, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
	}); err != nil {
		return multiWorkerProofReport{}, err
	}
	if _, err := store.ReleaseExecutionLease(
		ctx,
		successes[0].LeaseID,
		successes[0].WorkerID,
		"proof_completed",
		now.Add(35*time.Second),
	); err != nil {
		return multiWorkerProofReport{}, err
	}
	return multiWorkerProofReport{
		EmptyQueueCount:      emptyQueueCount,
		Events:               eventTypes,
		LeasedRunID:          successes[0].RunID,
		SuccessfulLeaseCount: len(successes),
		WorkerIDs:            workerIDs,
	}, nil
}

func proveExpiredLeaseRecovery(
	ctx context.Context,
	store execution.DurableRuntimeStore,
	prefix string,
	now time.Time,
	activeLeaseOffset int,
) (recoveryProofReport, error) {
	workerID := prefix + "-recovery-worker"
	if err := store.UpsertLaneBudget(ctx, execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        activeLeaseOffset + 1,
		MaxQueuedRuns:          8,
		QueueTimeout:           30 * time.Second,
		RunTimeout:             2 * time.Minute,
		LeaseTimeout:           30 * time.Second,
		WorkerHeartbeatTimeout: 15 * time.Second,
		Enabled:                true,
		UpdatedAt:              now,
	}); err != nil {
		return recoveryProofReport{}, err
	}
	if err := store.UpsertWorkerHeartbeat(ctx, execution.WorkerHeartbeat{
		WorkerID:       workerID,
		WorkerKind:     "durable-runtime-proof",
		Lanes:          []execution.DurableLane{execution.DurableLaneRAG},
		RuntimeVersion: "proof",
		Status:         execution.WorkerHeartbeatStatusReady,
		HeartbeatAt:    now,
		StartedAt:      now.Add(-time.Second),
	}); err != nil {
		return recoveryProofReport{}, err
	}
	runID := prefix + "-recovery-run"
	if _, err := store.CreateRun(ctx, execution.DurableRun{
		RunID:          runID,
		ConversationID: prefix + "-recovery-conversation",
		TurnID:         prefix + "-recovery-turn",
		RequestID:      prefix + "-recovery-request",
		TraceID:        prefix + "-recovery-trace",
		OwnerUserID:    prefix + "-user",
		Surface:        "durable-runtime-proof",
		Lane:           execution.DurableLaneRAG,
		CreatedAt:      now.Add(time.Second),
	}); err != nil {
		return recoveryProofReport{}, err
	}
	if _, err := store.TransitionRun(ctx, runID, execution.DurableRunStatusQueued, "", now.Add(2*time.Second)); err != nil {
		return recoveryProofReport{}, err
	}

	firstLease, err := store.AcquireNextExecutionLease(ctx, execution.NextExecutionLeaseRequest{
		LeaseID:   prefix + "-recovery-lease-1",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      execution.DurableLaneRAG,
		WorkerID:  workerID,
		Now:       now.Add(3 * time.Second),
		ExpiresAt: now.Add(5 * time.Second),
	})
	if err != nil {
		return recoveryProofReport{}, err
	}
	firstRecovered, err := store.RecoverExpiredExecutionLeases(ctx, execution.ExpiredLeaseRecoveryRequest{
		Now:              now.Add(6 * time.Second),
		ReleaseReason:    string(execution.DurableTerminalReasonLeaseExpired),
		TerminalReason:   execution.DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: 2,
	})
	if err != nil {
		return recoveryProofReport{}, err
	}
	if len(firstRecovered) != 1 || firstRecovered[0].Run.RunID != runID {
		return recoveryProofReport{}, fmt.Errorf("first recovery expected one recovery for %s", runID)
	}
	secondLease, err := store.AcquireNextExecutionLease(ctx, execution.NextExecutionLeaseRequest{
		LeaseID:   prefix + "-recovery-lease-2",
		StepID:    "handoff:rag-agent:rag_request",
		Lane:      execution.DurableLaneRAG,
		WorkerID:  workerID,
		Now:       now.Add(7 * time.Second),
		ExpiresAt: now.Add(9 * time.Second),
	})
	if err != nil {
		return recoveryProofReport{}, err
	}
	secondRecovered, err := store.RecoverExpiredExecutionLeases(ctx, execution.ExpiredLeaseRecoveryRequest{
		Now:              now.Add(10 * time.Second),
		ReleaseReason:    string(execution.DurableTerminalReasonLeaseExpired),
		TerminalReason:   execution.DurableTerminalReasonLeaseExpired,
		MaxRetryAttempts: 2,
	})
	if err != nil {
		return recoveryProofReport{}, err
	}
	if len(secondRecovered) != 1 || secondRecovered[0].Run.RunID != runID {
		return recoveryProofReport{}, fmt.Errorf("second recovery expected one recovery for %s", runID)
	}
	if firstRecovered[0].Run.Status != execution.DurableRunStatusQueued {
		return recoveryProofReport{}, fmt.Errorf("first recovery status = %s, want queued", firstRecovered[0].Run.Status)
	}
	if secondRecovered[0].Run.Status != execution.DurableRunStatusExpired {
		return recoveryProofReport{}, fmt.Errorf("second recovery status = %s, want expired", secondRecovered[0].Run.Status)
	}
	if secondRecovered[0].Run.TerminalReason != execution.DurableTerminalReasonLeaseExpired {
		return recoveryProofReport{}, fmt.Errorf("terminal reason = %s, want lease_expired", secondRecovered[0].Run.TerminalReason)
	}

	events, err := store.ListRunEvents(ctx, runID)
	if err != nil {
		return recoveryProofReport{}, err
	}
	eventTypes := durableEventTypes(events)
	if err := requireEventTypes(eventTypes, []execution.DurableRunEventType{
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeLeaseExpired,
		execution.DurableRunEventTypeRunQueued,
		execution.DurableRunEventTypeRunAdmitted,
		execution.DurableRunEventTypeLeaseAcquired,
		execution.DurableRunEventTypeRunStarted,
		execution.DurableRunEventTypeLeaseExpired,
		execution.DurableRunEventTypeRunExpired,
	}); err != nil {
		return recoveryProofReport{}, err
	}
	return recoveryProofReport{
		Events:               eventTypes,
		FirstLeaseAttempt:    firstLease.Attempt,
		FirstRecoveryStatus:  string(firstRecovered[0].Run.Status),
		SecondLeaseAttempt:   secondLease.Attempt,
		SecondRecoveryStatus: string(secondRecovered[0].Run.Status),
		TerminalReason:       string(secondRecovered[0].Run.TerminalReason),
	}, nil
}

func durableEventTypes(events []execution.DurableRunEvent) []string {
	types := make([]string, 0, len(events))
	for _, event := range events {
		types = append(types, string(event.EventType))
	}
	return types
}

func requireEventTypes(actual []string, expected []execution.DurableRunEventType) error {
	if len(actual) != len(expected) {
		return fmt.Errorf("event count = %d, want %d: %v", len(actual), len(expected), actual)
	}
	for index, expectedType := range expected {
		if actual[index] != string(expectedType) {
			return fmt.Errorf("event[%d] = %s, want %s", index, actual[index], expectedType)
		}
	}
	return nil
}

func cleanupProofArtifacts(ctx context.Context, databaseURL string, prefix string) error {
	if err := validateProofPrefix(prefix); err != nil {
		return err
	}
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	for _, statement := range []string{
		`delete from runtime.agent_runs where run_id like $1`,
		`delete from runtime.worker_heartbeats where worker_id like $1`,
	} {
		if _, err := pool.Exec(ctx, statement, prefix+"-%"); err != nil {
			return err
		}
	}
	return nil
}

func readLaneBudget(
	ctx context.Context,
	databaseURL string,
	lane execution.DurableLane,
) (execution.LaneBudget, bool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return execution.LaneBudget{}, false, err
	}
	defer pool.Close()

	var budget execution.LaneBudget
	var laneText string
	var queueTimeoutMS int64
	var runTimeoutMS int64
	var leaseTimeoutMS int64
	var workerHeartbeatTimeoutMS int64
	err = pool.QueryRow(
		ctx,
		`select lane, max_active_leases, max_queued_runs, queue_timeout_ms,
			run_timeout_ms, lease_timeout_ms, worker_heartbeat_timeout_ms,
			enabled, updated_at
		from runtime.lane_budgets
		where lane = $1`,
		string(lane),
	).Scan(
		&laneText,
		&budget.MaxActiveLeases,
		&budget.MaxQueuedRuns,
		&queueTimeoutMS,
		&runTimeoutMS,
		&leaseTimeoutMS,
		&workerHeartbeatTimeoutMS,
		&budget.Enabled,
		&budget.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return execution.LaneBudget{}, false, nil
	}
	if err != nil {
		return execution.LaneBudget{}, false, err
	}
	budget.Lane = execution.DurableLane(laneText)
	budget.QueueTimeout = time.Duration(queueTimeoutMS) * time.Millisecond
	budget.RunTimeout = time.Duration(runTimeoutMS) * time.Millisecond
	budget.LeaseTimeout = time.Duration(leaseTimeoutMS) * time.Millisecond
	budget.WorkerHeartbeatTimeout = time.Duration(workerHeartbeatTimeoutMS) * time.Millisecond
	return budget, true, nil
}

func restoreLaneBudget(
	ctx context.Context,
	databaseURL string,
	budget execution.LaneBudget,
) error {
	store, err := execution.NewPostgresDurableRuntimeStore(ctx, execution.PostgresDurableRuntimeStoreOptions{
		DatabaseURL: databaseURL,
	})
	if err != nil {
		return err
	}
	defer store.Close()
	return store.UpsertLaneBudget(ctx, budget)
}

func readActiveLeaseCount(
	ctx context.Context,
	databaseURL string,
	lane execution.DurableLane,
) (int, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return 0, err
	}
	defer pool.Close()
	var count int
	if err := pool.QueryRow(
		ctx,
		`select count(*) from runtime.execution_leases where lane = $1 and status = $2`,
		string(lane),
		string(execution.ExecutionLeaseStatusLeased),
	).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func readLaneBudgetForTest(
	ctx context.Context,
	databaseURL string,
	lane execution.DurableLane,
) (execution.LaneBudget, error) {
	budget, ok, err := readLaneBudget(ctx, databaseURL, lane)
	if err != nil {
		return execution.LaneBudget{}, err
	}
	if !ok {
		return execution.LaneBudget{}, execution.ErrLaneBudgetNotFound
	}
	return budget, nil
}

func proofArtifactsCleaned(
	ctx context.Context,
	store execution.DurableRuntimeStore,
	prefix string,
) (bool, error) {
	for _, runID := range []string{prefix + "-multi-run", prefix + "-recovery-run"} {
		if _, err := store.GetRun(ctx, runID); err == nil {
			return false, nil
		} else if !errors.Is(err, execution.ErrDurableRunNotFound) {
			return false, err
		}
	}
	return true, nil
}

func writeProofReport(path string, report proofReport) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}
