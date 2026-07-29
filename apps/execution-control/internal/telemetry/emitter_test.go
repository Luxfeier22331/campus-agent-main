package telemetry

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestEmitterDisabledNoops(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{}, nil)

	if err := emitter.Emit(context.Background(), Event{
		Name:      "answer.accepted",
		RequestID: "req-001",
		TraceID:   "trace-001",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	status := emitter.Status()
	if status.Enabled {
		t.Fatal("enabled = true, want false")
	}
	if status.DroppedCount != 0 {
		t.Fatalf("dropped count = %d, want 0", status.DroppedCount)
	}
}

func TestEmitterEnabledWithoutEndpointFailsClosed(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{
		OTelEnabled: true,
	}, nil)

	err := emitter.Emit(context.Background(), Event{
		Name:      "answer.accepted",
		RequestID: "req-001",
		TraceID:   "trace-001",
	})
	if !errors.Is(err, ErrTelemetryUnavailable) {
		t.Fatalf("error = %v, want ErrTelemetryUnavailable", err)
	}

	status := emitter.Status()
	if !status.Enabled {
		t.Fatal("enabled = false, want true")
	}
	if status.ExporterConfigured {
		t.Fatal("exporter configured = true, want false")
	}
	if status.LastError == "" {
		t.Fatal("last error should be populated")
	}
	if status.FailedCount == 0 {
		t.Fatalf("failed count = %d, want non-zero", status.FailedCount)
	}
	if status.DroppedCount != 0 {
		t.Fatalf("dropped count = %d, want 0", status.DroppedCount)
	}
}

func TestEmitterStatusRedactsTransportErrorDetails(t *testing.T) {
	emitter := &Emitter{
		enabled:   true,
		lastError: "Post https://otel.example.test/v1/traces?token=secret-token: dial tcp 127.0.0.1:4318: connect: connection refused",
	}

	status := emitter.Status()

	if status.LastError != "telemetry exporter error" {
		t.Fatalf("last error = %q", status.LastError)
	}
	for _, secret := range []string{"secret-token", "127.0.0.1:4318", "otel.example.test"} {
		if strings.Contains(status.LastError, secret) {
			t.Fatalf("last error leaked %q: %s", secret, status.LastError)
		}
	}
}

func TestEmitterUnavailableLogUsesExecutionControlEventName(t *testing.T) {
	var logBuffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logBuffer, nil))

	_ = NewEmitter(context.Background(), config.Config{
		OTelEnabled: true,
	}, logger)

	logged := logBuffer.String()
	if !strings.Contains(logged, "execution_control.telemetry_unavailable") {
		t.Fatalf("log output = %q, want execution_control.telemetry_unavailable", logged)
	}
	staleNamespace := "go_" + "shell."
	if strings.Contains(logged, staleNamespace) {
		t.Fatalf("log output = %q, must not contain stale namespace", logged)
	}
}

func TestEmitterSpanUsesExecutionControlNamespace(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1.0,
		tracer:      provider.Tracer("test"),
	}

	if err := emitter.Emit(context.Background(), Event{
		Name:     "answer.accepted",
		Duration: 15 * time.Millisecond,
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	if spans[0].Name() != "execution_control.runtime.request.accepted" {
		t.Fatalf("span name = %q, want execution_control.runtime.request.accepted", spans[0].Name())
	}
}

func TestEmitterPreservesIncomingTraceParent(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1,
		tracer:      provider.Tracer("test"),
	}
	ctx := ExtractIncomingContext(
		context.Background(),
		map[string][]string{
			"traceparent": {"00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"},
		},
	)

	if err := emitter.Emit(ctx, Event{Name: "agent.primary.started"}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	if spans[0].SpanContext().TraceID().String() != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Fatalf("trace id = %s, want propagated trace id", spans[0].SpanContext().TraceID())
	}
	if spans[0].Parent().SpanID().String() != "00f067aa0ba902b7" {
		t.Fatalf("parent span id = %s, want propagated parent", spans[0].Parent().SpanID())
	}
}

