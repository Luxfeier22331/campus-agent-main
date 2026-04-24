package executionaudit

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
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
	Enabled           bool   `json:"enabled"`
	Configured        bool   `json:"configured"`
	QueueDepth        int    `json:"queue_depth"`
	BatchSize         int    `json:"batch_size"`
	EmittedCount      uint64 `json:"emitted_count"`
	DroppedCount      uint64 `json:"dropped_count"`
	FailedCount       uint64 `json:"failed_count"`
	RetriedCount      uint64 `json:"retried_count"`
	SpooledCount      uint64 `json:"spooled_count"`
	SpoolDrainedCount uint64 `json:"spool_drained_count"`
	SpoolDroppedCount uint64 `json:"spool_dropped_count"`
	SpoolEnabled      bool   `json:"spool_enabled"`
	LastError         string `json:"last_error"`
}

type Emitter struct {
	mu sync.Mutex
	wg sync.WaitGroup

	enabled    bool
	configured bool
	closed     bool

	endpoint      string
	sharedSecret  string
	timeout       time.Duration
	batchSize     int
	flushEvery    time.Duration
	retryAttempts int
	retryBase     time.Duration
	spoolDir      string
	spoolMaxBytes int64
	queue         chan Event
	client        *http.Client
	logger        *slog.Logger

	emittedCount      uint64
	droppedCount      uint64
	failedCount       uint64
	retriedCount      uint64
	spooledCount      uint64
	spoolDrainedCount uint64
	spoolDroppedCount uint64
	lastError         string
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
	batchSize := cfg.ExecutionAuditBatchSize
	if batchSize <= 0 {
		batchSize = 10
	}
	flushEvery := time.Duration(cfg.ExecutionAuditFlushMS) * time.Millisecond
	if flushEvery <= 0 {
		flushEvery = time.Second
	}
	retryAttempts := cfg.ExecutionAuditRetryMaxAttempts
	if retryAttempts <= 0 {
		retryAttempts = 3
	}
	retryBase := time.Duration(cfg.ExecutionAuditRetryBaseMS) * time.Millisecond
	if retryBase <= 0 {
		retryBase = 100 * time.Millisecond
	}
	emitter.configured = true
	emitter.endpoint = endpoint
	emitter.sharedSecret = sharedSecret
	emitter.timeout = timeout
	emitter.batchSize = batchSize
	emitter.flushEvery = flushEvery
	emitter.retryAttempts = retryAttempts
	emitter.retryBase = retryBase
	emitter.spoolDir = strings.TrimSpace(cfg.ExecutionAuditSpoolDir)
	emitter.spoolMaxBytes = int64(cfg.ExecutionAuditSpoolMaxBytes)
	if emitter.spoolMaxBytes <= 0 {
		emitter.spoolMaxBytes = 10_485_760
	}
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
		BatchSize:         e.batchSize,
		Configured:        e.configured,
		DroppedCount:      e.droppedCount,
		EmittedCount:      e.emittedCount,
		Enabled:           e.enabled,
		FailedCount:       e.failedCount,
		LastError:         e.lastError,
		QueueDepth:        queueDepth,
		RetriedCount:      e.retriedCount,
		SpooledCount:      e.spooledCount,
		SpoolDrainedCount: e.spoolDrainedCount,
		SpoolDroppedCount: e.spoolDroppedCount,
		SpoolEnabled:      e.spoolDir != "",
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
	e.drainSpool(ctx)
	ticker := time.NewTicker(e.flushEvery)
	defer ticker.Stop()
	batch := make([]Event, 0, e.batchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		events := append([]Event(nil), batch...)
		batch = batch[:0]
		e.postBatch(events)
	}
	for {
		select {
		case <-ctx.Done():
			flush()
			return
		case event, ok := <-e.queue:
			if !ok {
				flush()
				return
			}
			batch = append(batch, event)
			if len(batch) >= e.batchSize {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (e *Emitter) post(event Event) {
	e.postBatch([]Event{event})
}

func (e *Emitter) postBatch(events []Event) {
	if len(events) == 0 {
		return
	}
	if err := e.postBatchWithRetry(events); err != nil {
		e.recordFailure(err)
		if e.spoolDir != "" {
			e.spoolBatch(events)
		}
	}
}

func (e *Emitter) postBatchWithRetry(events []Event) error {
	var lastErr error
	attempts := e.retryAttempts
	if attempts <= 0 {
		attempts = 1
	}
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			e.recordRetry()
			time.Sleep(e.retryBase * time.Duration(attempt-1))
		}
		if err := e.postBatchOnce(events); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	return lastErr
}

func (e *Emitter) postBatchOnce(events []Event) error {
	payloads := make([]map[string]any, 0, len(events))
	for _, event := range events {
		payloads = append(payloads, eventPayload(event))
	}
	body, err := json.Marshal(map[string]any{
		"events": payloads,
	})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-app-internal-auth", e.sharedSecret)

	response, err := e.client.Do(request)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := response.Body.Close(); closeErr != nil {
			e.recordFailure(closeErr)
		}
	}()
	_, _ = io.Copy(io.Discard, response.Body)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errHTTPStatus(response.StatusCode)
	}
	return nil
}

type auditHTTPStatusError int

func (e auditHTTPStatusError) Error() string {
	return "execution audit ingest failed with HTTP status " + strconv.Itoa(int(e))
}

func errHTTPStatus(statusCode int) error {
	return auditHTTPStatusError(statusCode)
}

func (e *Emitter) spoolBatch(events []Event) {
	if e.spoolDir == "" {
		return
	}
	if err := os.MkdirAll(e.spoolDir, 0o700); err != nil {
		e.recordFailure(err)
		return
	}
	e.enforceSpoolLimit()
	path := filepath.Join(e.spoolDir, time.Now().UTC().Format("20060102T150405.000000000Z")+".jsonl")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		e.recordFailure(err)
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			e.recordFailure(closeErr)
		}
	}()
	encoder := json.NewEncoder(file)
	for _, event := range events {
		if err := encoder.Encode(eventPayload(event)); err != nil {
			e.recordFailure(err)
			return
		}
	}
	e.recordSpooled(uint64(len(events)))
}

