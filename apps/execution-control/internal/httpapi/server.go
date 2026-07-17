package httpapi

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type Server struct {
	config                    config.Config
	admission                 *admission.Controller
	lifecycle                 *lifecycle.Registry
	logger                    *slog.Logger
	metrics                   *observability.Metrics
	telemetry                 *telemetry.Emitter
	toolReadModel             *toolreadmodel.Runtime
	runProjectionStore        execution.RunProjectionStore
	runProjectionStoreErr     error
	personalMemoryExecutor    personalMemoryExecutor
	personalMemoryErr         error
	personalMemoryStateStore  memoryruntime.StateStore
	personalMemoryStateErr    error
	personalMemoryTraceStore  langfuseTraceMaintenance
	runtimeTraceStore         langfuseTraceMaintenance
	langfuseTraceErr          error
	knowledgeSearchExecutor   knowledgeSearchExecutor
	knowledgeSearchErr        error
	providerConfigResolver    providerConfigResolver
	providerConfigErr         error
	temporalStarter           temporalruntime.ChatWorkflowStarter
	temporalStarterErr        error
	temporalTaskQueueSampler  temporalTaskQueueSampler
	temporalWorkersStarted    bool
	productFinalizationWriter func(context.Context, execution.DurableRun, time.Time, map[string]any) error
}

type TemporalContextActivities struct {
	server *Server
}

func (s *Server) TemporalContextActivities() TemporalContextActivities {
	return TemporalContextActivities{server: s}
}

func (a TemporalContextActivities) MemoryRecallActivity(
	ctx context.Context,
	input temporalruntime.MemoryRecallActivityInput,
) (temporalruntime.MemoryRecallActivityOutput, error) {
	return a.server.MemoryRecallActivity(ctx, input)
}

func (a TemporalContextActivities) AppendConversationMemoryActivity(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return a.server.AppendConversationMemoryActivity(ctx, input)
}

func (a TemporalContextActivities) MemoryReflectActivity(
	ctx context.Context,
	input temporalruntime.MemoryReflectActivityInput,
) (temporalruntime.MemoryReflectActivityOutput, error) {
	return a.server.MemoryReflectActivity(ctx, input)
}

func (a TemporalContextActivities) ExecutePersonalMemoryCommandActivity(
	ctx context.Context,
	input memoryruntime.PersonalMemoryCommandRequest,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return a.server.ExecutePersonalMemoryCommandActivity(ctx, input)
}

func (a TemporalContextActivities) PurgePersonalMemoryTracesActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryTraceMaintenanceActivityInput,
) (temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput, error) {
	return a.server.PurgePersonalMemoryTracesActivity(ctx, input)
}

func (a TemporalContextActivities) VerifyPersonalMemoryTracesActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryTraceMaintenanceActivityInput,
) (temporalruntime.PersonalMemoryTraceMaintenanceActivityOutput, error) {
	return a.server.VerifyPersonalMemoryTracesActivity(ctx, input)
}

func (a TemporalContextActivities) PurgeLangfuseTraceRetentionActivity(
	ctx context.Context,
	input temporalruntime.LangfuseTraceRetentionActivityInput,
) (temporalruntime.LangfuseTraceRetentionActivityOutput, error) {
	return a.server.PurgeLangfuseTraceRetentionActivity(ctx, input)
}

func (a TemporalContextActivities) VerifyLangfuseTraceRetentionActivity(
	ctx context.Context,
	input temporalruntime.LangfuseTraceRetentionActivityInput,
) (temporalruntime.LangfuseTraceRetentionActivityOutput, error) {
	return a.server.VerifyLangfuseTraceRetentionActivity(ctx, input)
}

func (a TemporalContextActivities) FinalizePersonalMemoryCommandReceiptActivity(
	ctx context.Context,
	input temporalruntime.FinalizePersonalMemoryCommandReceiptActivityInput,
) (temporalruntime.PersonalMemoryCommandActivityOutput, error) {
	return a.server.FinalizePersonalMemoryCommandReceiptActivity(ctx, input)
}

func (a TemporalContextActivities) WritePersonalMemoryCommandResultActivity(
	ctx context.Context,
	input temporalruntime.PersonalMemoryCommandActivityOutput,
) error {
	return a.server.WritePersonalMemoryCommandResultActivity(ctx, input)
}

type TemporalAgentActivities struct {
	server *Server
}

func (s *Server) TemporalAgentActivities() TemporalAgentActivities {
	return TemporalAgentActivities{server: s}
}

func (a TemporalAgentActivities) ExecutePrimaryAgentActivity(
	ctx context.Context,
	input temporalruntime.ExecutePrimaryAgentActivityInput,
) (temporalruntime.ExecutePrimaryAgentActivityOutput, error) {
	return a.server.ExecutePrimaryAgentActivity(ctx, input)
}

type TemporalFinalizationActivities struct {
	server *Server
}

type TemporalActivityRuntimeRole string

const (
	TemporalActivityRuntimeRoleAgent TemporalActivityRuntimeRole = "activity-agent"
	TemporalActivityRuntimeRoleCore  TemporalActivityRuntimeRole = "activity-core"
)

