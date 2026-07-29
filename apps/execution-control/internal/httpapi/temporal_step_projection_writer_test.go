package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	tracecollector "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonproto "go.opentelemetry.io/proto/otlp/common/v1"
	traceproto "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestProjectTemporalStepEmitsLangfuseObservationTelemetry(t *testing.T) {
	collector := newTraceCollectorForTest(t)
	server := NewServer(config.Config{
		DeploymentEnvironment:        "staging",
		OTelAllowedAttributesVersion: "execution-control-otel-attrs-v1",
		OTelEnabled:                  true,
		OTelEndpoint:                 collector.URL() + "/v1/traces",
		OTelExportTimeoutMS:          500,
		OTelSampleRatio:              1,
		RAGTopKMax:                   8,
		DeploymentRelease:            "execution-control@langfuse-test",
	})
	shutdown := false
	t.Cleanup(func() {
		if !shutdown {
			if err := server.Shutdown(context.Background()); err != nil {
				t.Fatalf("close server: %v", err)
			}
		}
	})
	store := execution.NewInMemoryRunProjectionStore()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 18, 8, 30, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-langfuse-step",
		"conv-langfuse-step",
		now,
		agentRequestForDurableWorkerTest("理学院有什么专业"),
	)
	run, err := store.GetRun(context.Background(), "run-langfuse-step")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	if err := server.projectTemporalStep(context.Background(), temporalStepProjection{
		ActivityAttempt:   3,
		ActivityID:        "activity-core-finalization-write",
		ActivityType:      temporalruntime.WriteFinalizationActivityName,
		Attempt:           3,
		CompletedAt:       now.Add(14 * time.Second),
		DurationMS:        2100,
		FailCloseReason:   "grounding_low_confidence",
		Payload:           map[string]any{},
		ProjectionRef:     temporalProjectionRef(run.RunID, "finalization/write"),
		ResultKind:        "answer_finalization",
		Run:               run,
		ScheduledAt:       now.Add(10 * time.Second),
		ScheduleToStartMS: 900,
		StartedAt:         now.Add(12 * time.Second),
		Status:            "completed",
		StepID:            "finalization.write",
		StepKind:          "finalization",
		TaskQueue:         temporalruntime.ActivityTaskQueueCore,
		TemporalRunID:     "temporal-run-langfuse-step",
		UpdatedAt:         now.Add(14 * time.Second),
		WorkflowID:        "campus-agent.chat.run-langfuse-step",
		WorkerID:          "worker-finalization-1",
	}); err != nil {
		t.Fatalf("project temporal step: %v", err)
	}
	if err := server.Shutdown(context.Background()); err != nil {
		t.Fatalf("flush server telemetry: %v", err)
	}
	shutdown = true

	span := collector.findSpan(t, "execution_control.temporal.step_observation")
	attrs := otlpSpanAttributes(span)
	expected := map[string]string{
		"activity_attempt":          "3",
		"activity_type":             temporalruntime.WriteFinalizationActivityName,
		"deployment.environment":    "staging",
		"duration_ms":               "2100",
		"fail_close_reason":         "grounding_low_confidence",
		"langfuse.observation.type": "span",
		"langfuse.release":          "execution-control@langfuse-test",
		"langfuse.session.id":       "conv-langfuse-step",
		"langfuse.trace.name":       "online-answer",
		"langfuse.user.id":          "user-executor",
		"projection_ref":            temporalProjectionRef(run.RunID, "finalization/write"),
		"request_id":                "req-executor-001",
		"run_id":                    "run-langfuse-step",
		"schedule_to_start_ms":      "900",
		"status":                    "completed",
		"step_id":                   "finalization.write",
		"step_kind":                 "finalization",
		"task_queue":                temporalruntime.ActivityTaskQueueCore,
		"trace_id":                  "trace-executor-001",
		"workflow_id":               "campus-agent.chat.run-langfuse-step",
	}
	for key, want := range expected {
		if attrs[key] != want {
			t.Fatalf("span attribute %s = %q, want %q; attrs=%#v", key, attrs[key], want, attrs)
		}
	}
	if _, exists := attrs["tool_name"]; exists {
		t.Fatalf("finalization observation must not expose tool_name: %#v", attrs)
	}
	if got := time.Unix(0, int64(span.GetStartTimeUnixNano())).UTC(); !got.Equal(now.Add(12 * time.Second)) {
		t.Fatalf("span start time = %s, want %s", got, now.Add(12*time.Second))
	}
	if got := time.Unix(0, int64(span.GetEndTimeUnixNano())).UTC(); !got.Equal(now.Add(14 * time.Second)) {
		t.Fatalf("span end time = %s, want %s", got, now.Add(14*time.Second))
	}
}

