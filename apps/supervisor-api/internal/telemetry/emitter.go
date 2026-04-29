package telemetry

import (
	"context"
	"hash/fnv"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type Event struct {
	BridgeDuration        time.Duration
	BridgeCancelStatus    string
	ContextPreflightState string
	Name                  string
	RequestID             string
	TraceID               string
	Lane                  string
	RequestedCapability   string
	Outcome               string
	Decision              string
	FailureCode           string
	StatusCode            int
	Duration              time.Duration
	QueueWait             time.Duration
	ScopeGateDecision     string
	PolicyGateDecision    string
	RoutingNextAction     string
	PlanningOutcome       string
	SelectedTarget        string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
}

type Status struct {
	Enabled            bool   `json:"enabled"`
	ExporterConfigured bool   `json:"exporter_configured"`
	ExportedCount      uint64 `json:"exported_count"`
	DroppedCount       uint64 `json:"dropped_count"`
	FailedCount        uint64 `json:"failed_count"`
	LastError          string `json:"last_error"`
	SampleRatio        string `json:"sample_ratio"`
}

type Emitter struct {
	mu sync.Mutex

	enabled            bool
	exporterConfigured bool
	exportedCount      uint64
	droppedCount       uint64
	failedCount        uint64
	lastError          string
	sampleRatio        float64
	allowedVersion     string

	tracerProvider *sdktrace.TracerProvider
	tracer         trace.Tracer
	logger         *slog.Logger
}

func NewEmitter(ctx context.Context, cfg config.Config, logger *slog.Logger) *Emitter {
	emitter := &Emitter{
		enabled:        cfg.OTelEnabled,
		logger:         logger,
		sampleRatio:    cfg.OTelSampleRatio,
		allowedVersion: strings.TrimSpace(cfg.OTelAllowedAttributesVersion),
	}
	if emitter.sampleRatio < 0 || emitter.sampleRatio > 1 {
		emitter.sampleRatio = 1.0
	}
	if emitter.allowedVersion == "" {
		emitter.allowedVersion = "supervisor-api-otel-attrs-v1"
	}
	if !cfg.OTelEnabled {
		return emitter
	}
	endpoint := strings.TrimSpace(cfg.OTelEndpoint)
	if endpoint == "" {
		emitter.setLastError("OTel endpoint is required when SUPERVISOR_API_OTEL_ENABLED=true.")
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
			attribute.String("service.name", defaultString(cfg.OTelServiceName, "campus-supervisor-api")),
		)),
	)
	emitter.tracerProvider = provider
	emitter.tracer = provider.Tracer("campus-supervisor-api")
	emitter.exporterConfigured = true
	otel.SetTracerProvider(provider)
	return emitter
}

func (e *Emitter) Emit(ctx context.Context, event Event) {
	if e == nil || !e.enabled {
		return
	}
	if e.tracer == nil {
		e.recordDrop()
		return
	}
	if !e.shouldSample(event) {
		e.recordDrop()
		return
	}

	attributes := []attribute.KeyValue{
		attribute.Int64("bridge_duration_ms", event.BridgeDuration.Milliseconds()),
		attribute.String("bridge_cancel_status", event.BridgeCancelStatus),
		attribute.String("context_preflight_state", event.ContextPreflightState),
		attribute.String("request_id", event.RequestID),
		attribute.String("trace_id", event.TraceID),
		attribute.String("lane", event.Lane),
		attribute.String("requested_capability", event.RequestedCapability),
		attribute.String("outcome", event.Outcome),
		attribute.String("planning_outcome", event.PlanningOutcome),
		attribute.String("policy_gate_decision", event.PolicyGateDecision),
		attribute.String("decision", event.Decision),
		attribute.String("failure_code", event.FailureCode),
		attribute.Int64("queue_wait_ms", event.QueueWait.Milliseconds()),
		attribute.String("routing_next_action", event.RoutingNextAction),
		attribute.String("selected_target", event.SelectedTarget),
		attribute.String("selected_tool", event.SelectedTool),
		attribute.String("scope_gate_decision", event.ScopeGateDecision),
		attribute.String("terminal_outcome", event.TerminalOutcome),
		attribute.String("fail_close_reason", event.FailCloseReason),
		attribute.Int("status_code", event.StatusCode),
		attribute.Int64("duration_ms", event.Duration.Milliseconds()),
	}
	name := strings.TrimSpace(event.Name)
	if name == "" {
		name = "execution.event"
	}
	_, span := e.tracer.Start(ctx, "supervisor_api."+name, trace.WithAttributes(attributes...))
	span.End()
	e.recordExport()
}

func (e *Emitter) Status() Status {
	if e == nil {
		return Status{}
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	return Status{
		Enabled:            e.enabled,
		ExporterConfigured: e.exporterConfigured,
		ExportedCount:      e.exportedCount,
		DroppedCount:       e.droppedCount,
		FailedCount:        e.failedCount,
		LastError:          statusSafeLastError(e.lastError, "telemetry exporter error"),
		SampleRatio:        formatSampleRatio(e.sampleRatio),
	}
}

func (e *Emitter) Shutdown(ctx context.Context) error {
	if e == nil || e.tracerProvider == nil {
		return nil
	}
	return e.tracerProvider.Shutdown(ctx)
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

func (e *Emitter) recordFailure(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.failedCount++
	e.lastError = value
}

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastError = value
	e.failedCount++
	if e.logger != nil {
		e.logger.Warn("supervisor_api.telemetry_unavailable", "error", value)
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

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return strings.TrimSpace(value)
}

func formatSampleRatio(value float64) string {
	return strings.TrimRight(strings.TrimRight(fmtFloat(value), "0"), ".")
}

func statusSafeLastError(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	if strings.Contains(lower, "://") ||
		strings.Contains(lower, "dial tcp") ||
		strings.Contains(lower, "token=") ||
		strings.Contains(lower, "authorization") {
		return fallback
	}
	return trimmed
}

func fmtFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', 6, 64)
}
