package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

type Server struct {
	config          config.Config
	bridge          bridge.Client
	bridgeBreaker   *bridge.CircuitBreaker
	admission       *admission.Controller
	lifecycle       *lifecycle.Registry
	logger          *slog.Logger
	metrics         *observability.Metrics
	telemetry       *telemetry.Emitter
	executionAudit  *executionaudit.Emitter
	structuredQuery *structuredquery.Runtime
	workflowRuns    execution.WorkflowRunStore
	workflowRunsErr error
	intentPolicy    runtimepolicy.IntentPolicyArtifact
	intentPolicyErr error
}

type errorInfo struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type bridgeWriteOutcome struct {
	State          lifecycle.State
	Outcome        string
	FailureKind    string
	StatusCode     int
	CircuitSuccess bool
	CircuitFailure bool
}

const statusClientClosedRequest = 499

func NewServer(cfg config.Config, bridgeClient bridge.Client) *Server {
	return NewServerWithDependencies(
		cfg,
		bridgeClient,
		nil,
		nil,
		nil,
	)
}

func NewServerWithAdmission(
	cfg config.Config,
	bridgeClient bridge.Client,
	admissionController *admission.Controller,
) *Server {
	return NewServerWithDependencies(cfg, bridgeClient, admissionController, nil, nil)
}

func NewServerWithDependencies(
	cfg config.Config,
	bridgeClient bridge.Client,
	admissionController *admission.Controller,
	logger *slog.Logger,
	metrics *observability.Metrics,
) *Server {
	if cfg.AppName == "" {
		cfg.AppName = "campus-agent"
	}
	if cfg.RequestBodyLimitBytes <= 0 {
		cfg.RequestBodyLimitBytes = 1_048_576
	}
	if cfg.BridgeTimeoutMS <= 0 {
		cfg.BridgeTimeoutMS = 35_000
	}
	if cfg.BridgeCancelTimeoutMS <= 0 {
		cfg.BridgeCancelTimeoutMS = 500
	}
	if cfg.BridgeBreakerFailureThreshold <= 0 {
		cfg.BridgeBreakerFailureThreshold = 5
	}
	if cfg.BridgeBreakerOpenMS <= 0 {
		cfg.BridgeBreakerOpenMS = 10_000
	}
	if cfg.BridgeRetryMaxAttempts <= 0 {
		cfg.BridgeRetryMaxAttempts = 2
	}
	if cfg.BridgeRetryBaseMS <= 0 {
		cfg.BridgeRetryBaseMS = 50
	}
	if cfg.StructuredQueryTimeoutMS <= 0 {
		cfg.StructuredQueryTimeoutMS = 1_000
	}
	if cfg.QueueTimeoutMS <= 0 {
		cfg.QueueTimeoutMS = 3_000
	}
	if cfg.RequestTimeoutMS <= 0 {
		cfg.RequestTimeoutMS = 45_000
	}
	if admissionController == nil {
		admissionController = newAdmissionController(cfg)
	}
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if metrics == nil {
		metrics = observability.NewMetrics()
	}
	registry := lifecycle.NewRegistry()
	telemetryEmitter := telemetry.NewEmitter(context.Background(), cfg, logger)
	executionAuditEmitter := executionaudit.NewEmitter(context.Background(), cfg, logger)
	intentPolicy, intentPolicyErr := runtimepolicy.LoadIntentPolicy(cfg.IntentPolicyPath)
	structuredQueryRuntime := structuredquery.NewRuntime(structuredquery.Options{
		StructuredProjectionDatabaseURL: cfg.StructuredProjectionDatabaseURL,
		TrustedTimeRFC3339:              cfg.StructuredQueryTrustedTimeRFC3339,
		NoticeReadModelDatabaseURL:      cfg.NoticeReadModelDatabaseURL,
		NoticeReadModelTable:            cfg.NoticeReadModelTable,
		NoticeObjectStoreEndpoint:       cfg.NoticeObjectStoreEndpoint,
		NoticeObjectStoreAccessKey:      cfg.NoticeObjectStoreAccessKey,
		NoticeObjectStoreSecretKey:      cfg.NoticeObjectStoreSecretKey,
		NoticeObjectStoreRegion:         cfg.NoticeObjectStoreRegion,
		NoticeObjectStoreBucketDerived:  cfg.NoticeObjectStoreBucketDerived,
		NoticeObjectStoreBodyLimitBytes: cfg.NoticeObjectStoreBodyLimitBytes,
	})
	workflowRuns, workflowRunsErr := newWorkflowRunStore(cfg)

	return &Server{
		config: cfg,
		bridge: bridgeClient,
		bridgeBreaker: bridge.NewCircuitBreaker(bridge.CircuitBreakerConfig{
			FailureThreshold: cfg.BridgeBreakerFailureThreshold,
			OpenDuration:     time.Duration(cfg.BridgeBreakerOpenMS) * time.Millisecond,
		}),
		admission:       admissionController,
		lifecycle:       registry,
		logger:          logger,
		metrics:         metrics,
		telemetry:       telemetryEmitter,
		executionAudit:  executionAuditEmitter,
		structuredQuery: structuredQueryRuntime,
		workflowRuns:    workflowRuns,
		workflowRunsErr: workflowRunsErr,
		intentPolicy:    intentPolicy,
		intentPolicyErr: intentPolicyErr,
	}
}