func (s *Server) TemporalFinalizationActivities() TemporalFinalizationActivities {
	return TemporalFinalizationActivities{server: s}
}

func (a TemporalFinalizationActivities) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	return a.server.WriteFinalizationActivity(ctx, input)
}

func (a TemporalFinalizationActivities) FinalizeExecutionFailureActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionFailureActivityInput,
) (temporalruntime.FinalizeExecutionFailureActivityOutput, error) {
	return a.server.FinalizeExecutionFailureActivity(ctx, input)
}

func (s *Server) MarkTemporalWorkersStarted(started bool) {
	s.temporalWorkersStarted = started
}

type errorInfo struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

const statusClientClosedRequest = 499

func NewServer(cfg config.Config) *Server {
	return NewServerWithDependencies(cfg, nil, nil, nil)
}

func NewServerWithDependencies(
	cfg config.Config,
	admissionController *admission.Controller,
	logger *slog.Logger,
	metrics *observability.Metrics,
) *Server {
	cfg = normalizeServerConfig(cfg)
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
	toolReadModelRuntime := toolreadmodel.NewRuntime(toolreadmodel.Options{
		StructuredProjectionDatabaseURL: cfg.StructuredProjectionDatabaseURL,
		TrustedTimeRFC3339:              cfg.ToolReadModelTrustedTimeRFC3339,
	})
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(cfg)
	providerConfigResolver, providerConfigErr := newProviderConfigResolver(cfg)
	personalMemoryExecutor, personalMemoryErr := newPersonalMemoryExecutor(cfg, providerConfigResolver)
	personalMemoryStateStore, personalMemoryStateErr := newPersonalMemoryStateStore(cfg)
	runtimeTraceStore, personalMemoryTraceStore, langfuseTraceErr := newLangfuseTraceMaintenance(cfg)
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		personalMemoryExecutor = newFencedPersonalMemoryExecutor(personalMemoryExecutor, personalMemoryStateStore, cfg.PersonalMemoryOwnerSalt, cfg.PersonalMemoryTimeoutSeconds)
	}
	knowledgeSearchExecutor, knowledgeSearchErr := newKnowledgeSearchExecutor(cfg, providerConfigResolver)
	temporalStarter, temporalStarterErr := newTemporalStarter(cfg)
	taskQueueSampler := newTemporalTaskQueueSampler(cfg, temporalStarter)

	server := &Server{
		config:                   cfg,
		admission:                admissionController,
		lifecycle:                registry,
		logger:                   logger,
		metrics:                  metrics,
		telemetry:                telemetryEmitter,
		toolReadModel:            toolReadModelRuntime,
		runProjectionStore:       runProjectionStore,
		runProjectionStoreErr:    runProjectionStoreErr,
		personalMemoryExecutor:   personalMemoryExecutor,
		personalMemoryErr:        personalMemoryErr,
		personalMemoryStateStore: personalMemoryStateStore,
		personalMemoryStateErr:   personalMemoryStateErr,
		personalMemoryTraceStore: personalMemoryTraceStore,
		runtimeTraceStore:        runtimeTraceStore,
		langfuseTraceErr:         langfuseTraceErr,
		knowledgeSearchExecutor:  knowledgeSearchExecutor,
		knowledgeSearchErr:       knowledgeSearchErr,
		providerConfigResolver:   providerConfigResolver,
		providerConfigErr:        providerConfigErr,
		temporalStarter:          temporalStarter,
		temporalStarterErr:       temporalStarterErr,
		temporalTaskQueueSampler: taskQueueSampler,
	}
	return server
}

func NewTemporalActivityServer(
	cfg config.Config,
	role TemporalActivityRuntimeRole,
) (*Server, error) {
	cfg = normalizeServerConfig(cfg)
	runProjectionStore, err := newRunProjectionStore(cfg)
	if err != nil {
		return nil, fmt.Errorf("initialize run projection store: %w", err)
	}
	if runProjectionStore == nil {
		return nil, execution.ErrRunProjectionStoreNotConfigured
	}
	closeRunProjectionStore := func() {
		if closer, ok := runProjectionStore.(interface{ Close() }); ok {
			closer.Close()
		}
	}

	server := &Server{
		config:             cfg,
		logger:             slog.New(slog.NewTextHandler(io.Discard, nil)),
		metrics:            observability.NewMetrics(),
		runProjectionStore: runProjectionStore,
	}
	switch role {
	case TemporalActivityRuntimeRoleCore:
		server.personalMemoryExecutor, err = newPersonalMemoryExecutor(cfg, nil)
		if err != nil {
			closeRunProjectionStore()
			return nil, fmt.Errorf("initialize personal memory runtime: %w", err)
		}
		server.personalMemoryStateStore, err = newPersonalMemoryStateStore(cfg)
		if err != nil {
			closeRunProjectionStore()
			return nil, fmt.Errorf("initialize personal memory state store: %w", err)
		}
		server.personalMemoryExecutor = newFencedPersonalMemoryExecutor(server.personalMemoryExecutor, server.personalMemoryStateStore, cfg.PersonalMemoryOwnerSalt, cfg.PersonalMemoryTimeoutSeconds)
		server.runtimeTraceStore, server.personalMemoryTraceStore, err = newLangfuseTraceMaintenance(cfg)
		if err != nil {
			closeRunProjectionStore()
			return nil, fmt.Errorf("initialize Langfuse trace maintenance: %w", err)
		}
	case TemporalActivityRuntimeRoleAgent:
		server.providerConfigResolver, err = newProviderConfigResolver(cfg)
		if err != nil {
			closeRunProjectionStore()
			return nil, fmt.Errorf("initialize provider config resolver: %w", err)
		}
	default:
		closeRunProjectionStore()
		return nil, fmt.Errorf("unsupported temporal activity runtime role %q", role)
	}
	server.telemetry = telemetry.NewEmitter(context.Background(), cfg, server.logger)
	return server, nil
}

