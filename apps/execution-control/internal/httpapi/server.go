package httpapi

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

type Server struct {
	config                    config.Config
	admission                 *admission.Controller
	lifecycle                 *lifecycle.Registry
	logger                    *slog.Logger
	toolReadModel             *toolreadmodel.Runtime
	runProjectionStore        execution.RunProjectionStore
	runProjectionStoreErr     error
	executionInputLoader      ExecutionInputLoader
	executionInputErr         error
	personalMemoryExecutor    personalMemoryExecutor
	personalMemoryErr         error
	personalMemoryStateStore  memoryruntime.StateStore
	personalMemoryStateErr    error
	langfuseTraceStore        langfuseTraceMaintenance
	langfuseTraceErr          error
	documentEvidenceExecutor  documentEvidenceExecutor
	documentEvidenceErr       error
	groundingExecutor         groundingExecutor
	groundingErr              error
	providerConfigResolver    providerConfigResolver
	providerConfigErr         error
	temporalStarter           temporalruntime.ChatWorkflowStarter
	temporalStarterErr        error
	temporalWorkersStarted    bool
	temporalReconcilerMu      sync.Mutex
	temporalReconciler        *temporalReconciler
	productFinalizationWriter func(context.Context, execution.DurableRun, time.Time, map[string]any) error
}

type TemporalContextActivities struct {
	server *Server
}

func (s *Server) TemporalContextActivities() TemporalContextActivities {
	return TemporalContextActivities{server: s}
}