func TestProjectTemporalStepCommitsWhenTelemetryIsUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		OTelEnabled:     true,
		OTelSampleRatio: 1,
	})
	store := execution.NewInMemoryRunProjectionStore()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 7, 23, 9, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
		t,
		store,
		"run-telemetry-unavailable",
		"conv-telemetry-unavailable",
		now,
		nil,
	)
	run, err := store.GetRun(context.Background(), "run-telemetry-unavailable")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if err := server.projectTemporalStep(context.Background(), temporalStepProjection{
		Attempt:       1,
		Run:           run,
		Status:        "started",
		StepID:        "agent.primary",
		StepKind:      "agent",
		TaskQueue:     temporalruntime.ActivityTaskQueueAgent,
		StartedAt:     now.Add(time.Second),
		UpdatedAt:     now.Add(time.Second),
		ProjectionRef: temporalProjectionRef(run.RunID, "agent/primary/result"),
	}); err != nil {
		t.Fatalf("project step with unavailable telemetry: %v", err)
	}
	steps, err := store.ListRunSteps(context.Background(), run.RunID)
	if err != nil || len(steps) != 1 || steps[0].Status != "started" {
		t.Fatalf("durable step=%#v error=%v", steps, err)
	}
	status := server.telemetry.Status()
	if status.FailedCount == 0 || status.LastError == "" {
		t.Fatalf("telemetry status=%#v, want a recorded unavailable emission", status)
	}
}

func TestTemporalStepObservationEventUsesActualToolName(t *testing.T) {
	event := temporalStepObservationEvent(temporalStepProjection{
		Tool:    personalMemoryRecallToolName,
		Payload: map[string]any{},
		Run: execution.DurableRun{
			RunID: "run-observation-tool-name",
		},
		StepID: "sdk_tool.execute.personal_memory_recall.1",
	})

	if event.ToolName != personalMemoryRecallToolName {
		t.Fatalf("tool name = %q, want actual projected tool", event.ToolName)
	}
}

func TestTemporalStepObservationEventIncludesGroundingSummary(t *testing.T) {
	startedAt := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	event := temporalStepObservationEvent(temporalStepProjection{
		CompletedAt: startedAt.Add(2 * time.Second),
		Payload: map[string]any{
			"covered_scopes":      []any{"student_rules"},
			"candidate_count":     float64(6),
			"evidence_count":      float64(2),
			"grounding_mode":      "multi_scope",
			"model_context_chars": float64(2048),
			"selected_scopes":     []any{"student_rules", "curriculum"},
			"stage_timing": map[string]any{
				"grounding.embedding_ms": float64(11.5),
				"grounding.search_ms":    float64(12),
				"grounding.rerank_ms":    float64(13.25),
				"grounding.pack_ms":      float64(14),
			},
			"status":      "ready",
			"token_count": float64(512),
		},
		Run: execution.DurableRun{
			RunID: "run-grounding-observation",
		},
		StartedAt: startedAt,
		Status:    "completed",
		StepID:    "grounding.prepare",
	})
	if event.GroundingMode != "multi_scope" || event.GroundingStatus != "ready" {
		t.Fatalf("grounding routing = %#v", event)
	}
	if !reflect.DeepEqual(event.GroundingSelectedScopes, []string{"student_rules", "curriculum"}) ||
		!reflect.DeepEqual(event.GroundingCoveredScopes, []string{"student_rules"}) {
		t.Fatalf("grounding scopes = %#v", event)
	}
	if event.GroundingCandidateCount != 6 || event.GroundingEvidenceCount != 2 ||
		event.GroundingTokenCount != 512 || event.GroundingModelContextChars != 2048 {
		t.Fatalf("grounding counts = %#v", event)
	}
	if !event.GroundingCandidateCountSet || !event.GroundingEmbeddingMSSet ||
		!event.GroundingSearchMSSet || !event.GroundingRerankMSSet || !event.GroundingPackMSSet {
		t.Fatalf("grounding diagnostic presence = %#v", event)
	}
	if !event.GroundingEvidenceCountSet || !event.GroundingTokenCountSet || !event.GroundingModelContextCharsSet {
		t.Fatalf("grounding count presence = %#v", event)
	}
	if event.GroundingEmbeddingMS != 11.5 || event.GroundingSearchMS != 12 ||
		event.GroundingRerankMS != 13.25 || event.GroundingPackMS != 14 {
		t.Fatalf("grounding timings = %#v", event)
	}
}

