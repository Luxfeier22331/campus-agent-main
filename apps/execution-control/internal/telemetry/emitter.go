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
	CanonicalIndexTruth    string
	CandidateCount         int
	Collection             string
	ContextPreflightState  string
	Corpus                 string
	CachedInputTokens      int64
	EstimatedCostMicroUSD  int64
	InputTokens            int64
	ModelName              string
	ModelProvider          string
	Name                   string
	OutputTokens           int64
	RequestID              string
	TraceID                string
	ConversationID         string
	UserID                 string
	Release                string
	DeploymentEnvironment  string
	Lane                   string
	RequestedCapability    string
	Outcome                string
	Decision               string
	FailureCode            string
	FailureKind            string
	ActivityType           string
	TaskQueue              string
	ActivityAttempt        int
	WorkflowID             string
	StepKind               string
	PlanID                 string
	StatusCode             int
	Duration               time.Duration
	QueueWait              time.Duration
	ScheduleToStart        time.Duration
	ScopeGateDecision      string
	PolicyGateDecision     string
	RoutingNextAction      string
	PlanningOutcome        string
	QuerySHA256            string
	QueryMode              string
	ReferenceCount         int
	RetrievalMode          string
	RunID                  string
	SelectedCapability     string
	SelectedTool           string
	StepID                 string
	TerminalOutcome        string
	TerminalState          string
	FailCloseReason        string
	Status                 string
	ProjectionRef          string
	TargetDocumentIDsCount int
	TargetVersionIDsCount  int
	Latency                time.Duration
}

type Status struct {
	Enabled                   bool   `json:"enabled"`
	ExporterConfigured        bool   `json:"exporter_configured"`
	MetricsEnabled            bool   `json:"metrics_enabled"`
	MetricsExporterConfigured bool   `json:"metrics_exporter_configured"`
	ExportedCount             uint64 `json:"exported_count"`
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
	exportedCount      uint64
	droppedCount       uint64
	failedCount        uint64
	lastError          string
	sampleRatio        float64
	allowedVersion     string

	tracerProvider *sdktrace.TracerProvider
	tracer         trace.Tracer
	meterProvider  *sdkmetric.MeterProvider
	meter          metric.Meter
	requestCounter metric.Int64Counter
	errorCounter   metric.Int64Counter
	logger         *slog.Logger
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
		emitter.setLastError("OTel endpoint is required when runtime profile otel.enabled=true.")
		return emitter
	}
	timeout := time.Duration(cfg.OTelExportTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = time.Second
	}
	exporterCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	options := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(endpoint),
		otlptracehttp.WithTimeout(timeout),
	}
	if headers := parseHeaders(cfg.OTelHeaders); len(headers) > 0 {
		options = append(options, otlptracehttp.WithHeaders(headers))
	}
	exporter, err := otlptracehttp.New(exporterCtx, options...)
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
			emitter.setLastError("OTel metrics endpoint is required when runtime profile otel.metrics_enabled=true.")
			return emitter
		}
		metricOptions := []otlpmetrichttp.Option{
			otlpmetrichttp.WithEndpointURL(metricsEndpoint),
			otlpmetrichttp.WithTimeout(timeout),
		}
		if headers := parseHeaders(cfg.OTelHeaders); len(headers) > 0 {
			metricOptions = append(metricOptions, otlpmetrichttp.WithHeaders(headers))
		}
		metricExporter, metricErr := otlpmetrichttp.New(exporterCtx, metricOptions...)
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
		attribute.String("langfuse.trace.tags", langfuseTraceTags(event)),
		attribute.String("deployment.environment", event.DeploymentEnvironment),
		attribute.String("canonical_index_truth", event.CanonicalIndexTruth),
		attribute.Int("candidate_count", event.CandidateCount),
		attribute.String("context_preflight_state", event.ContextPreflightState),
		attribute.String("request_id", event.RequestID),
		attribute.String("trace_id", event.TraceID),
		attribute.String("lane", event.Lane),
		attribute.String("requested_capability", event.RequestedCapability),
		attribute.String("outcome", event.Outcome),
		attribute.String("plan_id", event.PlanID),
		attribute.String("planning_outcome", event.PlanningOutcome),
		attribute.String("query_sha256", event.QuerySHA256),
		attribute.String("query_mode", event.QueryMode),
		attribute.Int("reference_count", event.ReferenceCount),
		attribute.String("retrieval_mode", event.RetrievalMode),
		attribute.String("run_id", event.RunID),
		attribute.String("scope.collection", event.Collection),
		attribute.String("scope.corpus", event.Corpus),
		attribute.String("policy_gate_decision", event.PolicyGateDecision),
		attribute.String("decision", event.Decision),
		attribute.String("failure_code", event.FailureCode),
		attribute.String("failure_kind", event.FailureKind),
		attribute.String("activity_type", event.ActivityType),
		attribute.String("task_queue", event.TaskQueue),
		attribute.Int("activity_attempt", event.ActivityAttempt),
		attribute.String("workflow_id", event.WorkflowID),
		attribute.String("step_kind", event.StepKind),
		attribute.Int64("queue_wait_ms", event.QueueWait.Milliseconds()),
		attribute.Int64("schedule_to_start_ms", event.ScheduleToStart.Milliseconds()),
		attribute.String("routing_next_action", event.RoutingNextAction),
		attribute.String("selected_capability", event.SelectedCapability),
		attribute.String("selected_tool", event.SelectedTool),
		attribute.String("scope_gate_decision", event.ScopeGateDecision),
		attribute.String("step_id", event.StepID),
		attribute.String("terminal_outcome", event.TerminalOutcome),
		attribute.String("terminal_state", event.TerminalState),
		attribute.String("fail_close_reason", event.FailCloseReason),
		attribute.String("status", event.Status),
		attribute.String("projection_ref", event.ProjectionRef),
		attribute.Int("status_code", event.StatusCode),
		attribute.Int64("duration_ms", event.Duration.Milliseconds()),
		attribute.Int64("latency_ms", event.Latency.Milliseconds()),
		attribute.Int("target_document_ids_count", event.TargetDocumentIDsCount),
		attribute.Int("target_version_ids_count", event.TargetVersionIDsCount),
	}
	attributes = append(attributes, langfuseGenerationAttributes(event)...)
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
	if err := e.flush(ctx); err != nil {
		e.recordFailure(err.Error())
		return err
	}
	e.recordExport()
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
		ExportedCount:             e.exportedCount,
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

