package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync/atomic"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionreadmodel"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryapplication"
)

type Server struct {
	runtimeHandler           http.Handler
	config                   config.Config
	draining                 atomic.Bool
	logger                   *slog.Logger
	runProjectionStore       executionapplication.RunStore
	runReader                executionreadmodel.Reader
	runProjectionStoreErr    error
	memoryManagement         memoryapplication.MemoryManagementPort
	ownerDeletion            executionapplication.OwnerDeletionPort
	personalMemoryReader     memoryapplication.ProfileReader
	temporalStarter          executionapplication.ReadinessChecker
	temporalStarterErr       error
	runService               executionapplication.RunCommandService
	campusSearchTool         executionapplication.CampusSearchToolPort
	personalMemoryRecallTool executionapplication.PersonalMemoryRecallToolPort
}

// ServerOptions contains already-constructed application ports. The HTTP
// package wires routes and authentication around these ports; it does not
// construct persistence, provider, or Temporal clients.
type ServerOptions struct {
	RuntimeHandler           http.Handler
	CampusSearchTool         executionapplication.CampusSearchToolPort
	PersonalMemoryRecallTool executionapplication.PersonalMemoryRecallToolPort
	Logger                   *slog.Logger
	MemoryManagement         memoryapplication.MemoryManagementPort
	OwnerDeletion            executionapplication.OwnerDeletionPort
	PersonalMemoryReader     memoryapplication.ProfileReader
	RunProjectionStore       executionapplication.RunStore
	RunReader                executionreadmodel.Reader
	RunProjectionStoreError  error
	RunService               executionapplication.RunCommandService
	TemporalStarter          executionapplication.ReadinessChecker
	TemporalStarterError     error
}

type errorInfo struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

const statusClientClosedRequest = 499

func NewServer(cfg config.Config) *Server {
	return NewServerWithOptions(cfg, ServerOptions{})
}

func NewServerWithOptions(cfg config.Config, options ServerOptions) *Server {
	cfg = normalizeServerConfig(cfg)
	if options.Logger == nil {
		options.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	server := &Server{
		runtimeHandler:           options.RuntimeHandler,
		campusSearchTool:         options.CampusSearchTool,
		personalMemoryRecallTool: options.PersonalMemoryRecallTool,
		config:                   cfg,
		logger:                   options.Logger,
		runProjectionStore:       options.RunProjectionStore,
		runReader:                options.RunReader,
		runProjectionStoreErr:    options.RunProjectionStoreError,
		memoryManagement:         options.MemoryManagement,
		ownerDeletion:            options.OwnerDeletion,
		personalMemoryReader:     options.PersonalMemoryReader,
		temporalStarter:          options.TemporalStarter,
		temporalStarterErr:       options.TemporalStarterError,
		runService:               options.RunService,
	}
	if server.runReader == nil && server.runProjectionStore != nil {
		server.runReader = executionreadmodel.NewStoreReader(server.runProjectionStore)
	}
	return server
}

func normalizeServerConfig(cfg config.Config) config.Config {
	if cfg.AppName == "" {
		cfg.AppName = "campus-agent"
	}
	if cfg.RequestBodyLimitBytes <= 0 {
		cfg.RequestBodyLimitBytes = 1_048_576
	}
	if cfg.RequestTimeoutMS <= 0 {
		cfg.RequestTimeoutMS = 45_000
	}
	return cfg
}

func (s *Server) StartDraining() {
	s.draining.Store(true)
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	request = request.WithContext(telemetry.ExtractIncomingContext(request.Context(), request.Header))
	path := request.URL.Path

	switch {
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/agent-runtime/") && s.runtimeHandler != nil:
		s.runtimeHandler.ServeHTTP(response, request)
	case request.Method == http.MethodGet && path == "/healthz":
		writeJSON(response, http.StatusOK, map[string]any{
			"status":   "ok",
			"app_name": s.config.AppName,
		})
	case request.Method == http.MethodGet && path == "/readyz/process":
		s.handleProcessReadyz(response, request)
	case request.Method == http.MethodGet && path == "/readyz":
		s.handleReadyz(response, request)
	case request.Method == http.MethodPost && path == "/internal/execution/requests":
		s.handleExecutionRunCreate(response, request)
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/execution/requests/") && strings.HasSuffix(path, "/campus-search/observations"):
		if requestID, ok := executionRequestIDFromPath(path, "/campus-search/observations"); ok {
			s.handleCampusSearchObservation(response, request, requestID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/owners/") && strings.HasSuffix(path, "/deletion/begin"):
		s.handleOwnerDeletionBegin(response, request, ownerUserIDFromDeletionPath(path, "/deletion/begin"))
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/owners/") && strings.HasSuffix(path, "/deletion/finalize"):
		s.handleOwnerDeletionFinalize(response, request, ownerUserIDFromDeletionPath(path, "/deletion/finalize"))
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/requests/") &&
		strings.HasSuffix(path, "/steps"):
		if requestID, ok := executionRequestIDFromPath(path, "/steps"); ok {
			s.handleExecutionRunSteps(response, request, requestID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/requests/") &&
		strings.HasSuffix(path, "/events"):
		if requestID, ok := executionRequestIDFromPath(path, "/events"); ok {
			s.handleExecutionRunEvents(response, request, requestID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && strings.HasPrefix(path, "/internal/execution/requests/") &&
		strings.HasSuffix(path, "/cancel"):
		if requestID, ok := executionRequestIDFromPath(path, "/cancel"); ok {
			s.handleExecutionRunCancel(response, request, requestID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodGet && strings.HasPrefix(path, "/internal/execution/requests/"):
		if requestID, ok := executionRequestIDFromPath(path, ""); ok {
			s.handleExecutionRunGet(response, request, requestID)
		} else {
			writeError(response, http.StatusNotFound, "not_found", "Route not found.", false)
		}
	case request.Method == http.MethodPost && path == "/internal/memory/personal/profile/get":
		s.handlePersonalMemoryProfileGet(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/commands":
		s.handlePersonalMemoryCommand(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/commands/status":
		s.handlePersonalMemoryCommandStatus(response, request)
	case request.Method == http.MethodPost && path == "/internal/memory/personal/recall":
		s.handlePersonalMemoryRecallTool(response, request)
	case request.Method == http.MethodPost && path == "/internal/campus/search":
		s.handleCampusSearchTool(response, request)
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
