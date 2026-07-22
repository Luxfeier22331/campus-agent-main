package telemetry

import (
	"context"
	"errors"
	"hash/fnv"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type Event struct {
	ActivityAttempt       int
	ActivityType          string
	CachedInputTokens     int64
	ConversationID        string
	DeploymentEnvironment string
	Duration              time.Duration
	FailCloseReason       string
	FailureKind           string
	InputTokens           int64
	ModelName             string
	ModelProvider         string
	Name                  string
	OutputTokens          int64
	ProjectionRef         string
	Release               string
	RequestID             string
	RunID                 string
	ScheduleToStart       time.Duration
	SelectedTool          string
	Status                string
	StepID                string
	StepKind              string
	TaskQueue             string
	TraceID               string
	UserID                string
	WorkflowID            string
}
type Status struct {
	Enabled                   bool   `json:"enabled"`
	ExporterConfigured        bool   `json:"exporter_configured"`
	MetricsEnabled            bool   `json:"metrics_enabled"`
	MetricsExporterConfigured bool   `json:"metrics_exporter_configured"`
	SubmittedCount            uint64 `json:"submitted_count"`
	DroppedCount              uint64 `json:"dropped_count"`
	FailedCount               uint64 `json:"failed_count"`
	LastError                 string `json:"last_error"`
	SampleRatio               string `json:"sample_ratio"`
}

type Emitter struct {
	mu sync.Mutex

	enabled            bool
	exporterConfigured bool
	metricsEnabled     bool
	metricsConfigured  bool
	submittedCount     uint64
	droppedCount       uint64
	failedCount        uint64
	lastError          string
	sampleRatio        float64
	allowedVersion     string

	tracerProvider                 *sdktrace.TracerProvider
	tracer                         trace.Tracer
	meterProvider                  *sdkmetric.MeterProvider
	meter                          metric.Meter
	requestCounter                 metric.Int64Counter
	errorCounter                   metric.Int64Counter
	activityDuration               metric.Float64Histogram
	scheduleToStartDuration        metric.Float64Histogram
	personalMemoryOperationCounter metric.Int64Counter
	personalMemoryDuration         metric.Float64Histogram
	personalMemorySelectedItems    metric.Int64Histogram
	personalMemorySelectedChars    metric.Int64Histogram
	personalMemoryReceiptCounter   metric.Int64Counter
	logger                         *slog.Logger
}

var ErrTelemetryUnavailable = errors.New("telemetry unavailable")

func NewEmitter(ctx context.Context, cfg config.Config, logger *slog.Logger) *Emitter {
	otel.SetTextMapPropagator(runtimeTextMapPropagator)
	emitter := &Emitter{
		enabled:        cfg.OTelEnabled,
		metricsEnabled: cfg.OTelMetricsEnabled,
		logger:         logger,
		sampleRatio:    cfg.OTelSampleRatio,
		allowedVersion: strings.TrimSpace(cfg.OTelAllowedAttributesVersion),
	}
	if emitter.sampleRatio < 0 || emitter.sampleRatio > 1 {
		emitter.sampleRatio = 1.0
	}
	if emitter.allowedVersion == "" {
		emitter.allowedVersion = "execution-control-otel-attrs-v1"
	}
	if !cfg.OTelEnabled {
		return emitter
	}
	endpoint := strings.TrimSpace(cfg.OTelEndpoint)
	if endpoint == "" {
		emitter.setLastError("OTel trace exporter endpoint is required when tracing is enabled.")
		return emitter
	}
	timeout := time.Duration(cfg.OTelExportTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = time.Second
	}
	exporterCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	exporter, err := otlptracehttp.New(
		exporterCtx,
		otlptracehttp.WithEndpointURL(endpoint),
		otlptracehttp.WithTimeout(timeout),
	)
	if err != nil {
		emitter.setLastError(err.Error())
		return emitter
	}

	provider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(resource.NewSchemaless(
			attribute.String("service.name", defaultString(cfg.OTelServiceName, "campus-execution-control")),
		)),
	)
	emitter.tracerProvider = provider
	emitter.tracer = provider.Tracer("campus-execution-control")
	emitter.exporterConfigured = true
	otel.SetTracerProvider(provider)

	if emitter.metricsEnabled {
		metricsEndpoint := strings.TrimSpace(cfg.OTelMetricsEndpoint)
		if metricsEndpoint == "" {
			emitter.setLastError("OTel metrics exporter endpoint is required when metrics are enabled.")
			return emitter
		}
		metricExporter, metricErr := otlpmetrichttp.New(
			exporterCtx,
			otlpmetrichttp.WithEndpointURL(metricsEndpoint),
			otlpmetrichttp.WithTimeout(timeout),
		)
		if metricErr != nil {
			emitter.setLastError(metricErr.Error())
			return emitter
		}
		exportInterval := time.Duration(cfg.OTelExportIntervalMS) * time.Millisecond
		if exportInterval <= 0 {
			exportInterval = 15 * time.Second
		}
		reader := sdkmetric.NewPeriodicReader(
			metricExporter,
			sdkmetric.WithInterval(exportInterval),
			sdkmetric.WithTimeout(timeout),
		)
		meterProvider := sdkmetric.NewMeterProvider(
			sdkmetric.WithReader(reader),
			sdkmetric.WithResource(resource.NewSchemaless(
				attribute.String("service.name", defaultString(cfg.OTelServiceName, "campus-execution-control")),
			)),
		)
		emitter.meterProvider = meterProvider
		emitter.meter = meterProvider.Meter("campus-execution-control")
		emitter.metricsConfigured = true
		otel.SetMeterProvider(meterProvider)
		emitter.configureMetrics()
	}
	return emitter
}