func (e *Emitter) recordExport() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.exportedCount++
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
}

func (e *Emitter) recordMetric(event Event) {
	if e == nil || e.meter == nil {
		return
	}
	attrs := []attribute.KeyValue{
		attribute.String("event_name", normalizeEventName(event.Name)),
		attribute.String("lane", defaultString(event.Lane, "unknown")),
		attribute.String("requested_capability", defaultString(event.RequestedCapability, "unknown")),
		attribute.String("outcome", defaultString(event.Outcome, "unknown")),
		attribute.String("failure_code", defaultString(event.FailureCode, "none")),
	}
	if e.requestCounter != nil {
		e.requestCounter.Add(context.Background(), 1, metric.WithAttributes(attrs...))
	}
	if e.errorCounter != nil && strings.TrimSpace(event.FailureCode) != "" {
		e.errorCounter.Add(context.Background(), 1, metric.WithAttributes(attrs...))
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

func (e *Emitter) flush(ctx context.Context) error {
	if e == nil {
		return nil
	}
	if e.tracerProvider != nil {
		if err := e.tracerProvider.ForceFlush(ctx); err != nil {
			return errors.Join(ErrTelemetryUnavailable, err)
		}
	}
	if e.metricsEnabled && e.meterProvider != nil {
		if err := e.meterProvider.ForceFlush(ctx); err != nil {
			return errors.Join(ErrTelemetryUnavailable, err)
		}
	}
	return nil
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

func langfuseTraceTags(event Event) string {
	tags := []string{"surface:execution-control"}
	if capability := strings.TrimSpace(event.SelectedCapability); capability != "" {
		tags = append(tags, "capability:"+capability)
	}
	if environment := strings.TrimSpace(event.DeploymentEnvironment); environment != "" {
		tags = append(tags, "env:"+environment)
	}
	return strings.Join(tags, ",")
}

func langfuseGenerationAttributes(event Event) []attribute.KeyValue {
	modelName := strings.TrimSpace(event.ModelName)
	modelProvider := strings.TrimSpace(event.ModelProvider)
	if modelName == "" && modelProvider == "" {
		return nil
	}
	if event.InputTokens <= 0 &&
		event.OutputTokens <= 0 &&
		event.CachedInputTokens <= 0 &&
		event.EstimatedCostMicroUSD <= 0 {
		return nil
	}
	attrs := []attribute.KeyValue{
		attribute.String("langfuse.observation.type", "generation"),
		attribute.String("langfuse.observation.usage_details", langfuseUsageDetails(event)),
		attribute.String("langfuse.observation.cost_details", langfuseCostDetails(event.EstimatedCostMicroUSD)),
	}
	if modelName != "" {
		attrs = append(attrs, attribute.String("langfuse.observation.model.name", modelName))
	}
	if stepID := strings.TrimSpace(event.StepID); stepID != "" {
		attrs = append(attrs, attribute.String("langfuse.observation.metadata.step_id", stepID))
	}
	return attrs
}

func langfuseUsageDetails(event Event) string {
	return `{"cache_read_input_tokens":` +
		strconv.FormatInt(event.CachedInputTokens, 10) +
		`,"input":` +
		strconv.FormatInt(event.InputTokens, 10) +
		`,"output":` +
		strconv.FormatInt(event.OutputTokens, 10) +
		`}`
}

func langfuseCostDetails(estimatedCostMicroUSD int64) string {
	totalUSD := float64(estimatedCostMicroUSD) / 1_000_000
	return `{"total":` + strconv.FormatFloat(totalUSD, 'f', -1, 64) + `}`
}

func parseHeaders(value string) map[string]string {
	headers := map[string]string{}
	for _, part := range strings.Split(value, ",") {
		key, val, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if key != "" && val != "" {
			headers[key] = val
		}
	}
	return headers
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