func (a TemporalContextActivities) AppendConversationMemoryActivity(
	ctx context.Context,
	input temporalruntime.AppendConversationMemoryActivityInput,
) (temporalruntime.AppendConversationMemoryActivityOutput, error) {
	return a.server.AppendConversationMemoryActivity(ctx, input)
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

func (a TemporalAgentActivities) PrepareGroundingContextActivity(
	ctx context.Context,
	input temporalruntime.PrepareGroundingContextActivityInput,
) (temporalruntime.PrepareGroundingContextActivityOutput, error) {
	return a.server.PrepareGroundingContextActivity(ctx, input)
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

func (a TemporalFinalizationActivities) FinalizeExecutionCancellationActivity(
	ctx context.Context,
	input temporalruntime.FinalizeExecutionCancellationActivityInput,
) (temporalruntime.FinalizeExecutionCancellationActivityOutput, error) {
	return a.server.FinalizeExecutionCancellationActivity(ctx, input)
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
	return NewServerWithDependencies(cfg, nil, nil)
}

func NewServerWithDependencies(
	cfg config.Config,
	admissionController *admission.Controller,
	logger *slog.Logger,
) *Server {
	cfg = normalizeServerConfig(cfg)
	if admissionController == nil {
		admissionController = newAdmissionController(cfg)
	}
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	registry := lifecycle.NewRegistry()
	toolReadModelRuntime := toolreadmodel.NewRuntime(toolreadmodel.Options{
		DatabaseURL: cfg.DatabaseURL,
	})
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(cfg)
	providerConfigResolver, providerConfigErr := newProviderConfigResolver(cfg)
	personalMemoryExecutor, personalMemoryErr := newPersonalMemoryExecutor(cfg, providerConfigResolver)
	personalMemoryStateStore, personalMemoryStateErr := newPersonalMemoryStateStore(cfg)
	langfuseTraceStore, langfuseTraceErr := newLangfuseTraceMaintenance(cfg)
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		personalMemoryExecutor = newFencedPersonalMemoryExecutor(personalMemoryExecutor, personalMemoryStateStore, cfg.PersonalMemoryOwnerSalt, cfg.PersonalMemoryTimeoutSeconds)
	}
	documentEvidenceExecutor, documentEvidenceErr := newDocumentEvidenceExecutor(
		cfg,
		providerConfigResolver,
		toolReadModelRuntime,
	)
	groundingExecutor, groundingErr := groundingExecutorFromDocumentEvidence(
		documentEvidenceExecutor,
		documentEvidenceErr,
	)
	executionInputLoader, executionInputErr := newExecutionInputLoader(cfg)
	temporalStarter, temporalStarterErr := newTemporalStarter(cfg)

	server := &Server{
		config:                   cfg,
		admission:                admissionController,
		lifecycle:                registry,
		logger:                   logger,
		toolReadModel:            toolReadModelRuntime,
		runProjectionStore:       runProjectionStore,
		runProjectionStoreErr:    runProjectionStoreErr,
		executionInputLoader:     executionInputLoader,
		executionInputErr:        executionInputErr,
		personalMemoryExecutor:   personalMemoryExecutor,
		personalMemoryErr:        personalMemoryErr,
		personalMemoryStateStore: personalMemoryStateStore,
		personalMemoryStateErr:   personalMemoryStateErr,
		langfuseTraceStore:       langfuseTraceStore,
		langfuseTraceErr:         langfuseTraceErr,
		documentEvidenceExecutor: documentEvidenceExecutor,
		documentEvidenceErr:      documentEvidenceErr,
		groundingExecutor:        groundingExecutor,
		groundingErr:             groundingErr,
		providerConfigResolver:   providerConfigResolver,
		providerConfigErr:        providerConfigErr,
		temporalStarter:          temporalStarter,
		temporalStarterErr:       temporalStarterErr,
	}
	return server
}

func NewTemporalActivityServer(
	cfg config.Config,
	role TemporalActivityRuntimeRole,
) (*Server, error) {
	cfg = normalizeServerConfig(cfg)
	executionInputLoader, err := newExecutionInputLoader(cfg)
	if err != nil {
		return nil, fmt.Errorf("initialize execution input loader: %w", err)
	}
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
		config:               cfg,
		logger:               slog.New(slog.NewTextHandler(io.Discard, nil)),
		runProjectionStore:   runProjectionStore,
		executionInputLoader: executionInputLoader,
	}
	switch role {
	case TemporalActivityRuntimeRoleCore:
		server.personalMemoryExecutor, server.personalMemoryErr = newPersonalMemoryExecutor(cfg, nil)
		server.personalMemoryStateStore, server.personalMemoryStateErr = newPersonalMemoryStateStore(cfg)
		if server.personalMemoryErr == nil && server.personalMemoryStateErr == nil {
			server.personalMemoryExecutor = newFencedPersonalMemoryExecutor(server.personalMemoryExecutor, server.personalMemoryStateStore, cfg.PersonalMemoryOwnerSalt, cfg.PersonalMemoryTimeoutSeconds)
		}
		server.langfuseTraceStore, server.langfuseTraceErr = newLangfuseTraceMaintenance(cfg)
	case TemporalActivityRuntimeRoleAgent:
		server.providerConfigResolver, err = newProviderConfigResolver(cfg)
		if err != nil {
			closeRunProjectionStore()
			return nil, fmt.Errorf("initialize provider config resolver: %w", err)
		}
		server.toolReadModel = toolreadmodel.NewRuntime(toolreadmodel.Options{
			DatabaseURL: cfg.DatabaseURL,
		})
		documentExecutor, documentErr := newDocumentEvidenceExecutor(
			cfg,
			server.providerConfigResolver,
			server.toolReadModel,
		)
		server.groundingExecutor, server.groundingErr =
			groundingExecutorFromDocumentEvidence(documentExecutor, documentErr)
		if server.groundingErr != nil {
			closeRunProjectionStore()
			server.toolReadModel.Close()
			return nil, fmt.Errorf("initialize grounding executor: %w", server.groundingErr)
		}
	default:
		closeRunProjectionStore()
		return nil, fmt.Errorf("unsupported temporal activity runtime role %q", role)
	}
	return server, nil
}