func (e *Emitter) Emit(ctx context.Context, event Event) error {
	if e == nil || !e.enabled {
		return nil
	}
	if e.tracer == nil {
		return e.unavailable("OTel trace exporter is not configured.")
	}
	if e.metricsEnabled && e.meterProvider == nil {
		return e.unavailable("OTel metrics exporter is not configured.")
	}
	if !e.shouldSample(event) {
		e.recordDrop()
		return nil
	}

	attributes := []attribute.KeyValue{
		attribute.String("telemetry.allowed_attributes_version", e.allowedVersion),
		attribute.String("langfuse.trace.name", "online-answer"),
		attribute.String("langfuse.session.id", event.ConversationID),
		attribute.String("langfuse.user.id", event.UserID),
		attribute.String("langfuse.release", event.Release),
		attribute.StringSlice("langfuse.trace.tags", langfuseTraceTags(event)),
		attribute.String("langfuse.trace.metadata.request_id", event.RequestID),
		attribute.String("langfuse.trace.metadata.run_id", event.RunID),
		attribute.String("langfuse.trace.metadata.trace_id", event.TraceID),
		attribute.String("langfuse.trace.metadata.workflow_id", event.WorkflowID),
		attribute.String("deployment.environment", event.DeploymentEnvironment),
		attribute.String("request_id", event.RequestID),
		attribute.String("trace_id", event.TraceID),
		attribute.String("run_id", event.RunID),
		attribute.String("failure_kind", event.FailureKind),
		attribute.String("activity_type", event.ActivityType),
		attribute.String("task_queue", event.TaskQueue),
		attribute.Int("activity_attempt", event.ActivityAttempt),
		attribute.String("workflow_id", event.WorkflowID),
		attribute.String("step_kind", event.StepKind),
		attribute.Int64("schedule_to_start_ms", event.ScheduleToStart.Milliseconds()),
		attribute.String("selected_tool", event.SelectedTool),
		attribute.String("step_id", event.StepID),
		attribute.String("fail_close_reason", event.FailCloseReason),
		attribute.String("status", event.Status),
		attribute.String("projection_ref", event.ProjectionRef),
		attribute.Int64("duration_ms", event.Duration.Milliseconds()),
	}
	name := strings.TrimSpace(event.Name)
	if name == "" {
		name = "execution.event"
	}
	_, span := e.tracer.Start(
		ctx,
		"execution_control."+normalizeEventName(name),
		trace.WithAttributes(attributes...),
	)
	span.End()
	e.recordMetric(event)
	e.recordSubmitted()
	return nil
}

