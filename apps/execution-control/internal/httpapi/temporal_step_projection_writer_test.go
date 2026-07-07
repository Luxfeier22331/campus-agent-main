package httpapi

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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
		RAGSelectedEvidenceMax:       8,
		RAGTopKMax:                   8,
		RuntimeRelease:               "execution-control@langfuse-test",
	})
	t.Cleanup(func() {
		if err := server.Shutdown(context.Background()); err != nil {
			t.Fatalf("close server: %v", err)
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
		ragHandoffForDurableWorkerTest("理学院有什么专业"),
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
		Tool:              "knowledge_query",
		CompletedAt:       now.Add(14 * time.Second),
		DurationMS:        2100,
		FailCloseReason:   "grounding_low_confidence",
		Payload:           map[string]any{"selected_tool": "knowledge_query"},
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

	span := collector.findSpan(t, "execution_control.temporal.step_observation")
	attrs := otlpSpanAttributes(span)
	expected := map[string]string{
		"activity_attempt":       "3",
		"activity_type":          temporalruntime.WriteFinalizationActivityName,
		"deployment.environment": "staging",
		"duration_ms":            "2100",
		"fail_close_reason":      "grounding_low_confidence",
		"langfuse.release":       "execution-control@langfuse-test",
		"langfuse.session.id":    "conv-langfuse-step",
		"langfuse.trace.name":    "online-answer",
		"langfuse.user.id":       "user-executor",
		"projection_ref":         temporalProjectionRef(run.RunID, "finalization/write"),
		"request_id":             "req-executor-001",
		"run_id":                 "run-langfuse-step",
		"schedule_to_start_ms":   "900",
		"selected_tool":          "knowledge_query",
		"status":                 "completed",
		"step_id":                "finalization.write",
		"step_kind":              "finalization",
		"task_queue":             temporalruntime.ActivityTaskQueueCore,
		"trace_id":               "trace-executor-001",
		"workflow_id":            "campus-agent.chat.run-langfuse-step",
	}
	for key, want := range expected {
		if attrs[key] != want {
			t.Fatalf("span attribute %s = %q, want %q; attrs=%#v", key, attrs[key], want, attrs)
		}
	}
}

func TestTemporalStepObservationEventLeavesMissingSelectedToolEmpty(t *testing.T) {
	event := temporalStepObservationEvent(temporalStepProjection{
		Tool:    "knowledge_query",
		Payload: map[string]any{},
		Run: execution.DurableRun{
			RunID:        "run-observation-missing-tool",
			SelectedTool: "knowledge_query",
		},
		StepID: "memory.recall",
	})

	if event.SelectedTool != "" {
		t.Fatalf("selected tool = %q, want empty", event.SelectedTool)
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
		ragHandoffForDurableWorkerTest("hello"),
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
		StepID:               "synthesis",
		RunID:                "run-step-terminal-late",
		ConversationID:       "conv-step-terminal-late",
		StepKind:             "synthesis",
		Tool:                 "knowledge_query",
		Status:               "failed",
		TaskQueue:            temporalruntime.ActivityTaskQueueKnowledge,
		WorkerID:             "worker-1",
		StartedAt:            now.Add(2 * time.Second),
		CompletedAt:          now.Add(3 * time.Second),
		UpdatedAt:            now.Add(3 * time.Second),
		PayloadSchemaVersion: "run-step-projection-v1",
		SanitizedPayload:     map[string]any{"terminal_reason": "provider_timeout"},
	}); err != nil {
		t.Fatalf("seed terminal step: %v", err)
	}
	run, err := store.GetRun(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}

	err = server.projectTemporalStep(context.Background(), temporalStepProjection{
		Attempt:       2,
		Tool:          "knowledge_query",
		Run:           run,
		Status:        "completed",
		StepID:        "synthesis",
		StepKind:      "synthesis",
		TaskQueue:     temporalruntime.ActivityTaskQueueKnowledge,
		WorkerID:      "worker-1",
		StartedAt:     now.Add(4 * time.Second),
		CompletedAt:   now.Add(5 * time.Second),
		UpdatedAt:     now.Add(5 * time.Second),
		ResultKind:    "provider_execution_summary",
		ProjectionRef: temporalProjectionRef(run.RunID, "synthesis/provider"),
		Payload:       map[string]any{"provider_response": "late"},
	})
	if err == nil || !strings.Contains(err.Error(), "already terminal before synthesis completion projection") {
		t.Fatalf("late completion error = %v", err)
	}

	attempts, err := store.ListStepAttempts(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list attempts: %v", err)
	}
	if len(attempts) != 1 {
		t.Fatalf("attempt count = %d, want late completion evidence only: %#v", len(attempts), attempts)
	}
	if attempts[0].Status != "blocked" ||
		attempts[0].LateCompletionOutcome != execution.LateCompletionOutcomeIgnoredAfterTerminalProjection ||
		attempts[0].TerminalReason != "late_completion_ignored" {
		t.Fatalf("late attempt = %#v, want ignored terminal step evidence", attempts[0])
	}
	results, err := store.ListStepResults(context.Background(), "run-step-terminal-late")
	if err != nil {
		t.Fatalf("list results: %v", err)
	}
	if len(results) != 0 {
		t.Fatalf("late terminal step completion wrote results: %#v", results)
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
