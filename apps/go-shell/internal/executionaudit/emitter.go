package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
)

type Event struct {
	BridgeDuration      time.Duration
	Decision            string
	Duration            time.Duration
	EventType           string
	FailureKind         string
	HTTPStatus          int
	Lane                string
	OccurredAt          time.Time
	QueueWait           time.Duration
	RequestID           string
	RequestedCapability string
	Retryable           bool
	TraceID             string
}

type Status struct {
	Enabled      bool   `json:"enabled"`
	Configured   bool   `json:"configured"`
	QueueDepth   int    `json:"queue_depth"`
	EmittedCount uint64 `json:"emitted_count"`
	DroppedCount uint64 `json:"dropped_count"`
	FailedCount  uint64 `json:"failed_count"`
	LastError    string `json:"last_error"`
}

type Emitter struct {
	mu sync.Mutex
	wg sync.WaitGroup

	enabled    bool
	configured bool
	closed     bool

	endpoint     string
	sharedSecret string
	timeout      time.Duration
	queue        chan Event
	client       *http.Client
	logger       *slog.Logger

	emittedCount uint64
	droppedCount uint64
	failedCount  uint64
	lastError    string
}

func NewEmitter(ctx context.Context, cfg config.Config, logger *slog.Logger) *Emitter {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	emitter := &Emitter{
		enabled: cfg.ExecutionAuditEnabled,
		logger:  logger,
	}
	if !cfg.ExecutionAuditEnabled {
		return emitter
	}

	endpoint := strings.TrimSpace(cfg.ExecutionAuditURL)
	sharedSecret := strings.TrimSpace(cfg.ExecutionAuditSharedSecret)
	if endpoint == "" || sharedSecret == "" {
		emitter.setLastError("execution audit URL and shared secret are required when execution audit is enabled.")
		return emitter
	}

	timeout := time.Duration(cfg.ExecutionAuditTimeoutMS) * time.Millisecond
	if timeout <= 0 {
		timeout = 500 * time.Millisecond
	}
	queueCapacity := cfg.ExecutionAuditQueueCapacity
	if queueCapacity <= 0 {
		queueCapacity = 128
	}
	emitter.configured = true
	emitter.endpoint = endpoint
	emitter.sharedSecret = sharedSecret
	emitter.timeout = timeout
	emitter.queue = make(chan Event, queueCapacity)
	emitter.client = &http.Client{Timeout: timeout}
	emitter.wg.Add(1)
	go emitter.run(ctx)
	return emitter
}

func (e *Emitter) Emit(_ context.Context, event Event) {
	if e == nil || !e.enabled {
		return
	}
	if !e.configured {
		e.recordDrop()
		return
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}

	e.mu.Lock()
	closed := e.closed
	queue := e.queue
	e.mu.Unlock()
	if closed || queue == nil {
		e.recordDrop()
		return
	}

	select {
	case queue <- event:
		e.recordEmit()
	default:
		e.recordDrop()
	}
}

func (e *Emitter) Status() Status {
	if e == nil {
		return Status{}
	}
	e.mu.Lock()
	defer e.mu.Unlock()

	queueDepth := 0
	if e.queue != nil {
		queueDepth = len(e.queue)
	}
	return Status{
		Configured:   e.configured,
		DroppedCount: e.droppedCount,
		EmittedCount: e.emittedCount,
		Enabled:      e.enabled,
		FailedCount:  e.failedCount,
		LastError:    e.lastError,
		QueueDepth:   queueDepth,
	}
}

func (e *Emitter) Shutdown(ctx context.Context) error {
	if e == nil || !e.configured {
		return nil
	}
	e.mu.Lock()
	if !e.closed {
		e.closed = true
		close(e.queue)
	}
	e.mu.Unlock()

	done := make(chan struct{})
	go func() {
		e.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (e *Emitter) run(ctx context.Context) {
	defer e.wg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-e.queue:
			if !ok {
				return
			}
			e.post(event)
		}
	}
}

func (e *Emitter) post(event Event) {
	body, err := json.Marshal(map[string]any{
		"events": []map[string]any{eventPayload(event)},
	})
	if err != nil {
		e.recordFailure(err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		e.recordFailure(err)
		return
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-app-internal-auth", e.sharedSecret)

	response, err := e.client.Do(request)
	if err != nil {
		e.recordFailure(err)
		return
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil {
			e.recordFailure(closeErr)
		}
	}()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		e.recordFailureStatus(response.StatusCode)
	}
}

func eventPayload(event Event) map[string]any {
	eventType := strings.TrimSpace(event.EventType)
	return map[string]any{
		"bridge_duration_ms":   durationMilliseconds(event.BridgeDuration),
		"decision":             nullableString(event.Decision),
		"duration_ms":          durationMilliseconds(event.Duration),
		"event_id":             buildEventID(event.RequestID, eventType),
		"event_type":           eventType,
		"failure_kind":         nullableString(event.FailureKind),
		"http_status":          nullableInt(event.HTTPStatus),
		"lane":                 nullableString(event.Lane),
		"occurred_at":          event.OccurredAt.UTC().Format(time.RFC3339Nano),
		"queue_wait_ms":        durationMilliseconds(event.QueueWait),
		"request_id":           strings.TrimSpace(event.RequestID),
		"requested_capability": nullableString(event.RequestedCapability),
		"retryable":            event.Retryable,
		"trace_id":             strings.TrimSpace(event.TraceID),
	}
}

func buildEventID(requestID string, eventType string) string {
	return "go-shell:" + strings.TrimSpace(requestID) + ":" + strings.TrimSpace(eventType)
}

func durationMilliseconds(duration time.Duration) any {
	if duration <= 0 {
		return nil
	}
	return duration.Milliseconds()
}

func nullableInt(value int) any {
	if value <= 0 {
		return nil
	}
	return value
}

func nullableString(value string) any {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil
	}
	return normalized
}

func (e *Emitter) recordEmit() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.emittedCount++
}

func (e *Emitter) recordDrop() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.droppedCount++
}

func (e *Emitter) recordFailure(err error) {
	e.mu.Lock()
	e.failedCount++
	e.lastError = err.Error()
	e.mu.Unlock()
	e.logger.Warn("go_shell.execution_audit_failed", "error", err.Error())
}

func (e *Emitter) recordFailureStatus(statusCode int) {
	e.mu.Lock()
	e.failedCount++
	e.lastError = "execution audit ingest failed with HTTP status"
	e.mu.Unlock()
	e.logger.Warn("go_shell.execution_audit_failed", "status_code", statusCode)
}

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastError = value
	e.logger.Warn("go_shell.execution_audit_unavailable", "error", value)
}