func TestEmitterSamplesOutEvents(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 0,
		tracer:      provider.Tracer("test"),
	}

	if err := emitter.Emit(context.Background(), Event{
		Name:      "answer.accepted",
		RequestID: "req-sampled-out",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	if len(recorder.Ended()) != 0 {
		t.Fatalf("ended spans = %d, want 0", len(recorder.Ended()))
	}
	status := emitter.Status()
	if status.DroppedCount != 1 {
		t.Fatalf("dropped count = %d, want 1", status.DroppedCount)
	}
}

func TestEmitterUsesAllowlistedAttributesOnly(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{enabled: true, sampleRatio: 1, tracer: provider.Tracer("test")}

	if err := emitter.Emit(context.Background(), Event{
		ActivityAttempt:       2,
		ActivityType:          "ExecutePrimaryAgentActivity",
		ConversationID:        "conv-attrs",
		DeploymentEnvironment: "staging",
		Duration:              50 * time.Millisecond,
		FailCloseReason:       "agent_runtime_timeout",
		FailureKind:           "agent_runtime_timeout",
		Name:                  "answer.failed",
		ProjectionRef:         "projection://runs/run-attrs/agent/primary/result",
		Release:               "release-attrs",
		RequestID:             "req-attrs",
		RunID:                 "run-attrs",
		ScheduleToStart:       7 * time.Millisecond,
		ToolName:              "personal_memory_recall",
		Status:                "failed",
		StepID:                "agent.primary",
		StepKind:              "agent",
		TaskQueue:             "campus-agent.activity.agent",
		TraceID:               "trace-attrs",
		UserID:                "user-attrs",
		WorkflowID:            "campus-agent.chat.run-attrs",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	allowed := map[string]bool{
		"activity_attempt":                     true,
		"activity_type":                        true,
		"deployment.environment":               true,
		"duration_ms":                          true,
		"fail_close_reason":                    true,
		"failure_kind":                         true,
		"langfuse.release":                     true,
		"langfuse.observation.type":            true,
		"langfuse.session.id":                  true,
		"langfuse.trace.metadata.request_id":   true,
		"langfuse.trace.metadata.run_id":       true,
		"langfuse.trace.metadata.trace_id":     true,
		"langfuse.trace.metadata.workflow_id":  true,
		"langfuse.trace.name":                  true,
		"langfuse.trace.tags":                  true,
		"langfuse.user.id":                     true,
		"projection_ref":                       true,
		"request_id":                           true,
		"run_id":                               true,
		"schedule_to_start_ms":                 true,
		"tool_name":                            true,
		"status":                               true,
		"step_id":                              true,
		"step_kind":                            true,
		"task_queue":                           true,
		"telemetry.allowed_attributes_version": true,
		"trace_id":                             true,
		"workflow_id":                          true,
	}
	found := map[string]string{}
	for _, attr := range spans[0].Attributes() {
		if !allowed[string(attr.Key)] {
			t.Fatalf("unexpected telemetry attribute %q", attr.Key)
		}
		found[string(attr.Key)] = attr.Value.AsString()
	}
	for key, want := range map[string]string{
		"activity_type":             "ExecutePrimaryAgentActivity",
		"fail_close_reason":         "agent_runtime_timeout",
		"failure_kind":              "agent_runtime_timeout",
		"projection_ref":            "projection://runs/run-attrs/agent/primary/result",
		"run_id":                    "run-attrs",
		"status":                    "failed",
		"step_id":                   "agent.primary",
		"step_kind":                 "agent",
		"task_queue":                "campus-agent.activity.agent",
		"workflow_id":               "campus-agent.chat.run-attrs",
		"langfuse.observation.type": "span",
	} {
		if found[key] != want {
			t.Fatalf("telemetry attribute %s = %q, want %q", key, found[key], want)
		}
	}
	if status := emitter.Status(); status.SubmittedCount != 1 {
		t.Fatalf("submitted count = %d, want 1", status.SubmittedCount)
	}
}

func TestEmitterDoesNotDuplicateAgentModelGeneration(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1,
		tracer:      provider.Tracer("test"),
	}

	if err := emitter.Emit(context.Background(), Event{
		Name:                  "temporal.step_observation",
		DeploymentEnvironment: "local",
		ModelName:             "gpt-5.5",
		ModelProvider:         "openai",
		InputTokens:           7282,
		OutputTokens:          817,
		CachedInputTokens:     12,
		RequestID:             "req-usage",
		RunID:                 "run-usage",
		StepID:                "agent.primary",
		TraceID:               "trace-usage",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	found := map[string]bool{}
	for _, attr := range spans[0].Attributes() {
		found[string(attr.Key)] = true
	}
	for _, key := range []string{
		"langfuse.observation.model.name",
		"langfuse.observation.usage_details",
		"langfuse.observation.cost_details",
	} {
		if found[key] {
			t.Fatalf("orchestration span must not publish model generation attribute %q", key)
		}
	}
	if got := spans[0].Attributes(); len(got) == 0 {
		t.Fatal("orchestration span must include its observation type")
	}
	for _, attr := range spans[0].Attributes() {
		if attr.Key == "langfuse.observation.type" && attr.Value.AsString() != "span" {
			t.Fatalf("observation type = %q, want span", attr.Value.AsString())
		}
	}
}

func TestEmitterAddsGroundingSummaryWithoutGenerationUsage(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{enabled: true, sampleRatio: 1, tracer: provider.Tracer("test")}
	startedAt := time.Date(2026, 7, 26, 9, 0, 0, 0, time.UTC)
	completedAt := startedAt.Add(2750 * time.Millisecond)

	if err := emitter.Emit(context.Background(), Event{
		Name:                          "temporal.step_observation",
		GroundingMode:                 "multi_scope",
		GroundingStatus:               "ready",
		GroundingSelectedScopes:       []string{"student_rules", "curriculum"},
		GroundingCoveredScopes:        []string{"student_rules"},
		GroundingCandidateCount:       6,
		GroundingCandidateCountSet:    true,
		GroundingEvidenceCount:        2,
		GroundingEvidenceCountSet:     true,
		GroundingTokenCount:           512,
		GroundingTokenCountSet:        true,
		GroundingModelContextChars:    2048,
		GroundingModelContextCharsSet: true,
		GroundingEmbeddingMS:          11.5,
		GroundingEmbeddingMSSet:       true,
		GroundingSearchMS:             12,
		GroundingSearchMSSet:          true,
		GroundingRerankMS:             13.25,
		GroundingRerankMSSet:          true,
		GroundingPackMS:               14,
		GroundingPackMSSet:            true,
		StartedAt:                     startedAt,
		CompletedAt:                   completedAt,
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	span := spans[0]
	if !span.StartTime().Equal(startedAt) || !span.EndTime().Equal(completedAt) {
		t.Fatalf("span timestamps = %s..%s, want %s..%s", span.StartTime(), span.EndTime(), startedAt, completedAt)
	}
	attrs := map[attribute.Key]attribute.Value{}
	for _, item := range span.Attributes() {
		attrs[item.Key] = item.Value
	}
	if attrs[attribute.Key("langfuse.observation.type")].AsString() != "span" {
		t.Fatalf("observation type = %q, want span", attrs[attribute.Key("langfuse.observation.type")].AsString())
	}
	if attrs[attribute.Key("grounding_mode")].AsString() != "multi_scope" ||
		attrs[attribute.Key("grounding_status")].AsString() != "ready" {
		t.Fatalf("grounding routing attrs = %#v", attrs)
	}
	if got := attrs[attribute.Key("grounding_selected_scopes")].AsStringSlice(); !reflect.DeepEqual(got, []string{"student_rules", "curriculum"}) {
		t.Fatalf("selected scopes = %#v", got)
	}
	if got := attrs[attribute.Key("grounding_candidate_count")].AsInt64(); got != 6 {
		t.Fatalf("candidate count = %d, want 6", got)
	}
	if got := attrs[attribute.Key("grounding.embedding_ms")].AsFloat64(); got != 11.5 {
		t.Fatalf("embedding ms = %v, want 11.5", got)
	}
	for _, key := range []attribute.Key{
		"langfuse.observation.model.name",
		"langfuse.observation.usage_details",
		"langfuse.observation.cost_details",
	} {
		if _, exists := attrs[key]; exists {
			t.Fatalf("grounding span must not publish generation attribute %q", key)
		}
	}
}

func TestEmitterOmitsUnavailableGroundingDiagnostics(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{enabled: true, sampleRatio: 1, tracer: provider.Tracer("test")}

	if err := emitter.Emit(context.Background(), Event{
		GroundingMode:   "multi_scope",
		GroundingStatus: "ready",
		Name:            "temporal.step_observation",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}
	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	for _, attr := range spans[0].Attributes() {
		switch string(attr.Key) {
		case "grounding_candidate_count", "grounding_evidence_count", "grounding_token_count", "grounding_model_context_chars", "grounding.embedding_ms", "grounding.search_ms", "grounding.rerank_ms", "grounding.pack_ms":
			t.Fatalf("unavailable grounding diagnostic %q was emitted as zero", attr.Key)
		}
	}
}

func TestEmitterAddsLangfuseTraceSessionAttributes(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	emitter := &Emitter{
		enabled:        true,
		sampleRatio:    1,
		tracer:         provider.Tracer("test"),
		allowedVersion: "execution-control-otel-attrs-v1",
	}

	if err := emitter.Emit(context.Background(), Event{
		Name:                  "answer.completed",
		ConversationID:        "conv-langfuse-001",
		UserID:                "user-langfuse-001",
		Release:               "release-2026-06-18",
		RequestID:             "req-langfuse-001",
		RunID:                 "run-langfuse-001",
		TraceID:               "trace-langfuse-001",
		ToolName:              "personal_memory_recall",
		DeploymentEnvironment: "staging",
		WorkflowID:            "campus-agent.chat.run-langfuse-001",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	found := map[string]string{}
	var tags []string
	for _, attr := range spans[0].Attributes() {
		if attr.Key == "langfuse.trace.tags" {
			tags = attr.Value.AsStringSlice()
			continue
		}
		found[string(attr.Key)] = attr.Value.AsString()
	}
	expectedValues := map[string]string{
		"langfuse.trace.name":                 "online-answer",
		"langfuse.session.id":                 "conv-langfuse-001",
		"langfuse.user.id":                    "user-langfuse-001",
		"langfuse.release":                    "release-2026-06-18",
		"langfuse.trace.metadata.request_id":  "req-langfuse-001",
		"langfuse.trace.metadata.run_id":      "run-langfuse-001",
		"langfuse.trace.metadata.trace_id":    "trace-langfuse-001",
		"langfuse.trace.metadata.workflow_id": "campus-agent.chat.run-langfuse-001",
		"request_id":                          "req-langfuse-001",
		"run_id":                              "run-langfuse-001",
		"trace_id":                            "trace-langfuse-001",
		"tool_name":                           "personal_memory_recall",
		"deployment.environment":              "staging",
	}
	for key, want := range expectedValues {
		if found[key] != want {
			t.Fatalf("telemetry attribute %s = %q, want %q", key, found[key], want)
		}
	}
	wantTags := []string{"surface:execution-control", "tool:personal_memory_recall", "env:staging"}
	if !reflect.DeepEqual(tags, wantTags) {
		t.Fatalf("langfuse trace tags = %#v, want %#v", tags, wantTags)
	}
}

func TestEmitterEnabledWithMetricsRequiresMetricsEndpoint(t *testing.T) {
	emitter := NewEmitter(context.Background(), config.Config{
		OTelEnabled:        true,
		OTelEndpoint:       "http://collector:4318/v1/traces",
		OTelMetricsEnabled: true,
	}, nil)

	status := emitter.Status()
	if !status.Enabled {
		t.Fatal("enabled = false, want true")
	}
	if status.MetricsExporterConfigured {
		t.Fatal("metrics exporter configured = true, want false")
	}
	if status.LastError == "" {
		t.Fatal("last error should be populated")
	}
}

func TestEmitterRecordsBoundedRuntimeMetrics(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	emitter := &Emitter{
		meter: provider.Meter("test"),
	}
	emitter.configureMetrics()

	emitter.recordMetric(Event{
		ActivityType:    "ExecutePrimaryAgentActivity",
		Duration:        25 * time.Millisecond,
		FailureKind:     "none",
		Name:            "temporal.step_observation",
		ScheduleToStart: 18 * time.Millisecond,
		ToolName:        "personal_memory_recall",
		Status:          "completed",
		StepKind:        "agent",
		TaskQueue:       "campus-agent.activity.agent",
	})
	emitter.RecordPersonalMemoryOperation(context.Background(), "recall", "completed", "none", 12*time.Millisecond, 2, 320)
	emitter.RecordPersonalMemoryReceipt(context.Background(), "owner_erase", "succeeded", "finalized")

	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect metrics: %v", err)
	}

	metricNames := map[string]bool{}
	for _, scope := range rm.ScopeMetrics {
		for _, item := range scope.Metrics {
			metricNames[item.Name] = true
			assertMetricAttributesAreBounded(t, item)
		}
	}
	for _, name := range []string{
		"campus.execution_control.runtime_requests",
		"campus.execution_control.activity_duration_ms",
		"campus.execution_control.schedule_to_start_ms",
		"campus.execution_control.personal_memory.operations",
		"campus.execution_control.personal_memory.duration_ms",
		"campus.execution_control.personal_memory.selected_items",
		"campus.execution_control.personal_memory.selected_chars",
		"campus.execution_control.personal_memory.command_receipts",
	} {
		if !metricNames[name] {
			t.Fatalf("metric %s missing from %#v", name, metricNames)
		}
	}
}

func assertMetricAttributesAreBounded(t *testing.T, metric metricdata.Metrics) {
	t.Helper()
	allowed := map[string]bool{
		"activity_type": true,
		"command_kind":  true,
		"failure_kind":  true,
		"operation":     true,
		"outcome":       true,
		"tool_name":     true,
		"status":        true,
		"step_kind":     true,
		"task_queue":    true,
	}
	for _, attrs := range metricAttributeSets(metric) {
		for _, attr := range attrs.ToSlice() {
			if !allowed[string(attr.Key)] {
				t.Fatalf("metric %s has unbounded or unsupported attribute %q", metric.Name, attr.Key)
			}
		}
	}
}

func metricAttributeSets(metric metricdata.Metrics) []attributeSet {
	switch data := metric.Data.(type) {
	case metricdata.Sum[int64]:
		output := make([]attributeSet, 0, len(data.DataPoints))
		for _, point := range data.DataPoints {
			output = append(output, &point.Attributes)
		}
		return output
	case metricdata.Histogram[float64]:
		output := make([]attributeSet, 0, len(data.DataPoints))
		for _, point := range data.DataPoints {
			output = append(output, &point.Attributes)
		}
		return output
	case metricdata.Histogram[int64]:
		output := make([]attributeSet, 0, len(data.DataPoints))
		for _, point := range data.DataPoints {
			output = append(output, &point.Attributes)
		}
		return output
	default:
		return nil
	}
}

type attributeSet interface {
	ToSlice() []attribute.KeyValue
}
