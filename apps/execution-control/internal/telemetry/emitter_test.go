package telemetry

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
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
	emitter := &Emitter{
		enabled:     true,
		sampleRatio: 1,
		tracer:      provider.Tracer("test"),
	}

	if err := emitter.Emit(context.Background(), Event{
		ActivityDuration:      25 * time.Millisecond,
		ContextPreflightState: "not_follow_up",
		CanonicalIndexTruth:   "true",
		CandidateCount:        3,
		Collection:            "student_rules",
		Decision:              "admitted_immediate",
		ActivityAttempt:       2,
		ActivityType:          "WriteFinalization",
		Duration:              50 * time.Millisecond,
		FailureCode:           "timeout",
		CancelDeliveryStatus:  "accepted",
		Name:                  "answer.failed",
		Outcome:               "execution_timeout",
		PlanID:                "rag:regulations:student_rules:historical",
		PlanningOutcome:       "not_preplanned",
		PolicyGateDecision:    "out_of_scope",
		ProjectionRef:         "projection://runs/run-attrs/finalization/write",
		QueueWait:             5 * time.Millisecond,
		ScheduleToStart:       7 * time.Millisecond,
		QueryMode:             "historical",
		ReferenceCount:        2,
		RetrievalMode:         "indexed",
		RequestID:             "req-attrs",
		RequestedTool:         "knowledge_query",
		RunID:                 "run-attrs",
		RoutingNextAction:     "out_of_scope",
		ScopeGateDecision:     "out_of_scope",
		Corpus:                "regulations",
		Status:                "completed",
		StepID:                "retrieval.indexed_lookup",
		StepKind:              "retrieval",
		TaskQueue:             "campus.execution.activity.finalization",
		TerminalOutcome:       "no_answer",
		TerminalState:         "failed_closed",
		FailCloseReason:       "product_scope_boundary",
		StatusCode:            504,
		TargetVersionIDsCount: 1,
		TraceID:               "trace-attrs",
		WorkflowID:            "campus-agent.chat.run-attrs",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	attrs := spans[0].Attributes()
	allowed := map[string]bool{
		"activity_duration_ms":                  true,
		"cancel_delivery_status":                true,
		"context_preflight_state":               true,
		"canonical_index_truth":                 true,
		"candidate_count":                       true,
		"scope.collection":                      true,
		"scope.corpus":                          true,
		"decision":                              true,
		"activity_attempt":                      true,
		"activity_type":                         true,
		"duration_ms":                           true,
		"failure_code":                          true,
		"failure_kind":                          true,
		"langfuse.trace.name":                   true,
		"langfuse.session.id":                   true,
		"langfuse.user.id":                      true,
		"langfuse.release":                      true,
		"langfuse.trace.tags":                   true,
		"langfuse.observation.type":             true,
		"langfuse.observation.model.name":       true,
		"langfuse.observation.usage_details":    true,
		"langfuse.observation.cost_details":     true,
		"langfuse.observation.metadata.step_id": true,
		"deployment.environment":                true,
		"outcome":                               true,
		"plan_id":                               true,
		"planning_outcome":                      true,
		"policy_gate_decision":                  true,
		"projection_ref":                        true,
		"queue_wait_ms":                         true,
		"schedule_to_start_ms":                  true,
		"latency_ms":                            true,
		"query_sha256":                          true,
		"query_mode":                            true,
		"reference_count":                       true,
		"retrieval_mode":                        true,
		"request_id":                            true,
		"requested_tool":                        true,
		"run_id":                                true,
		"routing_next_action":                   true,
		"selected_tool":                         true,
		"scope_gate_decision":                   true,
		"status":                                true,
		"step_id":                               true,
		"step_kind":                             true,
		"task_queue":                            true,
		"terminal_outcome":                      true,
		"terminal_state":                        true,
		"fail_close_reason":                     true,
		"status_code":                           true,
		"target_version_ids_count":              true,
		"target_document_ids_count":             true,
		"telemetry.allowed_attributes_version":  true,
		"trace_id":                              true,
		"workflow_id":                           true,
	}
	found := map[string]string{}
	for _, attr := range attrs {
		if !allowed[string(attr.Key)] {
			t.Fatalf("unexpected telemetry attribute %q", attr.Key)
		}
		found[string(attr.Key)] = attr.Value.AsString()
	}
	expectedValues := map[string]string{
		"scope_gate_decision":     "out_of_scope",
		"policy_gate_decision":    "out_of_scope",
		"context_preflight_state": "not_follow_up",
		"routing_next_action":     "out_of_scope",
		"planning_outcome":        "not_preplanned",
		"plan_id":                 "rag:regulations:student_rules:historical",
		"run_id":                  "run-attrs",
		"terminal_outcome":        "no_answer",
		"terminal_state":          "failed_closed",
		"step_id":                 "retrieval.indexed_lookup",
		"fail_close_reason":       "product_scope_boundary",
		"cancel_delivery_status":  "accepted",
		"activity_type":           "WriteFinalization",
		"projection_ref":          "projection://runs/run-attrs/finalization/write",
		"status":                  "completed",
		"step_kind":               "retrieval",
		"task_queue":              "campus.execution.activity.finalization",
		"workflow_id":             "campus-agent.chat.run-attrs",
	}
	for key, want := range expectedValues {
		if found[key] != want {
			t.Fatalf("telemetry attribute %s = %q, want %q", key, found[key], want)
		}
	}
	status := emitter.Status()
	if status.ExportedCount != 1 {
		t.Fatalf("exported count = %d, want 1", status.ExportedCount)
	}
}

func TestEmitterAddsLangfuseGenerationUsageForBillableModelStep(t *testing.T) {
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
		EstimatedCostMicroUSD: 60920,
		RequestID:             "req-usage",
		RunID:                 "run-usage",
		StepID:                "synthesis",
		TraceID:               "trace-usage",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	found := map[string]string{}
	for _, attr := range spans[0].Attributes() {
		found[string(attr.Key)] = attr.Value.AsString()
	}
	if found["langfuse.observation.type"] != "generation" {
		t.Fatalf("observation type = %q, want generation", found["langfuse.observation.type"])
	}
	if found["langfuse.observation.model.name"] != "gpt-5.5" {
		t.Fatalf("model name = %q, want gpt-5.5", found["langfuse.observation.model.name"])
	}
	if found["langfuse.observation.usage_details"] != `{"cache_read_input_tokens":12,"input":7282,"output":817}` {
		t.Fatalf("usage details = %q", found["langfuse.observation.usage_details"])
	}
	if found["langfuse.observation.cost_details"] != `{"total":0.06092}` {
		t.Fatalf("cost details = %q", found["langfuse.observation.cost_details"])
	}
	if found["langfuse.observation.metadata.step_id"] != "synthesis" {
		t.Fatalf("metadata step id = %q, want synthesis", found["langfuse.observation.metadata.step_id"])
	}
}

func TestEmitterPinsLangfuseGenerationCostToZeroWhenRuntimeCostIsZero(t *testing.T) {
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
		InputTokens:           11285,
		OutputTokens:          617,
		CachedInputTokens:     6656,
		EstimatedCostMicroUSD: 0,
		RequestID:             "req-zero-cost",
		RunID:                 "run-zero-cost",
		StepID:                "agent.primary",
		TraceID:               "trace-zero-cost",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	found := map[string]string{}
	for _, attr := range spans[0].Attributes() {
		found[string(attr.Key)] = attr.Value.AsString()
	}
	if found["langfuse.observation.cost_details"] != `{"total":0}` {
		t.Fatalf("cost details = %q, want zero-cost override", found["langfuse.observation.cost_details"])
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
		SelectedTool:          "knowledge_query",
		DeploymentEnvironment: "staging",
	}); err != nil {
		t.Fatalf("Emit returned error: %v", err)
	}

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("ended spans = %d, want 1", len(spans))
	}
	found := map[string]string{}
	for _, attr := range spans[0].Attributes() {
		found[string(attr.Key)] = attr.Value.AsString()
	}
	expectedValues := map[string]string{
		"langfuse.trace.name":    "online-answer",
		"langfuse.session.id":    "conv-langfuse-001",
		"langfuse.user.id":       "user-langfuse-001",
		"langfuse.release":       "release-2026-06-18",
		"langfuse.trace.tags":    "surface:execution-control,target:knowledge_query,env:staging",
		"request_id":             "req-langfuse-001",
		"run_id":                 "run-langfuse-001",
		"trace_id":               "trace-langfuse-001",
		"selected_tool":          "knowledge_query",
		"deployment.environment": "staging",
	}
	for key, want := range expectedValues {
		if found[key] != want {
			t.Fatalf("telemetry attribute %s = %q, want %q", key, found[key], want)
		}
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
