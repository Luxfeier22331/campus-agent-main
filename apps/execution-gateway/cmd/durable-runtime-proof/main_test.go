package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
)

func TestParseOptionsRequiresExplicitDatabaseURLAndEvidencePath(t *testing.T) {
	_, err := parseOptions([]string{"--database-url", "postgres://example"})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing evidence path error = %v, want errInvalidOptions", err)
	}

	_, err = parseOptions([]string{"--evidence-path", "proof.json"})
	if !errors.Is(err, errInvalidOptions) {
		t.Fatalf("parse missing database url error = %v, want errInvalidOptions", err)
	}
}

func TestValidateProofPrefixRejectsBroadOrNonProofPrefix(t *testing.T) {
	for _, prefix := range []string{"", "pg", "test", "proof", "proof-*", "proof/unsafe"} {
		if err := validateProofPrefix(prefix); err == nil {
			t.Fatalf("validateProofPrefix(%q) returned nil error", prefix)
		}
	}
}

func TestRunDurableRuntimeProofWithPostgresStore(t *testing.T) {
	databaseURL := os.Getenv("SUPERVISOR_API_DURABLE_RUNTIME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("SUPERVISOR_API_DURABLE_RUNTIME_TEST_DATABASE_URL is not configured")
	}

	evidencePath := filepath.Join(t.TempDir(), "durable-runtime-proof.json")
	prefix := "proof-test-" + time.Now().UTC().Format("20060102T150405.000000000")
	report, err := runProof(context.Background(), proofOptions{
		DatabaseURL:  databaseURL,
		EvidencePath: evidencePath,
		Prefix:       prefix,
		Now:          time.Date(2026, 6, 4, 21, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("run proof: %v", err)
	}
	if !report.Passed {
		t.Fatalf("proof report passed = false: %#v", report)
	}
	if report.MultiWorker.SuccessfulLeaseCount != 1 || report.MultiWorker.EmptyQueueCount != 1 {
		t.Fatalf("multi-worker report = %#v, want one lease and one empty queue", report.MultiWorker)
	}
	if report.Recovery.FirstRecoveryStatus != string(execution.DurableRunStatusQueued) {
		t.Fatalf("first recovery status = %q, want queued", report.Recovery.FirstRecoveryStatus)
	}
	if report.Recovery.SecondRecoveryStatus != string(execution.DurableRunStatusExpired) {
		t.Fatalf("second recovery status = %q, want expired", report.Recovery.SecondRecoveryStatus)
	}
	if report.Recovery.TerminalReason != string(execution.DurableTerminalReasonLeaseExpired) {
		t.Fatalf("terminal reason = %q, want lease_expired", report.Recovery.TerminalReason)
	}

	data, err := os.ReadFile(evidencePath)
	if err != nil {
		t.Fatalf("read evidence: %v", err)
	}
	var persisted proofReport
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatalf("decode evidence: %v", err)
	}
	if persisted.Prefix != prefix || !persisted.Passed {
		t.Fatalf("persisted evidence = %#v, want prefix %s passed", persisted, prefix)
	}

	store, err := execution.NewPostgresDurableRuntimeStore(context.Background(), execution.PostgresDurableRuntimeStoreOptions{
		DatabaseURL: databaseURL,
	})
	if err != nil {
		t.Fatalf("open postgres store for cleanup assertion: %v", err)
	}
	t.Cleanup(store.Close)
	if _, err := store.GetRun(context.Background(), prefix+"-multi-run"); !errors.Is(err, execution.ErrDurableRunNotFound) {
		t.Fatalf("proof run cleanup error = %v, want ErrDurableRunNotFound", err)
	}
}

func TestRunProofRestoresExistingLaneBudget(t *testing.T) {
	databaseURL := os.Getenv("SUPERVISOR_API_DURABLE_RUNTIME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("SUPERVISOR_API_DURABLE_RUNTIME_TEST_DATABASE_URL is not configured")
	}

	ctx := context.Background()
	store, err := execution.NewPostgresDurableRuntimeStore(ctx, execution.PostgresDurableRuntimeStoreOptions{
		DatabaseURL: databaseURL,
		AutoMigrate: true,
	})
	if err != nil {
		t.Fatalf("open postgres store: %v", err)
	}
	t.Cleanup(store.Close)

	original := execution.LaneBudget{
		Lane:                   execution.DurableLaneRAG,
		MaxActiveLeases:        7,
		MaxQueuedRuns:          17,
		QueueTimeout:           41 * time.Second,
		RunTimeout:             42 * time.Second,
		LeaseTimeout:           43 * time.Second,
		WorkerHeartbeatTimeout: 44 * time.Second,
		Enabled:                true,
		UpdatedAt:              time.Date(2026, 6, 4, 22, 0, 0, 0, time.UTC),
	}
	if err := store.UpsertLaneBudget(ctx, original); err != nil {
		t.Fatalf("seed lane budget: %v", err)
	}

	_, err = runProof(ctx, proofOptions{
		DatabaseURL:  databaseURL,
		EvidencePath: filepath.Join(t.TempDir(), "proof.json"),
		Prefix:       "proof-restore-" + time.Now().UTC().Format("20060102T150405.000000000"),
		Now:          time.Date(2026, 6, 4, 22, 1, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("run proof: %v", err)
	}

	restored, err := readLaneBudgetForTest(ctx, databaseURL, execution.DurableLaneRAG)
	if err != nil {
		t.Fatalf("read restored lane budget: %v", err)
	}
	if restored.MaxActiveLeases != original.MaxActiveLeases ||
		restored.MaxQueuedRuns != original.MaxQueuedRuns ||
		restored.QueueTimeout != original.QueueTimeout ||
		restored.RunTimeout != original.RunTimeout ||
		restored.LeaseTimeout != original.LeaseTimeout ||
		restored.WorkerHeartbeatTimeout != original.WorkerHeartbeatTimeout ||
		restored.Enabled != original.Enabled {
		t.Fatalf("restored lane budget = %#v, want %#v", restored, original)
	}
}
