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
		stepID           string
		durationMS       int64
		sanitizedPayload map[string]any
	}{
		{stepID: "memory.recall", durationMS: 110},
		{stepID: "agent.primary", durationMS: 120},
		{stepID: "typed_tool.execute", durationMS: 130, sanitizedPayload: map[string]any{"selected_tool": "knowledge_query"}},
		{stepID: "typed_tool.execute", durationMS: 140, sanitizedPayload: map[string]any{"tool_name": "transport_schedule_lookup"}},
		{stepID: "typed_tool.execute", durationMS: 150, sanitizedPayload: map[string]any{"selected_tool": "campus_notice_discover"}},
		{stepID: "rag.plan", durationMS: 160},
		{stepID: "retrieval.indexed_lookup", durationMS: 170},
		{stepID: "retrieval.live_source_lookup", durationMS: 180},
		{stepID: "evidence.selection", durationMS: 190},
		{stepID: "rag.rerank", durationMS: 200},
		{stepID: "synthesis", durationMS: 210},
		{stepID: "grounding.verify", durationMS: 220},
		{stepID: "finalization.write", durationMS: 230},
	} {
		upsertStageTimingAttempt(t, store, run.RunID, index+1, attempt.stepID, attempt.durationMS, attempt.sanitizedPayload, now)
	}

	timing, err := server.stageTimingForRun(context.Background(), run, map[string]any{"agent.runtime_ms": float64(321)})
	if err != nil {
		t.Fatalf("stage timing: %v", err)
	}

	assertStageTimingField(t, timing, "execution.admission_ms", 200)
	assertStageTimingField(t, timing, "memory.recall_ms", 110)
	assertStageTimingField(t, timing, "agent.primary_ms", 120)
	assertStageTimingField(t, timing, "agent.runtime_ms", 321)
	assertStageTimingField(t, timing, "tool.total_ms", 630)
	assertStageTimingField(t, timing, "tool.knowledge_query_ms", 340)
	assertStageTimingField(t, timing, "tool.transport_schedule_lookup_ms", 140)
	assertStageTimingField(t, timing, "tool.campus_notice_discover_ms", 150)
	assertStageTimingField(t, timing, "rag.plan_ms", 160)
	assertStageTimingField(t, timing, "rag.lookup_ms", 540)
	assertStageTimingField(t, timing, "rag.rerank_ms", 200)
	assertStageTimingField(t, timing, "rag.synthesis_ms", 210)
	assertStageTimingField(t, timing, "rag.grounding_ms", 220)
	assertStageTimingField(t, timing, "finalization.write_ms", 230)
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

	assertStageTimingField(t, timing, "execution.admission_ms", 200)
	assertStageTimingField(t, timing, "agent.primary_ms", 120)
	for _, field := range []string{
		"memory.recall_ms",
		"agent.runtime_ms",
		"agent.first_delta_ms",
		"tool.total_ms",
		"tool.knowledge_query_ms",
		"tool.transport_schedule_lookup_ms",
		"tool.campus_notice_discover_ms",
		"rag.plan_ms",
		"rag.lookup_ms",
		"rag.rerank_ms",
		"rag.synthesis_ms",
		"rag.grounding_ms",
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
		Metadata:       map[string]any{},
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
	return admitted
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
