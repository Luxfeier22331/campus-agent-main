package temporaladapter

import (
	"context"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestFailedRunPublishesBrowserTerminalEventOnlyAfterProductCallback(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	server := newAdapterForTest(config.Config{})
	attachRunProjectionStoreForAdapterTest(server, store)
	createQueuedDurableRunForTest(
		t,
		store,
		"run-callback-before-failure",
		"conv-callback-before-failure",
		time.Date(2026, 6, 4, 1, 2, 3, 0, time.UTC),
		nil,
	)
	run, err := store.GetRun(context.Background(), "run-callback-before-failure")
	if err != nil {
		t.Fatalf("get queued run: %v", err)
	}
	server.productFinalizationWriter = func(
		_ context.Context,
		_ execution.DurableRun,
		_ time.Time,
		response map[string]any,
	) error {
		if response["status"] != "error" {
			t.Fatalf("product callback status = %#v, want error", response["status"])
		}
		events, err := store.ListRunEvents(context.Background(), run.RequestID)
		if err != nil {
			t.Fatalf("list events in product callback: %v", err)
		}
		for _, event := range events {
			if event.EventType == execution.DurableRunEventTypeRunFailed {
				t.Fatal("run.failed became visible before product callback succeeded")
			}
		}
		return errors.New("callback unavailable")
	}

	_, err = server.failTemporalRun(
		context.Background(),
		run,
		temporalStepFailureProjection{FailureKind: "provider_unavailable"},
		errors.New("provider unavailable"),
	)
	if err == nil || err.Error() != "callback unavailable" {
		t.Fatalf("failure result error = %v, want callback unavailable", err)
	}
	latest, err := store.GetRun(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("get run after callback failure: %v", err)
	}
	if temporalRunTerminal(latest.Status) {
		t.Fatalf("run status = %s, want nonterminal after callback failure", latest.Status)
	}
}
