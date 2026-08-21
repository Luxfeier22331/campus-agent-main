package httpapi

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
)

func TestStageTimingForRunProjectsCanonicalExecutionFields(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(configForStageTimingTest())
	server.runProjectionStore = store
	server.runProjectionStoreErr = nil

	now := time.Date(2026, 7, 4, 10, 0, 0, 0, time.UTC)
	run := createStageTimingRun(t, store, now)
	for index, attempt := range []struct {
		stepID            string
		durationMS        int64
		scheduleToStartMS int64
		sanitizedPayload  map[string]any
	}{
		{
			stepID:           "sdk_tool.execute.personal_memory_recall.1",
			durationMS:       110,
			sanitizedPayload: map[string]any{"tool_name": "personal_memory_recall"},
		},
		{stepID: "agent.primary", durationMS: 120, scheduleToStartMS: 75},
		{stepID: "sdk_tool.execute.test_lookup.1", durationMS: 140, sanitizedPayload: map[string]any{"tool_name": "test_lookup"}},
		{stepID: "finalization.write", durationMS: 230},
	} {
		upsertStageTimingAttemptWithSchedule(
			t,
			store,
			run.RunID,
			index+1,
			attempt.stepID,
			attempt.durationMS,
			attempt.scheduleToStartMS,
			attempt.sanitizedPayload,
			now,
		)
	}

	timing, err := server.stageTimingForRun(context.Background(), run, map[string]any{"agent.runtime_ms": float64(321)})
	if err != nil {
		t.Fatalf("stage timing: %v", err)
	}

	assertStageTimingField(t, timing, "execution.dispatch_ms", 100)
	assertStageTimingField(t, timing, "execution.admission_ms", 200)
	assertStageTimingField(t, timing, "stream.first_delta_persist_ms", 500)
	assertStageTimingField(t, timing, "memory.recall_ms", 110)
	assertStageTimingField(t, timing, "agent.primary_ms", 120)
	assertStageTimingField(t, timing, "agent.schedule_to_start_ms", 75)
	assertStageTimingField(t, timing, "agent.runtime_ms", 321)
	assertStageTimingField(t, timing, "tool.total_ms", 250)
	if _, ok := timing["finalization.write_ms"]; ok {
		t.Fatalf("stage_timing callback projection must exclude self-referential finalization.write_ms: %#v", timing)
	}
}

func TestStageTimingForRunDoesNotSynthesizeUnexecutedStages(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := NewServer(configForStageTimingTest())
	server.runProjectionStore = store
	server.runProjectionStoreErr = nil

	now := time.Date(2026, 7, 4, 10, 30, 0, 0, time.UTC)
	run := createStageTimingRun(t, store, now)
	upsertStageTimingAttempt(t, store, run.RunID, 1, "agent.primary", 120, nil, now)

	timing, err := server.stageTimingForRun(context.Background(), run, nil)
	if err != nil {
		t.Fatalf("stage timing: %v", err)
	}

	assertStageTimingField(t, timing, "execution.dispatch_ms", 100)
	assertStageTimingField(t, timing, "execution.admission_ms", 200)
	assertStageTimingField(t, timing, "stream.first_delta_persist_ms", 500)
	assertStageTimingField(t, timing, "agent.primary_ms", 120)
	for _, field := range []string{
		"agent.schedule_to_start_ms",
		"memory.recall_ms",
		"agent.runtime_ms",
		"agent.first_delta_ms",
		"tool.total_ms",
		"finalization.write_ms",
	} {
		if _, ok := timing[field]; ok {
			t.Fatalf("stage_timing must not synthesize %s without a matching executed stage: %#v", field, timing)
		}
	}
}

func configForStageTimingTest() config.Config {
	return config.Config{TemporalWorkerIdentity: "test:stage-timing"}
}