func (e *Emitter) Status() Status {
	if e == nil {
		return Status{}
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	return Status{
		Enabled:                   e.enabled,
		ExporterConfigured:        e.exporterConfigured,
		MetricsEnabled:            e.metricsEnabled,
		MetricsExporterConfigured: e.metricsConfigured,
		SubmittedCount:            e.submittedCount,
		DroppedCount:              e.droppedCount,
		FailedCount:               e.failedCount,
		LastError:                 statusSafeLastError(e.lastError, "telemetry exporter error"),
		SampleRatio:               formatSampleRatio(e.sampleRatio),
	}
}

func (e *Emitter) Shutdown(ctx context.Context) error {
	if e == nil {
		return nil
	}
	var firstErr error
	if e.tracerProvider != nil {
		firstErr = e.tracerProvider.Shutdown(ctx)
	}
	if e.meterProvider != nil {
		if err := e.meterProvider.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (e *Emitter) recordDrop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.droppedCount++
}

func (e *Emitter) recordSubmitted() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.submittedCount++
}

func (e *Emitter) configureMetrics() {
	if e == nil || e.meter == nil {
		return
	}
	requestCounter, err := e.meter.Int64Counter("campus.execution_control.runtime_requests")
	if err == nil {
		e.requestCounter = requestCounter
	}
	errorCounter, err := e.meter.Int64Counter("campus.execution_control.runtime_errors")
	if err == nil {
		e.errorCounter = errorCounter
	}
	activityDuration, err := e.meter.Float64Histogram("campus.execution_control.activity_duration_ms")
	if err == nil {
		e.activityDuration = activityDuration
	}
	scheduleToStartDuration, err := e.meter.Float64Histogram("campus.execution_control.schedule_to_start_ms")
	if err == nil {
		e.scheduleToStartDuration = scheduleToStartDuration
	}
	personalMemoryOperationCounter, err := e.meter.Int64Counter("campus.execution_control.personal_memory.operations")
	if err == nil {
		e.personalMemoryOperationCounter = personalMemoryOperationCounter
	}
	personalMemoryDuration, err := e.meter.Float64Histogram("campus.execution_control.personal_memory.duration_ms")
	if err == nil {
		e.personalMemoryDuration = personalMemoryDuration
	}
	personalMemorySelectedItems, err := e.meter.Int64Histogram("campus.execution_control.personal_memory.selected_items")
	if err == nil {
		e.personalMemorySelectedItems = personalMemorySelectedItems
	}
	personalMemorySelectedChars, err := e.meter.Int64Histogram("campus.execution_control.personal_memory.selected_chars")
	if err == nil {
		e.personalMemorySelectedChars = personalMemorySelectedChars
	}
	personalMemoryReceiptCounter, err := e.meter.Int64Counter("campus.execution_control.personal_memory.command_receipts")
	if err == nil {
		e.personalMemoryReceiptCounter = personalMemoryReceiptCounter
	}
}

func (e *Emitter) RecordPersonalMemoryOperation(
	ctx context.Context,
	operation string,
	outcome string,
	failureKind string,
	duration time.Duration,
	selectedItems int,
	selectedChars int,
) {
	if e == nil || e.meter == nil {
		return
	}
	attrs := metric.WithAttributes(
		attribute.String("operation", boundedMetricAttribute(operation, "unknown")),
		attribute.String("outcome", boundedMetricAttribute(outcome, "unknown")),
		attribute.String("failure_kind", boundedMetricAttribute(failureKind, "none")),
	)
	if ctx == nil {
		ctx = context.Background()
	}
	if e.personalMemoryOperationCounter != nil {
		e.personalMemoryOperationCounter.Add(ctx, 1, attrs)
	}
	if e.personalMemoryDuration != nil && duration >= 0 {
		e.personalMemoryDuration.Record(ctx, float64(duration)/float64(time.Millisecond), attrs)
	}
	if e.personalMemorySelectedItems != nil && selectedItems >= 0 {
		e.personalMemorySelectedItems.Record(ctx, int64(selectedItems), attrs)
	}
	if e.personalMemorySelectedChars != nil && selectedChars >= 0 {
		e.personalMemorySelectedChars.Record(ctx, int64(selectedChars), attrs)
	}
}

func (e *Emitter) RecordPersonalMemoryReceipt(ctx context.Context, commandKind string, status string, outcome string) {
	if e == nil || e.meter == nil || e.personalMemoryReceiptCounter == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	e.personalMemoryReceiptCounter.Add(ctx, 1, metric.WithAttributes(
		attribute.String("command_kind", boundedMetricAttribute(commandKind, "unknown")),
		attribute.String("status", boundedMetricAttribute(status, "unknown")),
		attribute.String("outcome", boundedMetricAttribute(outcome, "unknown")),
	))
}

func boundedMetricAttribute(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return fallback
	}
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_' || char == '-' || char == '.' {
			continue
		}
		return fallback
	}
	return value
}