func newWorkflowRunStore(cfg config.Config) (execution.WorkflowRunStore, error) {
	if strings.TrimSpace(cfg.WorkflowRunDatabaseURL) == "" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return execution.NewPostgresWorkflowRunStore(ctx, execution.PostgresWorkflowRunStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.WorkflowRunDatabaseURL),
		AutoMigrate: cfg.WorkflowRunAutoMigrate,
	})
}

func newAdmissionController(cfg config.Config) *admission.Controller {
	laneConfigs := make(map[string]admission.LaneConfig, len(cfg.LaneBudgets))
	for lane, budget := range cfg.LaneBudgets {
		laneConfigs[lane] = admission.LaneConfig{
			MaxConcurrent: budget.MaxConcurrent,
			QueueCapacity: budget.QueueCapacity,
			QueueTimeout:  time.Duration(budget.QueueTimeoutMS) * time.Millisecond,
		}
	}
	return admission.NewController(admission.Config{
		MaxConcurrent: cfg.MaxConcurrentAnswers,
		QueueCapacity: cfg.QueueCapacity,
		QueueTimeout:  time.Duration(cfg.QueueTimeoutMS) * time.Millisecond,
		Lanes:         laneConfigs,
	})
}

func (s *Server) StartDraining() {
	s.admission.StartDraining()
}

func (s *Server) Shutdown(ctx context.Context) error {
	var firstErr error
	if s.telemetry != nil {
		firstErr = s.telemetry.Shutdown(ctx)
	}
	if s.executionAudit != nil {
		if err := s.executionAudit.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if s.structuredQuery != nil {
		s.structuredQuery.Close()
	}
	if closer, ok := s.workflowRuns.(interface{ Close() }); ok {
		closer.Close()
	}
	return firstErr
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	path := request.URL.Path
	routeLabel := routeLabelFor(request.Method, path)
	startedAt := time.Now()
	traceID := strings.TrimSpace(request.Header.Get("x-trace-id"))
	writer := newObservedResponseWriter(response)
	var finish func(statusCode int, outcome string, duration time.Duration)
	if routeLabel != "/metrics" {
		finish = s.metrics.BeginRequest(routeLabel)
	}

	switch {
	case request.Method == http.MethodGet && path == "/healthz":
		setOutcome(writer, "ok")
		writeJSON(writer, http.StatusOK, map[string]any{
			"status":   "ok",
			"app_name": s.config.AppName,
		})
	case request.Method == http.MethodGet && path == "/readyz":
		s.handleReadyz(writer, request)
	case request.Method == http.MethodGet && path == "/metrics":
		setOutcome(writer, "ok")
		s.handleMetrics(writer, request)
	case request.Method == http.MethodPost && path == "/api/v1/answer":
		s.handleAnswer(writer, request)
	case request.Method == http.MethodPost && path == "/api/v1/answer/stream":
		s.handleAnswerStream(writer, request)
	case request.Method == http.MethodPost && path == "/internal/execution/cancel":
		s.handleCancel(writer, request)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/service-status":
		s.handleStructuredQuery(writer, request, structuredquery.ToolServiceStatusLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/service-guide":
		s.handleStructuredQuery(writer, request, structuredquery.ToolServiceGuideLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/transport-schedule":
		s.handleStructuredQuery(writer, request, structuredquery.ToolTransportScheduleLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/contact-directory":
		s.handleStructuredQuery(writer, request, structuredquery.ToolContactDirectoryLookup)
	case request.Method == http.MethodPost && path == "/internal/query/notices/discover":
		s.handleStructuredQuery(writer, request, structuredquery.ToolCampusNoticeDiscover)
	case request.Method == http.MethodPost && path == "/internal/query/notices/get":
		s.handleStructuredQuery(writer, request, structuredquery.ToolCampusNoticeGet)
	default:
		setOutcome(writer, "not_found")
		writeError(
			writer,
			http.StatusNotFound,
			"not_found",
			"Route not found.",
			false,
		)
	}

	statusCode := writer.statusCode()
	outcome := writer.outcome()
	if outcome == "" {
		outcome = defaultOutcome(path, statusCode)
	}
	if finish != nil {
		finish(statusCode, outcome, time.Since(startedAt))
	}
	if path == "/api/v1/answer" {
		if observedTraceID := writer.traceID(); observedTraceID != "" {
			traceID = observedTraceID
		}
		s.logAnswerRequest(request.Context(), traceID, statusCode, outcome, time.Since(startedAt))
	}
}