func createStageTimingRun(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	now time.Time,
) execution.DurableRun {
	t.Helper()
	run, err := store.CreateRun(context.Background(), execution.DurableRun{
		RunID:          "run-stage-timing",
		ConversationID: "conv-stage-timing",
		TurnID:         "turn-stage-timing",
		RequestID:      "req-stage-timing",
		TraceID:        "trace-stage-timing",
		OwnerUserID:    "user-stage-timing",
		Surface:        "campus-web",
		TaskQueue:      "campus-agent.workflow",
		CreatedAt:      now,
		Metadata:       v3ExecutionMetadataForHTTPTest("run-stage-timing", ""),
	})
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	queued, err := store.TransitionRun(context.Background(), run.RunID, execution.DurableRunStatusQueued, "", now.Add(100*time.Millisecond))
	if err != nil {
		t.Fatalf("queue run: %v", err)
	}
	admitted, err := store.TransitionRun(context.Background(), queued.RunID, execution.DurableRunStatusAdmitted, "", now.Add(300*time.Millisecond))
	if err != nil {
		t.Fatalf("admit run: %v", err)
	}
	running, err := store.TransitionRun(
		context.Background(),
		admitted.RunID,
		execution.DurableRunStatusRunning,
		"",
		now.Add(400*time.Millisecond),
	)
	if err != nil {
		t.Fatalf("start run: %v", err)
	}
	streaming, err := store.StartRunAnswerStream(
		context.Background(),
		execution.RunAnswerStreamStartRequest{
			RunID: running.RunID,
			Now:   now.Add(900 * time.Millisecond),
			AnswerStartedEvent: execution.DurableRunEvent{
				EventID: running.RunID + ":answer-started", RunID: running.RunID,
				ConversationID:       running.ConversationID,
				EventType:            execution.DurableRunEventTypeRunAnswerStarted,
				OccurredAt:           now.Add(900 * time.Millisecond),
				Visibility:           execution.DurableRunEventVisibilityBrowser,
				PayloadSchemaVersion: "run-answer-event-v2",
				Payload:              map[string]any{"status": "streaming"},
			},
			FirstDeltaEvent: execution.DurableRunEvent{
				EventID: running.RunID + ":answer-delta:1", RunID: running.RunID,
				ConversationID:       running.ConversationID,
				EventType:            execution.DurableRunEventTypeRunAnswerDelta,
				OccurredAt:           now.Add(900 * time.Millisecond),
				Visibility:           execution.DurableRunEventVisibilityBrowser,
				PayloadSchemaVersion: "run-answer-event-v2",
				Payload:              map[string]any{"chunk_index": 1, "delta": "答"},
			},
		},
	)
	if err != nil {
		t.Fatalf("start answer stream: %v", err)
	}
	return streaming
}

func upsertStageTimingAttempt(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	index int,
	stepID string,
	durationMS int64,
	sanitizedPayload map[string]any,
	now time.Time,
) {
	t.Helper()
	upsertStageTimingAttemptWithSchedule(
		t,
		store,
		runID,
		index,
		stepID,
		durationMS,
		0,
		sanitizedPayload,
		now,
	)
}

func upsertStageTimingAttemptWithSchedule(
	t *testing.T,
	store *execution.InMemoryRunProjectionStore,
	runID string,
	index int,
	stepID string,
	durationMS int64,
	scheduleToStartMS int64,
	sanitizedPayload map[string]any,
	now time.Time,
) {
	t.Helper()
	if sanitizedPayload == nil {
		sanitizedPayload = map[string]any{}
	}
	if _, err := store.UpsertStepAttempt(context.Background(), execution.StepAttemptProjection{
		AttemptID:             fmt.Sprintf("%s:attempt:%02d", stepID, index),
		StepID:                stepID,
		RunID:                 runID,
		Attempt:               1,
		Status:                "completed",
		TaskQueue:             "campus-agent.activity",
		WorkerID:              "test:worker",
		WorkflowID:            "campus-agent.chat." + runID,
		TemporalRunID:         "temporal-run-stage-timing",
		ActivityID:            stepID + ":activity",
		ActivityType:          stepID,
		ActivityAttempt:       1,
		ScheduledAt:           now.Add(time.Duration(index) * time.Second),
		StartedAt:             now.Add(time.Duration(index) * time.Second),
		CompletedAt:           now.Add(time.Duration(index)*time.Second + time.Duration(durationMS)*time.Millisecond),
		ScheduleToStartMS:     scheduleToStartMS,
		DurationMS:            durationMS,
		CancelOutcome:         execution.CancelOutcomeNotRequested,
		TimeoutOutcome:        execution.TimeoutOutcomeNotTimedOut,
		LateCompletionOutcome: execution.LateCompletionOutcomeNotLate,
		UpdatedAt:             now.Add(time.Duration(index)*time.Second + time.Duration(durationMS)*time.Millisecond),
		PayloadSchemaVersion:  "step-attempt-projection-v1",
		SanitizedPayload:      sanitizedPayload,
	}); err != nil {
		t.Fatalf("upsert attempt %s: %v", stepID, err)
	}
}

func assertStageTimingField(t *testing.T, timing map[string]any, field string, want float64) {
	t.Helper()
	got, ok := timing[field]
	if !ok {
		t.Fatalf("stage_timing missing %s: %#v", field, timing)
	}
	gotNumber, ok := got.(float64)
	if !ok {
		t.Fatalf("stage_timing.%s = %#v, want float64", field, got)
	}
	if gotNumber != want {
		t.Fatalf("stage_timing.%s = %v, want %v; timing=%#v", field, gotNumber, want, timing)
	}
}
