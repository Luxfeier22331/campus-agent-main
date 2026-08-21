package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreconciler"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/providerconfig"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/temporalruntime"
)

type Server struct {
	config                    config.Config
	admission                 *admission.Controller
	lifecycle                 *lifecycle.Registry
	logger                    *slog.Logger
	runProjectionStore        execution.RunProjectionStore
	runProjectionStoreErr     error
	executionInputLoader      execution.InputLoader
	executionInputErr         error
	personalMemoryExecutor    personalMemoryExecutor
	personalMemoryErr         error
	personalMemoryStateStore  memoryruntime.StateStore
	personalMemoryStateErr    error
	providerConfigResolver    providerconfig.Resolver
	providerConfigErr         error
	temporalStarter           temporalruntime.ChatWorkflowStarter
	temporalStarterErr        error
	executionReconciler       *executionreconciler.Reconciler
	productFinalizationWriter func(context.Context, execution.DurableRun, time.Time, map[string]any) error
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
	runProjectionStore, runProjectionStoreErr := newRunProjectionStore(cfg)
	providerConfigResolver, providerConfigErr := providerconfig.NewResolver(
		context.Background(),
		providerconfig.ResolverOptions{
			DatabaseURL:       cfg.DatabaseURL,
			EncryptionKeyPath: cfg.ProviderConfigEncryptionKeyPath,
		},
	)
	personalMemoryExecutor, personalMemoryErr := newHindsightMemoryExecutor(cfg)
	personalMemoryStateStore, personalMemoryStateErr := newPersonalMemoryStateStore(cfg)
	if personalMemoryErr == nil && personalMemoryStateErr == nil {
		personalMemoryExecutor = newFencedPersonalMemoryExecutor(personalMemoryExecutor, personalMemoryStateStore, cfg.PersonalMemoryOwnerSalt, cfg.PersonalMemoryTimeoutSeconds)
	}
	executionInputLoader, executionInputErr := execution.NewInputLoader(cfg)
	temporalStarter, temporalStarterErr := newTemporalStarter(cfg)

	server := &Server{
		config:                   cfg,
		admission:                admissionController,
		lifecycle:                registry,
		logger:                   logger,
		runProjectionStore:       runProjectionStore,
		runProjectionStoreErr:    runProjectionStoreErr,
		executionInputLoader:     executionInputLoader,
		executionInputErr:        executionInputErr,
		personalMemoryExecutor:   personalMemoryExecutor,
		personalMemoryErr:        personalMemoryErr,
		personalMemoryStateStore: personalMemoryStateStore,
		personalMemoryStateErr:   personalMemoryStateErr,
		providerConfigResolver:   providerConfigResolver,
		providerConfigErr:        providerConfigErr,
		temporalStarter:          temporalStarter,
		temporalStarterErr:       temporalStarterErr,
	}
	server.executionReconciler = server.newExecutionReconciler()
	return server
}

func (s *Server) newExecutionReconciler() *executionreconciler.Reconciler {
	if s == nil {
		return nil
	}
	return executionreconciler.New(executionreconciler.Options{
		Finalizer:        s,
		Logger:           s.logger,
		OperationTimeout: time.Duration(s.config.TemporalStartTimeoutMS) * time.Millisecond,
		Starter:          s.temporalStarter,
		Store:            s.runProjectionStore,
	})
}

func (s *Server) ExecutionReconciler() *executionreconciler.Reconciler {
	if s == nil {
		return nil
	}
	return s.executionReconciler
}

func (s *Server) wakeTemporalReconciler() {
	if s != nil && s.executionReconciler != nil {
		s.executionReconciler.Wake()
	}
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
		return contracts.ExecutionPayloadWire{}, execution.NewInputError(
			"load",
			"execution_input_not_configured",
			false,
			cause,
		)
	}
	return s.executionInputLoader.Load(ctx, run)
}

func (s *Server) loadExecutionPayload(
	ctx context.Context,
	run execution.DurableRun,
) (map[string]any, error) {
	wire, err := s.loadExecutionInput(ctx, run)
	if err != nil {
		return nil, err
	}
	return execution.PayloadMap(wire), nil
}

func normalizeServerConfig(cfg config.Config) config.Config {
	if cfg.AppName == "" {
		cfg.AppName = "campus-agent"
	}
	if cfg.RequestBodyLimitBytes <= 0 {
		cfg.RequestBodyLimitBytes = 1_048_576
	}
	if cfg.QueueTimeoutMS <= 0 {
		cfg.QueueTimeoutMS = 3_000
	}
	if cfg.RequestTimeoutMS <= 0 {
		cfg.RequestTimeoutMS = 45_000
	}
	return cfg
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
	case request.Method == http.MethodPost && path == "/internal/memory/personal/commands":
		s.handlePersonalMemoryCommand(response, request)
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
