package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/provider"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Server struct {
	config                 config.Config
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
	personalMemoryExecutor personalMemoryExecutor
	personalMemoryErr      error
	ragLookupExecutor      ragLookupExecutor
	ragLookupErr           error
	ragSynthesisExecutor   ragSynthesisExecutor
	ragSynthesisErr        error
	ragVersionResolver     ragVersionResolver
	providerConfigResolver providerConfigResolver
	providerConfigErr      error
	temporalStarter        temporalruntime.ChatWorkflowStarter
	temporalStarterErr     error
	temporalWorkersStarted bool
	intentPolicy           runtimepolicy.IntentPolicyArtifact
	intentPolicyErr        error
}

func (s *Server) TemporalWorkerActivities() any {
	return s
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

func (a TemporalContextActivities) PlanRouteActivity(
	ctx context.Context,
	input temporalruntime.PlanRouteActivityInput,
) (temporalruntime.PlanRouteActivityOutput, error) {
	return a.server.PlanRouteActivity(ctx, input)
}

func (a TemporalContextActivities) PlanReplanActivity(
	ctx context.Context,
	input temporalruntime.PlanReplanActivityInput,
) (temporalruntime.PlanReplanActivityOutput, error) {
	return a.server.PlanReplanActivity(ctx, input)
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

type TemporalKnowledgeActivities struct {
	server *Server
}

func (s *Server) TemporalKnowledgeActivities() TemporalKnowledgeActivities {
	return TemporalKnowledgeActivities{server: s}
}

func (a TemporalKnowledgeActivities) PlanRAGActivity(
	ctx context.Context,
	input temporalruntime.PlanRAGActivityInput,
) (temporalruntime.PlanRAGActivityOutput, error) {
	return a.server.PlanRAGActivity(ctx, input)
}

func (a TemporalKnowledgeActivities) RetrieveIndexedLookupActivity(
	ctx context.Context,
	input temporalruntime.RetrieveIndexedLookupActivityInput,
) (temporalruntime.RetrieveIndexedLookupActivityOutput, error) {
	return a.server.RetrieveIndexedLookupActivity(ctx, input)
}

func (a TemporalKnowledgeActivities) ExpandOrRescueRetrievalActivity(
	ctx context.Context,
	input temporalruntime.ExpandOrRescueRetrievalActivityInput,
) (temporalruntime.ExpandOrRescueRetrievalActivityOutput, error) {
	return a.server.ExpandOrRescueRetrievalActivity(ctx, input)
}

func (a TemporalKnowledgeActivities) SelectEvidenceActivity(
	ctx context.Context,
	input temporalruntime.SelectEvidenceActivityInput,
) (temporalruntime.SelectEvidenceActivityOutput, error) {
	return a.server.SelectEvidenceActivity(ctx, input)
}

func (a TemporalKnowledgeActivities) SynthesizeRAGAnswerActivity(
	ctx context.Context,
	input temporalruntime.SynthesizeRAGAnswerActivityInput,
) (temporalruntime.SynthesizeRAGAnswerActivityOutput, error) {
	return a.server.SynthesizeRAGAnswerActivity(ctx, input)
}

func (a TemporalKnowledgeActivities) VerifyGroundingActivity(
	ctx context.Context,
	input temporalruntime.VerifyGroundingActivityInput,
) (temporalruntime.VerifyGroundingActivityOutput, error) {
	return a.server.VerifyGroundingActivity(ctx, input)
}

type TemporalTypedToolActivities struct {
	server *Server
}

func (s *Server) TemporalTypedToolActivities() TemporalTypedToolActivities {
	return TemporalTypedToolActivities{server: s}
}

func (a TemporalTypedToolActivities) ExecuteTypedToolActivity(
	ctx context.Context,
	input temporalruntime.ExecuteTypedToolActivityInput,
) (temporalruntime.ExecuteTypedToolActivityOutput, error) {
	return a.server.ExecuteTypedToolActivity(ctx, input)
}

func (a TemporalTypedToolActivities) ExecuteAgentAsToolActivity(
	ctx context.Context,
	input temporalruntime.ExecuteAgentAsToolActivityInput,
) (temporalruntime.ExecuteAgentAsToolActivityOutput, error) {
	return a.server.ExecuteAgentAsToolActivity(ctx, input)
}

type TemporalFinalizationActivities struct {
	server *Server
}

func (s *Server) TemporalFinalizationActivities() TemporalFinalizationActivities {
	return TemporalFinalizationActivities{server: s}
}

func (a TemporalFinalizationActivities) WriteFinalizationActivity(
	ctx context.Context,
	input temporalruntime.WriteFinalizationActivityInput,
) (temporalruntime.WriteFinalizationActivityOutput, error) {
	return a.server.WriteFinalizationActivity(ctx, input)
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
	if cfg.AppName == "" {
		cfg.AppName = "campus-agent"
	}
	if cfg.RequestBodyLimitBytes <= 0 {
		cfg.RequestBodyLimitBytes = 1_048_576
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
	providerConfigResolver, providerConfigErr := newProviderConfigResolver(cfg)
	personalMemoryExecutor, personalMemoryErr := newPersonalMemoryExecutor(cfg, providerConfigResolver)
	ragLookupExecutor, ragLookupErr := newRAGLookupExecutor(cfg, providerConfigResolver)
	ragSynthesisExecutor, ragSynthesisErr := newRAGSynthesisExecutor(cfg, providerConfigResolver)
	temporalStarter, temporalStarterErr := newTemporalStarter(cfg)

	server := &Server{
		config:                 cfg,
		admission:              admissionController,
		lifecycle:              registry,
		logger:                 logger,
		metrics:                metrics,
		telemetry:              telemetryEmitter,
		executionAudit:         executionAuditEmitter,
		structuredQuery:        structuredQueryRuntime,
		workflowRuns:           workflowRuns,
		workflowRunsErr:        workflowRunsErr,
		runProjectionStore:     runProjectionStore,
		runProjectionStoreErr:  runProjectionStoreErr,
		personalMemoryExecutor: personalMemoryExecutor,
		personalMemoryErr:      personalMemoryErr,
		ragLookupExecutor:      ragLookupExecutor,
		ragLookupErr:           ragLookupErr,
		ragSynthesisExecutor:   ragSynthesisExecutor,
		ragSynthesisErr:        ragSynthesisErr,
		ragVersionResolver:     newQdrantMetadataVersionResolver(cfg),
		providerConfigResolver: providerConfigResolver,
		providerConfigErr:      providerConfigErr,
		temporalStarter:        temporalStarter,
		temporalStarterErr:     temporalStarterErr,
		intentPolicy:           intentPolicy,
		intentPolicyErr:        intentPolicyErr,
	}
	return server
}

func newRAGSynthesisExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (ragSynthesisExecutor, error) {
	catalog, err := provider.LoadPricingCatalog(cfg.ProviderPricingPath)
	if err != nil {
		return nil, err
	}
	providerTimeout := time.Duration(cfg.RAGProviderTimeoutMS) * time.Millisecond
	if providerTimeout <= 0 {
		providerTimeout = 60 * time.Second
	}
	return providerBackedRAGSynthesisExecutor{
		configResolver:  configResolver,
		pricing:         catalog,
		providerTimeout: providerTimeout,
	}, nil
}

func newRAGLookupExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
) (ragLookupExecutor, error) {
	return newQdrantRAGLookupExecutor(cfg, configResolver)
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
	case request.Method == http.MethodPost && path == "/internal/memory/personal/items:upsert":
		s.handleProfileMemoryUpsert(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/turns:append":
		s.handleProfileMemoryAppend(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/graph:recall":
		s.handleProfileMemoryRecall(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/items:disable":
		s.handleProfileMemoryItemDisable(writer, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/owner:disable":
		s.handleProfileMemoryOwnerDisable(writer, request)
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
	case request.Method == http.MethodPost && path == "/internal/query/notices/period-summary":
		s.handleStructuredQuery(writer, request, structuredquery.ToolCampusNoticePeriodSummary)
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