func normalizeServerConfig(cfg config.Config) config.Config {
	if cfg.AppName == "" {
		cfg.AppName = "campus-agent"
	}
	if cfg.RequestBodyLimitBytes <= 0 {
		cfg.RequestBodyLimitBytes = 1_048_576
	}
	if cfg.ToolReadModelTimeoutMS <= 0 {
		cfg.ToolReadModelTimeoutMS = 1_000
	}
	if cfg.QueueTimeoutMS <= 0 {
		cfg.QueueTimeoutMS = 3_000
	}
	if cfg.RequestTimeoutMS <= 0 {
		cfg.RequestTimeoutMS = 45_000
	}
	return cfg
}

func newKnowledgeSearchExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (knowledgeSearchExecutor, error) {
	return newQdrantKnowledgeSearchExecutor(cfg, configResolver)
}

func newTemporalStarter(cfg config.Config) (temporalruntime.ChatWorkflowStarter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalruntime.ErrTemporalStarterNotConfigured
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return temporalruntime.NewStarter(ctx, temporalruntime.StarterOptions{
		ActivityTaskQueues: requiredTemporalActivityTaskQueueNames(cfg),
		Address:            cfg.TemporalAddress,
		Namespace:          cfg.TemporalNamespace,
		TaskQueue:          cfg.TemporalTaskQueue,
		Tracing: temporalruntime.TracingOptions{
			Enabled:      cfg.TemporalTracingEnabled,
			OTelEndpoint: cfg.OTelEndpoint,
			ServiceName:  cfg.OTelServiceName,
		},
		WorkerID:     cfg.TemporalWorkerIdentity,
		StartTimeout: time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
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

func newPersonalMemoryStateStore(cfg config.Config) (memoryruntime.StateStore, error) {
	if strings.TrimSpace(cfg.RunProjectionDatabaseURL) == "" {
		return memoryruntime.NewInMemoryStateStore(), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return memoryruntime.NewPostgresStateStore(ctx, memoryruntime.PostgresStateStoreOptions{
		AutoMigrate: cfg.RunProjectionAutoMigrate,
		DatabaseURL: strings.TrimSpace(cfg.RunProjectionDatabaseURL),
	})
}

func newAdmissionController(cfg config.Config) *admission.Controller {
	return admission.NewController(admission.Config{
		MaxConcurrent: cfg.MaxConcurrentAnswers,
		QueueCapacity: cfg.QueueCapacity,
		QueueTimeout:  time.Duration(cfg.QueueTimeoutMS) * time.Millisecond,
	})
}

func (s *Server) StartDraining() {
	s.admission.StartDraining()
}

func (s *Server) TelemetryStatus() telemetry.Status {
	if s == nil || s.telemetry == nil {
		return telemetry.Status{}
	}
	return s.telemetry.Status()
}

func (s *Server) Shutdown(ctx context.Context) error {
	var firstErr error
	if s.telemetry != nil {
		firstErr = s.telemetry.Shutdown(ctx)
	}
	if s.toolReadModel != nil {
		s.toolReadModel.Close()
	}
	if closer, ok := s.runProjectionStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := s.personalMemoryStateStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := s.providerConfigResolver.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := s.temporalStarter.(interface{ Close() }); ok {
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
	case request.Method == http.MethodGet && path == "/internal/ops/temporal/task-queues":
		s.handleTemporalTaskQueues(writer, request)
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
	case request.Method == http.MethodPost && path == "/internal/provider-config/embedding:check-compatibility":
		s.handleProviderConfigCompatibility(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/commands":
		s.handlePersonalMemoryCommand(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/turns:append":
		s.handleProfileMemoryAppend(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/graph:recall":
		s.handleProfileMemoryRecall(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/graph:reflect":
		s.handleProfileMemoryReflect(writer, request)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/transport-schedule":
		s.handleToolReadModel(writer, request, toolreadmodel.ToolTransportScheduleLookup)
	case request.Method == http.MethodPost && path == "/internal/query/knowledge/search":
		s.handleKnowledgeSearch(writer, request)
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
