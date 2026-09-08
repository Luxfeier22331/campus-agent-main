package adaptertest

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionpersistence"
	activityprojection "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporaladapter/finalization/projection"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

func TestTemporalPostFinalizationStepAllowsOnlyMemoryAppend(t *testing.T) {
	if !activityprojection.TemporalPostFinalizationStepAllowed("memory.append") {
		t.Fatal("memory append should remain allowed after finalization")
	}
	if activityprojection.TemporalPostFinalizationStepAllowed("memory.operation_status") {
		t.Fatal("retired memory.operation_status must not be allowed after finalization")
	}
}

func TestProjectTemporalStepRecordsLateCompletionAfterTerminalStepProjection(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	server := newAdapterForTest(config.Config{})
	attachRunProjectionStoreForAdapterTest(server, store)
	now := time.Date(2026, 6, 11, 1, 2, 3, 0, time.UTC)
	createQueuedDurableRunForTest(
		t,
		store,
		"run-step-terminal-late",
		"conv-step-terminal-late",
		now,
		agentRequestForDurableWorkerTest("hello"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-step-terminal-late",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	if _, err := store.UpsertRunStep(context.Background(), execution.RunStepProjection{
		StepID:               "solve.initial",
		RequestID:            "run-step-terminal-late",
		ConversationID:       "conv-step-terminal-late",
		StepKind:             "agent",
		Tool:                 "",
		Status:               "failed",
		ActivityAttempt:      1,
		TaskQueue:            temporalruntime.ActivityTaskQueueAgent,
		WorkerID:             "worker-1",
		StartedAt:            now.Add(2 * time.Second),
		CompletedAt:          now.Add(3 * time.Second),
		UpdatedAt:            now.Add(3 * time.Second),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload:     map[string]any{"terminal_reason": "provider_timeout"},
	}); err != nil {
		t.Fatalf("seed terminal step: %v", err)
	}
	if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
		ActivityAttempt:      1,
		Attempt:              1,
		AttemptID:            activityprojection.TemporalStepAttemptID("run-step-terminal-late", "solve.initial", 1),
		RequestID:            "run-step-terminal-late",
		StepID:               "solve.initial",
		Status:               "failed",
		PayloadSchemaVersion: "step-attempt-projection-v1",
		SanitizedPayload:     map[string]any{"terminal_reason": "provider_timeout"},
		UpdatedAt:            now.Add(3 * time.Second),
	}); err != nil {
		t.Fatalf("seed terminal attempt: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	err = server.ProjectTemporalStep(context.Background(), activityprojection.TemporalStepProjection{
		ActivityAttempt: 1,
		Attempt:         1,
		Tool:            "",
		Run:             run,
		Status:          "completed",
		StepID:          "solve.initial",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		WorkerID:        "worker-1",
		StartedAt:       now.Add(4 * time.Second),
		CompletedAt:     now.Add(5 * time.Second),
		UpdatedAt:       now.Add(5 * time.Second),
		ResultKind:      "agent_final_output",
		ProjectionRef:   activityprojection.TemporalProjectionRef(run.RequestID, "solve/initial/result"),
		Payload:         map[string]any{"provider_response": "late"},
	})
	if err == nil || !strings.Contains(err.Error(), "already terminal before solve.initial completion projection") {
		t.Fatalf("late completion error = %v", err)
	}

	attempts, err := store.ListStepAttempts(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("attempt count = %d, want one preserved terminal attempt: %#v", len(attempts), attempts)
	}
	if attempts[0].Status != "failed" ||
		attempts[0].SanitizedPayload["terminal_reason"] != "provider_timeout" {
		t.Fatalf("late attempt = %#v, want original failed attempt preserved", attempts[0])
	}
	steps, err := store.ListRunSteps(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "failed" {
		t.Fatalf("steps = %#v, want original failed aggregate step", steps)
	}
	results, err := store.ListStepResults(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("late terminal step completion wrote results: %#v", results)
	}
}