func (e *Emitter) recordMetric(event Event) {
	if e == nil || e.meter == nil {
		return
	}
	attrs := []attribute.KeyValue{
		attribute.String("task_queue", defaultString(event.TaskQueue, "unknown")),
		attribute.String("step_kind", defaultString(event.StepKind, "unknown")),
		attribute.String("activity_type", defaultString(event.ActivityType, "unknown")),
		attribute.String("selected_tool", defaultString(event.SelectedTool, "unknown")),
		attribute.String("status", defaultString(event.Status, "unknown")),
		attribute.String("failure_kind", defaultString(event.FailureKind, "none")),
	}
	if e.requestCounter != nil {
		e.requestCounter.Add(context.Background(), 1, metric.WithAttributes(attrs...))
	}
	if e.errorCounter != nil && strings.TrimSpace(event.FailureKind) != "" && event.FailureKind != "none" {
		e.errorCounter.Add(context.Background(), 1, metric.WithAttributes(attrs...))
	}
	if e.activityDuration != nil && event.Duration > 0 {
		e.activityDuration.Record(
			context.Background(),
			float64(event.Duration)/float64(time.Millisecond),
			metric.WithAttributes(attrs...),
		)
	}
	if e.scheduleToStartDuration != nil && event.ScheduleToStart > 0 {
		e.scheduleToStartDuration.Record(
			context.Background(),
			float64(event.ScheduleToStart)/float64(time.Millisecond),
			metric.WithAttributes(attrs...),
		)
	}
}

func (e *Emitter) recordFailure(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.failedCount++
	e.lastError = value
}

func (e *Emitter) unavailable(message string) error {
	err := errors.Join(ErrTelemetryUnavailable, errors.New(message))
	e.recordFailure(message)
	return err
}

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastError = value
	e.failedCount++
	if e.logger != nil {
		e.logger.Warn("execution_control.telemetry_unavailable", "error", value)
	}
}

func (e *Emitter) shouldSample(event Event) bool {
	if e.sampleRatio >= 1 {
		return true
	}
	if e.sampleRatio <= 0 {
		return false
	}
	key := event.TraceID
	if key == "" {
		key = event.RequestID
	}
	if key == "" {
		key = event.Name
	}
	hasher := fnv.New32a()
	_, _ = hasher.Write([]byte(key))
	bucket := float64(hasher.Sum32()%10_000) / 10_000
	return bucket < e.sampleRatio
}

func langfuseTraceTags(event Event) []string {
	tags := []string{"surface:execution-control"}
	if target := strings.TrimSpace(event.SelectedTool); target != "" {
		tags = append(tags, "target:"+target)
	}
	if environment := strings.TrimSpace(event.DeploymentEnvironment); environment != "" {
		tags = append(tags, "env:"+environment)
	}
	return tags
}

func defaultString(value string, defaultValue string) string {
	if strings.TrimSpace(value) == "" {
		return defaultValue
	}
	return strings.TrimSpace(value)
}

func formatSampleRatio(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmtFloat(value), "0"), ".")
}

func statusSafeLastError(value string, redactedMessage string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "://") ||
		strings.Contains(lower, "dial tcp") ||
		strings.Contains(lower, "token=") ||
		strings.Contains(lower, "authorization") {
		return redactedMessage
	}
	return trimmed
}

func fmtFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 6, 64)
}

func normalizeEventName(name string) string {
	trimmed := strings.TrimSpace(name)
	switch trimmed {
	case "answer.accepted", "answer_stream.accepted":
		return "runtime.request.accepted"
	case "answer.completed", "answer_stream.completed",
		"answer.failed", "answer_stream.failed",
		"answer.cancelled", "answer_stream.cancelled",
		"answer.admission_rejected", "answer_stream.admission_rejected":
		return "runtime.request.finalized"
	default:
		return trimmed
	}
}
