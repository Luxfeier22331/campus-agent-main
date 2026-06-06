package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Server struct {
	config                 config.Config
	bridge                 bridge.Client
	bridgeBreaker          *bridge.CircuitBreaker
	admission              *admission.Controller
	lifecycle              *lifecycle.Registry
	logger                 *slog.Logger
	metrics                *observability.Metrics
	telemetry              *telemetry.Emitter
	executionAudit         *executionaudit.Emitter
	structuredQuery        *structuredquery.Runtime
	workflowRuns           execution.WorkflowRunStore
	workflowRunsErr        error
	runProjectionStore     execution.RunProjectionStore
	runProjectionStoreErr  error
	temporalStarter        temporalruntime.ChatWorkflowStarter
	temporalStarterErr     error
	temporalWorkersStarted bool
	intentPolicy           runtimepolicy.IntentPolicyArtifact
	intentPolicyErr        error
}

func (s *Server) TemporalWorkerActivities() any {
	return s
}

func (s *Server) MarkTemporalWorkersStarted(started bool) {
	s.temporalWorkersStarted = started
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

var errDurableLeaseLoopRetired = errors.New("durable PG lease loop is retired; use Temporal workers")

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
		StructuredProjectionDatabaseURL:     cfg.StructuredProjectionDatabaseURL,
		TrustedTimeRFC3339:                  cfg.StructuredQueryTrustedTimeRFC3339,
		NoticeReadModelDatabaseURL:          cfg.NoticeReadModelDatabaseURL,
		NoticeReadModelTable:                cfg.NoticeReadModelTable,
		NoticeBodyObjectStoreEndpoint:       cfg.NoticeBodyObjectStoreEndpoint,
		NoticeBodyObjectStoreAccessKey:      cfg.NoticeBodyObjectStoreAccessKey,
		NoticeBodyObjectStoreSecretKey:      cfg.NoticeBodyObjectStoreSecretKey,
		NoticeBodyObjectStoreRegion:         cfg.NoticeBodyObjectStoreRegion,
		NoticeBodyObjectStoreBucket:         cfg.NoticeBodyObjectStoreBucket,
		NoticeBodyObjectStoreBodyLimitBytes: cfg.NoticeBodyObjectStoreBodyLimitBytes,
	})
	workflowRuns, workflowRunsErr := newWorkflowRunStore(cfg)
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(cfg)
	temporalStarter, temporalStarterErr := newTemporalStarter(cfg)

	server := &Server{
		config: cfg,
		bridge: bridgeClient,
		bridgeBreaker: bridge.NewCircuitBreaker(bridge.CircuitBreakerConfig{
			FailureThreshold: cfg.BridgeBreakerFailureThreshold,
			OpenDuration:     time.Duration(cfg.BridgeBreakerOpenMS) * time.Millisecond,
		}),
		admission:             admissionController,
		lifecycle:             registry,
		logger:                logger,
		metrics:               metrics,
		telemetry:             telemetryEmitter,
		executionAudit:        executionAuditEmitter,
		structuredQuery:       structuredQueryRuntime,
		workflowRuns:          workflowRuns,
		workflowRunsErr:       workflowRunsErr,
		runProjectionStore:    runProjectionStore,
		runProjectionStoreErr: runProjectionStoreErr,
		temporalStarter:       temporalStarter,
		temporalStarterErr:    temporalStarterErr,
		intentPolicy:          intentPolicy,
		intentPolicyErr:       intentPolicyErr,
	}
	return server
}

func newTemporalStarter(cfg config.Config) (temporalruntime.ChatWorkflowStarter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalruntime.ErrTemporalStarterNotConfigured
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return temporalruntime.NewStarter(ctx, temporalruntime.StarterOptions{
		ActivityTaskQueues: requiredTemporalActivityTaskQueueNames(cfg),
		Address:            cfg.TemporalAddress,
		Namespace:          cfg.TemporalNamespace,
		TaskQueue:          cfg.TemporalTaskQueue,
		WorkerID:           cfg.TemporalWorkerIdentity,
		StartTimeout:       time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
	})
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

func newRunProjectionStore(cfg config.Config) (execution.RunProjectionStore, error) {
	if strings.TrimSpace(cfg.RunProjectionDatabaseURL) == "" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	store, err := execution.NewPostgresRunProjectionStore(ctx, execution.PostgresRunProjectionStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.RunProjectionDatabaseURL),
		AutoMigrate: cfg.RunProjectionAutoMigrate,
	})
	if err != nil {
		return nil, err
	}
	return store, nil
}

func generateDurableLeaseID() string {
	var buffer [16]byte
	if _, err := rand.Read(buffer[:]); err != nil {
		return ""
	}
	return "lease-" + hex.EncodeToString(buffer[:])
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

func (s *Server) StartDurableWorkerLoop(ctx context.Context) error {
	return errDurableLeaseLoopRetired
}

func (s *Server) StartDurableRecoveryLoop(ctx context.Context) error {
	return errDurableLeaseLoopRetired
}

func (s *Server) syncDurableLaneBudgets(ctx context.Context) error {
	return errDurableLeaseLoopRetired
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
	if closer, ok := s.runProjectionStore.(interface{ Close() }); ok {
		closer.Close()
	}
	return firstErr
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	request = request.WithContext(telemetry.ExtractIncomingContext(request.Context(), request.Header))
	path := request.URL.Path
	routeLabel := routeLabelFor(request.Method, path)
	startedAt := time.Now()
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
	case request.Method == http.MethodPost && path == "/internal/execution/cancel":
		s.handleCancel(writer, request)
	case request.Method == http.MethodPost && path == "/internal/execution/runs":
		s.handleExecutionRunCreate(writer, request)
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/steps"):
		if runID, ok := executionRunIDFromPath(path, "/steps"); ok {
			s.handleExecutionRunSteps(writer, request, runID)
		} else {
			setOutcome(writer, "not_found")
			writeError(writer, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/events"):
		if runID, ok := executionRunIDFromPath(path, "/events"); ok {
			s.handleExecutionRunEvents(writer, request, runID)
		} else {
			setOutcome(writer, "not_found")
			writeError(writer, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/cancel"):
		if runID, ok := executionRunIDFromPath(path, "/cancel"); ok {
			s.handleExecutionRunCancel(writer, request, runID)
		} else {
			setOutcome(writer, "not_found")
			writeError(writer, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/"):
		if runID, ok := executionRunIDFromPath(path, ""); ok {
			s.handleExecutionRunGet(writer, request, runID)
		} else {
			setOutcome(writer, "not_found")
			writeError(writer, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/service-status":
		s.handleStructuredQuery(writer, request, structuredquery.ToolServiceStatusLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/service-guide":
		s.handleStructuredQuery(writer, request, structuredquery.ToolServiceGuideLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/transport-schedule":
		s.handleStructuredQuery(writer, request, structuredquery.ToolTransportScheduleLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/contact-directory":
		s.handleStructuredQuery(writer, request, structuredquery.ToolContactDirectoryLookup)
	case request.Method == http.MethodPost && path == "/internal/query/calendar/academic-calendar":
		s.handleStructuredQuery(writer, request, structuredquery.ToolAcademicCalendarLookup)
	case request.Method == http.MethodPost && path == "/internal/query/notices/discover":
		s.handleStructuredQuery(writer, request, structuredquery.ToolCampusNoticeDiscover)
	case request.Method == http.MethodPost && path == "/internal/query/notices/change-set":
		s.handleStructuredQuery(writer, request, structuredquery.ToolCampusNoticeChangeSet)
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
}