func (e *Emitter) drainSpool(ctx context.Context) {
	if e.spoolDir == "" {
		return
	}
	matches, err := filepath.Glob(filepath.Join(e.spoolDir, "*.jsonl"))
	if err != nil {
		e.recordFailure(err)
		return
	}
	for _, path := range matches {
		select {
		case <-ctx.Done():
			return
		default:
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			e.recordFailure(err)
			continue
		}
		events := decodeSpoolEvents(raw)
		if len(events) == 0 {
			_ = os.Remove(path)
			continue
		}
		if err := e.postRawPayloadsWithRetry(events); err != nil {
			e.recordFailure(err)
			return
		}
		if err := os.Remove(path); err != nil {
			e.recordFailure(err)
			return
		}
		e.recordSpoolDrained(uint64(len(events)))
	}
}

func (e *Emitter) postRawPayloadsWithRetry(payloads []map[string]any) error {
	var lastErr error
	attempts := e.retryAttempts
	if attempts <= 0 {
		attempts = 1
	}
	for attempt := 1; attempt <= attempts; attempt++ {
		if attempt > 1 {
			e.recordRetry()
			time.Sleep(e.retryBase * time.Duration(attempt-1))
		}
		body, err := json.Marshal(map[string]any{"events": payloads})
		if err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
		if err != nil {
			cancel()
			return err
		}
		request.Header.Set("content-type", "application/json")
		request.Header.Set("x-app-internal-auth", e.sharedSecret)
		response, err := e.client.Do(request)
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		_, _ = io.Copy(io.Discard, response.Body)
		closeErr := response.Body.Close()
		if closeErr != nil {
			return closeErr
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			lastErr = errHTTPStatus(response.StatusCode)
			continue
		}
		return nil
	}
	return lastErr
}

func decodeSpoolEvents(raw []byte) []map[string]any {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	events := []map[string]any{}
	for {
		var event map[string]any
		if err := decoder.Decode(&event); err != nil {
			if errors.Is(err, io.EOF) {
				return events
			}
			return events
		}
		events = append(events, event)
	}
}

func (e *Emitter) enforceSpoolLimit() {
	if e.spoolDir == "" || e.spoolMaxBytes <= 0 {
		return
	}
	matches, err := filepath.Glob(filepath.Join(e.spoolDir, "*.jsonl"))
	if err != nil {
		e.recordFailure(err)
		return
	}
	var total int64
	for _, path := range matches {
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		total += info.Size()
	}
	for total > e.spoolMaxBytes && len(matches) > 0 {
		path := matches[0]
		matches = matches[1:]
		info, err := os.Stat(path)
		if err == nil {
			total -= info.Size()
		}
		if err := os.Remove(path); err == nil {
			e.recordSpoolDropped()
		}
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
	return "supervisor-api:" + strings.TrimSpace(requestID) + ":" + strings.TrimSpace(eventType)
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

func (e *Emitter) recordRetry() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.retriedCount++
}

func (e *Emitter) recordSpooled(count uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spooledCount += count
}

func (e *Emitter) recordSpoolDrained(count uint64) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spoolDrainedCount += count
}

func (e *Emitter) recordSpoolDropped() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.spoolDroppedCount++
}

func (e *Emitter) recordFailure(err error) {
	e.mu.Lock()
	e.failedCount++
	e.lastError = err.Error()
	e.mu.Unlock()
	e.logger.Warn("supervisor_api.execution_audit_failed", "error", err.Error())
}

func (e *Emitter) recordFailureStatus(statusCode int) {
	e.mu.Lock()
	e.failedCount++
	e.lastError = "execution audit ingest failed with HTTP status"
	e.mu.Unlock()
	e.logger.Warn("supervisor_api.execution_audit_failed", "status_code", statusCode)
}

func (e *Emitter) setLastError(value string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastError = value
	e.logger.Warn("supervisor_api.execution_audit_unavailable", "error", value)
}