func TestTemporalStepObservationEventOmitsUnavailableGroundingDiagnostics(t *testing.T) {
	event := temporalStepObservationEvent(temporalStepProjection{
		Payload: map[string]any{
			"covered_scopes":      []any{"student_rules"},
			"evidence_count":      float64(0),
			"grounding_mode":      "multi_scope",
			"model_context_chars": float64(0),
			"selected_scopes":     []any{"student_rules"},
			"status":              "ready",
			"token_count":         float64(0),
		},
		StepID: "grounding.prepare",
	})

	if event.GroundingCandidateCountSet || event.GroundingEmbeddingMSSet || event.GroundingSearchMSSet ||
		event.GroundingRerankMSSet || event.GroundingPackMSSet {
		t.Fatalf("missing grounding diagnostics were marked present: %#v", event)
	}
	if !event.GroundingEvidenceCountSet || !event.GroundingTokenCountSet || !event.GroundingModelContextCharsSet {
		t.Fatalf("explicit zero grounding counts were not preserved: %#v", event)
	}
}

func TestTemporalStepObservationEventOmitsInvalidGroundingDiagnostics(t *testing.T) {
	event := temporalStepObservationEvent(temporalStepProjection{
		Payload: map[string]any{
			"candidate_count":     float64(-1),
			"evidence_count":      math.NaN(),
			"grounding_mode":      "multi_scope",
			"model_context_chars": math.Inf(1),
			"stage_timing": map[string]any{
				"grounding.embedding_ms": "not-a-number",
			},
			"token_count": -1,
		},
		StepID: "grounding.prepare",
	})

	if event.GroundingCandidateCountSet || event.GroundingEvidenceCountSet || event.GroundingTokenCountSet ||
		event.GroundingModelContextCharsSet || event.GroundingEmbeddingMSSet {
		t.Fatalf("invalid grounding diagnostics were marked present: %#v", event)
	}
}

func TestTemporalStepObservationEventPreservesExplicitZeroDiagnostics(t *testing.T) {
	event := temporalStepObservationEvent(temporalStepProjection{
		Payload: map[string]any{
			"candidate_count":     float64(0),
			"evidence_count":      float64(0),
			"grounding_mode":      "multi_scope",
			"model_context_chars": float64(0),
			"stage_timing": map[string]any{
				"grounding.embedding_ms": float64(0),
			},
			"token_count": float64(0),
		},
		StepID: "grounding.prepare",
	})

	if !event.GroundingCandidateCountSet || event.GroundingCandidateCount != 0 ||
		!event.GroundingEvidenceCountSet || event.GroundingEvidenceCount != 0 ||
		!event.GroundingTokenCountSet || event.GroundingTokenCount != 0 ||
		!event.GroundingModelContextCharsSet || event.GroundingModelContextChars != 0 ||
		!event.GroundingEmbeddingMSSet || event.GroundingEmbeddingMS != 0 {
		t.Fatalf("explicit zero grounding diagnostics were lost: %#v", event)
	}
}

func TestTemporalPostFinalizationStepAllowsOnlyMemoryAppend(t *testing.T) {
	if !temporalPostFinalizationStepAllowed("memory.append") {
		t.Fatal("memory append should remain allowed after finalization")
	}
	if temporalPostFinalizationStepAllowed("memory.operation_status") {
		t.Fatal("retired memory.operation_status must not be allowed after finalization")
	}
}