func TestProjectTemporalStepAllowsEquivalentTerminalReplay(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	server := newAdapterForTest(config.Config{})
	attachRunProjectionStoreForAdapterTest(server, store)
	now := time.Date(2026, 6, 11, 1, 32, 3, 0, time.UTC)
	createQueuedDurableRunForTest(
		t,
		store,
		"run-step-terminal-replay",
		"conv-step-terminal-replay",
		now,
		agentRequestForDurableWorkerTest("hello"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-step-terminal-replay",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-step-terminal-replay")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	projection := activityprojection.TemporalStepProjection{
		ActivityAttempt:    1,
		ActivityID:         "activity-solve-initial",
		ActivityType:       temporalruntime.SolveTaskActivityName,
		Attempt:            1,
		Tool:               "",
		CompletedAt:        now.Add(4 * time.Second),
		DurationMS:         2000,
		ModelName:          "test-model",
		ModelProvider:      "test-provider",
		Payload:            map[string]any{"provider_response": "stable"},
		ProjectionRef:      activityprojection.TemporalProjectionRef(run.RequestID, "solve/initial/result"),
		ProviderRequestRef: "provider-request-stable",
		ProviderResponseID: "provider-response-stable",
		ResultKind:         "agent_final_output",
		Run:                run,
		ScheduledAt:        now.Add(time.Second),
		ScheduleToStartMS:  1000,
		StartedAt:          now.Add(2 * time.Second),
		Status:             "completed",
		StepID:             "solve.initial",
		StepKind:           "agent",
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		TemporalRunID:      "temporal-run-step-terminal-replay",
		UpdatedAt:          now.Add(4 * time.Second),
		WorkerID:           "worker-1",
		WorkflowID:         "campus-agent.chat.run-step-terminal-replay",
	}
	if err := server.ProjectTemporalStep(context.Background(), projection); err != nil {
		t.Fatalf("project terminal step: %v", err)
	}
	if err := server.ProjectTemporalStep(context.Background(), projection); err != nil {
		t.Fatalf("replay equivalent terminal step: %v", err)
	}

	steps, err := store.ListRunSteps(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "completed" || steps[0].ActivityAttempt != 1 {
		t.Fatalf("steps = %#v, want one completed attempt-1 step", steps)
	}
	attempts, err := store.ListStepAttempts(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 1 || attempts[0].Status != "completed" || attempts[0].ActivityAttempt != 1 {
		t.Fatalf("attempts = %#v, want one completed attempt-1 projection", attempts)
	}
	results, err := store.ListStepResults(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 1 || results[0].Status != "completed" {
		t.Fatalf("results = %#v, want one completed result", results)
	}
}

func TestProjectTemporalStepAllowsHigherActivityAttemptToReplaceTerminalStep(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	server := newAdapterForTest(config.Config{})
	attachRunProjectionStoreForAdapterTest(server, store)
	now := time.Date(2026, 6, 11, 2, 2, 3, 0, time.UTC)
	createQueuedDurableRunForTest(
		t,
		store,
		"run-step-retry-takeover",
		"conv-step-retry-takeover",
		now,
		agentRequestForDurableWorkerTest("hello"),
	)
	if _, err := store.TransitionRun(
		context.Background(),
		"run-step-retry-takeover",
		execution.DurableRunStatusAdmitted,
		"",
		now.Add(time.Second),
	); err != nil {
		t.Fatalf("admit run: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-step-retry-takeover")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	base := activityprojection.TemporalStepProjection{
		ActivityAttempt: 1,
		Attempt:         1,
		Run:             run,
		Status:          "failed",
		StepID:          "solve.initial",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		StartedAt:       now.Add(2 * time.Second),
		CompletedAt:     now.Add(3 * time.Second),
		UpdatedAt:       now.Add(3 * time.Second),
		Payload:         map[string]any{"terminal_reason": "provider_timeout"},
	}
	if err := server.ProjectTemporalStep(context.Background(), base); err != nil {
		t.Fatalf("project attempt 1 failure: %v", err)
	}
	base.ActivityAttempt = 2
	base.Attempt = 2
	base.Status = "completed"
	base.StartedAt = now.Add(4 * time.Second)
	base.CompletedAt = now.Add(5 * time.Second)
	base.UpdatedAt = now.Add(5 * time.Second)
	base.Payload = map[string]any{"provider_response": "retry-success"}
	base.ResultKind = "agent_final_output"
	base.ProjectionRef = activityprojection.TemporalProjectionRef(run.RequestID, "solve/initial/result")
	if err := server.ProjectTemporalStep(context.Background(), base); err != nil {
		t.Fatalf("project attempt 2 completion: %v", err)
	}
	steps, err := store.ListRunSteps(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "completed" {
		t.Fatalf("steps = %#v, want attempt 2 completion", steps)
	}
	attempts, err := store.ListStepAttempts(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 2 || attempts[1].ActivityAttempt != 2 || attempts[1].Status != "completed" {
		t.Fatalf("attempts = %#v, want failed attempt 1 and completed attempt 2", attempts)
	}

	base.ActivityAttempt = 1
	base.Attempt = 1
	base.StartedAt = now.Add(2 * time.Second)
	base.CompletedAt = now.Add(6 * time.Second)
	base.UpdatedAt = now.Add(6 * time.Second)
	base.Payload = map[string]any{"provider_response": "stale-attempt-1"}
	if err := server.ProjectTemporalStep(context.Background(), base); err == nil {
		t.Fatal("stale attempt 1 completion should be rejected")
	}
	steps, err = store.ListRunSteps(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list steps after stale completion: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "completed" ||
		steps[0].SanitizedPayload["provider_response"] != "retry-success" {
		t.Fatalf("steps = %#v, want attempt 2 aggregate after stale attempt 1", steps)
	}
}

func TestProjectTemporalStepPreservesCancellationFinalizerTerminalProjection(t *testing.T) {
	store := executionpersistence.NewInMemoryRunProjectionStore()
	server := newAdapterForTest(config.Config{})
	attachRunProjectionStoreForAdapterTest(server, store)
	now := time.Date(2026, 7, 23, 6, 0, 0, 0, time.UTC)
	createQueuedDurableRunForTest(
		t,
		store,
		"run-step-cancel-fence",
		"conv-step-cancel-fence",
		now,
		agentRequestForDurableWorkerTest("hello"),
	)
	run, err := store.GetRun(context.Background(), "run-step-cancel-fence")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	started := activityprojection.TemporalStepProjection{
		ActivityAttempt: 1,
		Attempt:         1,
		Run:             run,
		Status:          "started",
		StepID:          "solve.initial",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		StartedAt:       now.Add(time.Second),
		UpdatedAt:       now.Add(time.Second),
		Payload:         map[string]any{"marker": "started"},
	}
	if err := server.ProjectTemporalStep(context.Background(), started); err != nil {
		t.Fatalf("project started step: %v", err)
	}
	canceledAt := now.Add(2 * time.Second)
	if err := execution.CancelIncompleteRunWork(
		context.Background(),
		store,
		run,
		"user_requested",
		canceledAt,
	); err != nil {
		t.Fatalf("project canceled steps: %v", err)
	}

	lateFailure := started
	lateFailure.Status = "failed"
	lateFailure.CompletedAt = now.Add(3 * time.Second)
	lateFailure.UpdatedAt = lateFailure.CompletedAt
	lateFailure.ResultKind = "activity_failure"
	lateFailure.ProjectionRef = activityprojection.TemporalProjectionRef(run.RequestID, "solve/initial/result")
	lateFailure.Payload = map[string]any{"marker": "late-failure"}
	if err := server.ProjectTemporalStep(context.Background(), lateFailure); !errors.Is(err, execution.ErrStaleRunStepProjection) {
		t.Fatalf("late failure error = %v, want ErrStaleRunStepProjection", err)
	}
	steps, err := store.ListRunSteps(context.Background(), run.RequestID)
	if err != nil || len(steps) != 1 {
		t.Fatalf("steps = %#v, error = %v", steps, err)
	}
	if steps[0].Status != "canceled" || steps[0].SanitizedPayload["cancel_reason"] != "user_requested" {
		t.Fatalf("step = %#v, want cancellation finalizer projection", steps[0])
	}
	attempts, err := store.ListStepAttempts(context.Background(), run.RequestID)
	if err != nil || len(attempts) != 1 {
		t.Fatalf("attempts = %#v, error = %v", attempts, err)
	}
	if attempts[0].Status != "canceled" ||
		attempts[0].CancelOutcome != execution.CancelOutcomeActivityContextCanceled {
		t.Fatalf("attempt = %#v, want cancellation finalizer projection", attempts[0])
	}
	results, err := store.ListStepResults(context.Background(), run.RequestID)
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("late failure wrote results: %#v", results)
	}
}
