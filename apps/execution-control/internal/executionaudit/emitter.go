package executionaudit

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
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
	SelectedCapability    string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
	TraceID               string
}

type Status struct {
	Enabled      bool   `json:"enabled"`
	Configured   bool   `json:"configured"`
	EmittedCount uint64 `json:"emitted_count"`
	FailedCount  uint64 `json:"failed_count"`
	LastError    string `json:"last_error"`
}

type Emitter struct {
	enabled    bool
	configured bool

	endpoint     string
	sharedSecret string
	timeout      time.Duration
	client       *http.Client
	logger       *slog.Logger

	emittedCount uint64
	failedCount  uint64
	lastError    string
}

func NewEmitter(_ context.Context, cfg config.Config, logger *slog.Logger) *Emitter {
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
	emitter.configured = true
	emitter.endpoint = endpoint
	emitter.sharedSecret = sharedSecret
	emitter.timeout = timeout
	emitter.client = &http.Client{Timeout: timeout}
	return emitter
}

func (e *Emitter) Emit(ctx context.Context, event Event) error {
	if e == nil || !e.enabled {
		return nil
	}
	if !e.configured {
		err := errors.New("execution audit is enabled but not configured")
		e.recordFailure(err)
		return err
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}

	if err := e.postBatchOnce(ctx, []Event{event}); err != nil {
		e.recordFailure(err)
		return err
	}
	e.recordEmit()
	return nil
}

func (e *Emitter) Status() Status {
	if e == nil {
		return Status{}
	}
	return Status{
		Configured:   e.configured,
		EmittedCount: e.emittedCount,
		Enabled:      e.enabled,
		FailedCount:  e.failedCount,
		LastError:    statusSafeLastError(e.lastError, "execution audit delivery error"),
	}
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

func (e *Emitter) Shutdown(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}