func (s *Server) loadExecutionInput(
	ctx context.Context,
	run execution.DurableRun,
) (contracts.ExecutionPayloadWire, error) {
	if s.executionInputLoader == nil {
		cause := s.executionInputErr
		if cause == nil {
			cause = errors.New("execution input loader is not configured")
		}
		return contracts.ExecutionPayloadWire{}, newExecutionInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	return s.executionInputLoader.Load(ctx, run)
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

func newDocumentEvidenceExecutor(
	cfg config.Config,
	configResolver providerConfigResolver,
	knowledgeReadModel *toolreadmodel.Runtime,
) (documentEvidenceExecutor, error) {
	return newQdrantDocumentEvidenceExecutor(cfg, configResolver, knowledgeReadModel)
}

func groundingExecutorFromDocumentEvidence(
	executor documentEvidenceExecutor,
	executorErr error,
) (groundingExecutor, error) {
	if executorErr != nil {
		return nil, executorErr
	}
	qdrant, ok := executor.(qdrantDocumentEvidenceExecutor)
	if !ok {
		return nil, errors.New("qdrant grounding executor is not configured")
	}
	return newQdrantGroundingExecutor(qdrant), nil
}

func newTemporalStarter(cfg config.Config) (temporalruntime.ChatWorkflowStarter, error) {
	if strings.TrimSpace(cfg.TemporalAddress) == "" && strings.TrimSpace(cfg.TemporalNamespace) == "" {
		return nil, temporalruntime.ErrTemporalStarterNotConfigured
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return temporalruntime.NewStarter(ctx, temporalruntime.StarterOptions{
		ActivityTaskQueues:       requiredTemporalActivityTaskQueueNames(cfg),
		Address:                  cfg.TemporalAddress,
		Namespace:                cfg.TemporalNamespace,
		TaskQueue:                cfg.TemporalTaskQueue,
		WorkerID:                 cfg.TemporalWorkerIdentity,
		StartTimeout:             time.Duration(cfg.TemporalStartTimeoutMS) * time.Millisecond,
		WorkflowExecutionTimeout: time.Duration(cfg.TemporalWorkflowExecutionTimeoutSeconds) * time.Second,
	})
}

func newRunProjectionStore(cfg config.Config) (execution.RunProjectionStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	store, err := execution.NewPostgresRunProjectionStore(ctx, execution.PostgresRunProjectionStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
	})
	if err != nil {
		return nil, err
	}
	return store, nil
}

func newPersonalMemoryStateStore(cfg config.Config) (memoryruntime.StateStore, error) {
	if strings.TrimSpace(cfg.DatabaseURL) == "" {
		return memoryruntime.NewInMemoryStateStore(), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return memoryruntime.NewPostgresStateStore(ctx, memoryruntime.PostgresStateStoreOptions{
		DatabaseURL: strings.TrimSpace(cfg.DatabaseURL),
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

func (s *Server) Shutdown(_ context.Context) error {
	s.StopTemporalReconciler()
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
	return nil
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	request = request.WithContext(telemetry.ExtractIncomingContext(request.Context(), request.Header))
	path := request.URL.Path

	switch {
	case request.Method == http.MethodGet && path == "/healthz":
		writeJSON(response, http.StatusOK, map[string]any{
			"status":   "ok",
			"app_name": s.config.AppName,
		})
	case request.Method == http.MethodGet && path == "/readyz":
		s.handleReadyz(response, request)
	case request.Method == http.MethodPost && path == "/internal/execution/runs":
		s.handleExecutionRunCreate(response, request)
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/steps"):
		if runID, ok := executionRunIDFromPath(path, "/steps"); ok {
			s.handleExecutionRunSteps(response, request, runID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/events"):
		if runID, ok := executionRunIDFromPath(path, "/events"); ok {
			s.handleExecutionRunEvents(response, request, runID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/execution/runs/") &&
		strings.HasSuffix(path, "/cancel"):
		if runID, ok := executionRunIDFromPath(path, "/cancel"); ok {
			s.handleExecutionRunCancel(response, request, runID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/runs/"):
		if runID, ok := executionRunIDFromPath(path, ""); ok {
			s.handleExecutionRunGet(response, request, runID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && path == "/internal/provider-config/embedding:check-compatibility":
		s.handleProviderConfigCompatibility(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/commands":
		s.handlePersonalMemoryCommand(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/turns:append":
		s.handleProfileMemoryAppend(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/graph:recall":
		s.handleProfileMemoryRecall(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/recall":
		s.handlePersonalMemoryRecallTool(response, request)
	default:
		writeError(
			response,
			http.StatusNotFound,
			"not_found",
			"Route not found.",
			false,
		)
	}
}
