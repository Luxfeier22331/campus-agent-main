package executionaudit

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
)

type Event struct {
	BridgeDuration        time.Duration
	BridgeCancelStatus    string
	ContextPreflightState string
	Decision              string
	Duration              time.Duration
	EventType             string
	FailureKind           string
	HTTPStatus            int
	Lane                  string
	OccurredAt            time.Time
	PlanningOutcome       string
	PolicyGateDecision    string
	QueueWait             time.Duration
	RequestID             string
	RequestedCapability   string
	Retryable             bool
	RoutingNextAction     string
	ScopeGateDecision     string
	SelectedTarget        string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
	TraceID               string
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
		LastError:         statusSafeLastError(e.lastError, "execution audit delivery error"),
		QueueDepth:        queueDepth,
		RetriedCount:      e.retriedCount,
		SpooledCount:      e.spooledCount,
		SpoolDrainedCount: e.spoolDrainedCount,
		SpoolDroppedCount: e.spoolDroppedCount,
		SpoolEnabled:      e.spoolDir != "",
	}
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