func TestProjectTemporalStepRecordsLateCompletionAfterTerminalStepProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 11, 1, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
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
		StepID:               "agent.primary",
		RunID:                "run-step-terminal-late",
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
		AttemptID:            temporalStepAttemptID("run-step-terminal-late", "agent.primary", 1),
		RunID:                "run-step-terminal-late",
		StepID:               "agent.primary",
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

	err = server.projectTemporalStep(context.Background(), temporalStepProjection{
		ActivityAttempt: 1,
		Attempt:         1,
		Tool:            "",
		Run:             run,
		Status:          "completed",
		StepID:          "agent.primary",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		WorkerID:        "worker-1",
		StartedAt:       now.Add(4 * time.Second),
		CompletedAt:     now.Add(5 * time.Second),
		UpdatedAt:       now.Add(5 * time.Second),
		ResultKind:      "agent_final_output",
		ProjectionRef:   temporalProjectionRef(run.RunID, "agent/primary/result"),
		Payload:         map[string]any{"provider_response": "late"},
	})
	if err == nil || !strings.Contains(err.Error(), "already terminal before agent.primary completion projection") {
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
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 11, 1, 32, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
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
	projection := temporalStepProjection{
		ActivityAttempt:    1,
		ActivityID:         "activity-agent-primary",
		ActivityType:       temporalruntime.ExecutePrimaryAgentActivityName,
		Attempt:            1,
		Tool:               "",
		CompletedAt:        now.Add(4 * time.Second),
		DurationMS:         2000,
		ModelName:          "test-model",
		ModelProvider:      "test-provider",
		Payload:            map[string]any{"provider_response": "stable"},
		ProjectionRef:      temporalProjectionRef(run.RunID, "agent/primary/result"),
		ProviderRequestRef: "provider-request-stable",
		ProviderResponseID: "provider-response-stable",
		ResultKind:         "agent_final_output",
		Run:                run,
		ScheduledAt:        now.Add(time.Second),
		ScheduleToStartMS:  1000,
		StartedAt:          now.Add(2 * time.Second),
		Status:             "completed",
		StepID:             "agent.primary",
		StepKind:           "agent",
		TaskQueue:          temporalruntime.ActivityTaskQueueAgent,
		TemporalRunID:      "temporal-run-step-terminal-replay",
		UpdatedAt:          now.Add(4 * time.Second),
		WorkerID:           "worker-1",
		WorkflowID:         "campus-agent.chat.run-step-terminal-replay",
	}
	if err := server.projectTemporalStep(context.Background(), projection); err != nil {
		t.Fatalf("project terminal step: %v", err)
	}
	if err := server.projectTemporalStep(context.Background(), projection); err != nil {
		t.Fatalf("replay equivalent terminal step: %v", err)
	}

	steps, err := store.ListRunSteps(context.Background(), run.RunID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "completed" || steps[0].ActivityAttempt != 1 {
		t.Fatalf("steps = %#v, want one completed attempt-1 step", steps)
	}
	attempts, err := store.ListStepAttempts(context.Background(), run.RunID)
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 1 || attempts[0].Status != "completed" || attempts[0].ActivityAttempt != 1 {
		t.Fatalf("attempts = %#v, want one completed attempt-1 projection", attempts)
	}
	results, err := store.ListStepResults(context.Background(), run.RunID)
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 1 || results[0].Status != "completed" {
		t.Fatalf("results = %#v, want one completed result", results)
	}
}

func TestProjectTemporalStepAllowsHigherActivityAttemptToReplaceTerminalStep(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 6, 11, 2, 2, 3, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
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
	base := temporalStepProjection{
		ActivityAttempt: 1,
		Attempt:         1,
		Run:             run,
		Status:          "failed",
		StepID:          "agent.primary",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		StartedAt:       now.Add(2 * time.Second),
		CompletedAt:     now.Add(3 * time.Second),
		UpdatedAt:       now.Add(3 * time.Second),
		Payload:         map[string]any{"terminal_reason": "provider_timeout"},
	}
	if err := server.projectTemporalStep(context.Background(), base); err != nil {
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
	base.ProjectionRef = temporalProjectionRef(run.RunID, "agent/primary/result")
	if err := server.projectTemporalStep(context.Background(), base); err != nil {
		t.Fatalf("project attempt 2 completion: %v", err)
	}
	steps, err := store.ListRunSteps(context.Background(), run.RunID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "completed" {
		t.Fatalf("steps = %#v, want attempt 2 completion", steps)
	}
	attempts, err := store.ListStepAttempts(context.Background(), run.RunID)
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
	if err := server.projectTemporalStep(context.Background(), base); err == nil {
		t.Fatal("stale attempt 1 completion should be rejected")
	}
	steps, err = store.ListRunSteps(context.Background(), run.RunID)
	if err != nil {
		t.Fatalf("list steps after stale completion: %v", err)
	}
	if len(steps) != 1 || steps[0].Status != "completed" ||
		steps[0].SanitizedPayload["provider_response"] != "retry-success" {
		t.Fatalf("steps = %#v, want attempt 2 aggregate after stale attempt 1", steps)
	}
}

func TestProjectTemporalStepPreservesCancellationFinalizerTerminalProjection(t *testing.T) {
	store := execution.NewInMemoryRunProjectionStore()
	server := newServerForTest()
	attachRunProjectionStoreForHandlerTest(server, store)
	now := time.Date(2026, 7, 23, 6, 0, 0, 0, time.UTC)
	createHTTPAPIQueuedDurableRunForTest(
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
	started := temporalStepProjection{
		ActivityAttempt: 1,
		Attempt:         1,
		Run:             run,
		Status:          "started",
		StepID:          "agent.primary",
		StepKind:        "agent",
		TaskQueue:       temporalruntime.ActivityTaskQueueAgent,
		StartedAt:       now.Add(time.Second),
		UpdatedAt:       now.Add(time.Second),
		Payload:         map[string]any{"marker": "started"},
	}
	if err := server.projectTemporalStep(context.Background(), started); err != nil {
		t.Fatalf("project started step: %v", err)
	}
	canceledAt := now.Add(2 * time.Second)
	if err := server.projectCanceledRunSteps(
		context.Background(),
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
	lateFailure.ProjectionRef = temporalProjectionRef(run.RunID, "agent/primary/result")
	lateFailure.Payload = map[string]any{"marker": "late-failure"}
	if err := server.projectTemporalStep(context.Background(), lateFailure); !errors.Is(err, execution.ErrStaleRunStepProjection) {
		t.Fatalf("late failure error = %v, want ErrStaleRunStepProjection", err)
	}
	steps, err := store.ListRunSteps(context.Background(), run.RunID)
	if err != nil || len(steps) != 1 {
		t.Fatalf("steps = %#v, error = %v", steps, err)
	}
	if steps[0].Status != "canceled" || steps[0].SanitizedPayload["cancel_reason"] != "user_requested" {
		t.Fatalf("step = %#v, want cancellation finalizer projection", steps[0])
	}
	attempts, err := store.ListStepAttempts(context.Background(), run.RunID)
	if err != nil || len(attempts) != 1 {
		t.Fatalf("attempts = %#v, error = %v", attempts, err)
	}
	if attempts[0].Status != "canceled" ||
		attempts[0].CancelOutcome != execution.CancelOutcomeActivityContextCanceled {
		t.Fatalf("attempt = %#v, want cancellation finalizer projection", attempts[0])
	}
	results, err := store.ListStepResults(context.Background(), run.RunID)
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("late failure wrote results: %#v", results)
	}
}

type traceCollectorForTest struct {
	server *httptest.Server
	mu     sync.Mutex
	spans  []*traceproto.Span
}

func newTraceCollectorForTest(t *testing.T) *traceCollectorForTest {
	t.Helper()
	collector := &traceCollectorForTest{}
	collector.server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/traces" {
			http.NotFound(response, request)
			return
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			http.Error(response, "read body failed", http.StatusBadRequest)
			return
		}
		var payload tracecollector.ExportTraceServiceRequest
		if err := proto.Unmarshal(body, &payload); err != nil {
			http.Error(response, "decode traces failed", http.StatusBadRequest)
			return
		}
		collector.mu.Lock()
		for _, resourceSpan := range payload.GetResourceSpans() {
			for _, scopeSpan := range resourceSpan.GetScopeSpans() {
				collector.spans = append(collector.spans, scopeSpan.GetSpans()...)
			}
		}
		collector.mu.Unlock()
		response.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(collector.server.Close)
	return collector
}

func (collector *traceCollectorForTest) URL() string {
	return collector.server.URL
}

func (collector *traceCollectorForTest) findSpan(t *testing.T, name string) *traceproto.Span {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		collector.mu.Lock()
		for _, span := range collector.spans {
			if span.GetName() == name {
				collector.mu.Unlock()
				return span
			}
		}
		collector.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	collector.mu.Lock()
	defer collector.mu.Unlock()
	names := make([]string, 0, len(collector.spans))
	for _, span := range collector.spans {
		names = append(names, span.GetName())
	}
	t.Fatalf("span %q not exported; got spans %v", name, names)
	return nil
}

func otlpSpanAttributes(span *traceproto.Span) map[string]string {
	attrs := map[string]string{}
	for _, attr := range span.GetAttributes() {
		attrs[attr.GetKey()] = otlpValueString(attr.GetValue())
	}
	return attrs
}

func otlpValueString(value *commonproto.AnyValue) string {
	if value == nil {
		return ""
	}
	switch typed := value.GetValue().(type) {
	case *commonproto.AnyValue_StringValue:
		return typed.StringValue
	case *commonproto.AnyValue_IntValue:
		return fmt.Sprint(typed.IntValue)
	case *commonproto.AnyValue_DoubleValue:
		return fmt.Sprint(typed.DoubleValue)
	case *commonproto.AnyValue_BoolValue:
		return fmt.Sprint(typed.BoolValue)
	default:
		return value.String()
	}
}
