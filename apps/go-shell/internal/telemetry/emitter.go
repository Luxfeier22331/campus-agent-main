package telemetry

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

type Event struct {
	Name                string
	RequestID           string
	TraceID             string
	Lane                string
	RequestedCapability string
	Outcome             string
	Decision            string
	FailureCode         string
	StatusCode          int
	Duration            time.Duration
}

type Status struct {
	Enabled            bool   `json:"enabled"`
	ExporterConfigured bool   `json:"exporter_configured"`
	DroppedCount       uint64 `json:"dropped_count"`
	LastError          string `json:"last_error"`
}

type Emitter struct {
	mu sync.Mutex

	enabled            bool
	exporterConfigured bool
	droppedCount       uint64
	lastError          string

	tracerProvider *sdktrace.TracerProvider
	tracer         trace.Tracer
	logger         *slog.Logger
}

func NewEmitter(ctx context.Context, cfg config.Config, logger *slog.Logger) *Emitter {
	emitter := &Emitter{
		enabled: cfg.OTelEnabled,
		logger:  logger,
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
			attribute.String("service.name", defaultString(cfg.OTelServiceName, "campus-go-shell")),
		)),
	)
	emitter.tracerProvider = provider
	emitter.tracer = provider.Tracer("campus-go-shell")
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

	attributes := []attribute.KeyValue{
		attribute.String("request_id", event.RequestID),
		attribute.String("trace_id", event.TraceID),
		attribute.String("lane", event.Lane),
		attribute.String("requested_capability", event.RequestedCapability),
		attribute.String("outcome", event.Outcome),
		attribute.String("decision", event.Decision),
		attribute.String("failure_code", event.FailureCode),
		attribute.Int("status_code", event.StatusCode),
		attribute.Int64("duration_ms", event.Duration.Milliseconds()),
	}
	name := strings.TrimSpace(event.Name)
	if name == "" {
		name = "execution.event"
	}
	_, span := e.tracer.Start(ctx, "go_shell."+name, trace.WithAttributes(attributes...))
	span.End()
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
		DroppedCount:       e.droppedCount,
		LastError:          e.lastError,
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

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastError = value
	if e.logger != nil {
		e.logger.Warn("go_shell.telemetry_unavailable", "error", value)
	}
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
