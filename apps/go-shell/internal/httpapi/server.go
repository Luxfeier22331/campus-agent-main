package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/observability"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/structuredquery"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/telemetry"
)

type Server struct {
	config          config.Config
	bridge          bridge.Client
	admission       *admission.Controller
	lifecycle       *lifecycle.Registry
	logger          *slog.Logger
	metrics         *observability.Metrics
	telemetry       *telemetry.Emitter
	executionAudit  *executionaudit.Emitter
	structuredQuery *structuredquery.Runtime
}

type errorInfo struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

type bridgeWriteOutcome struct {
	State       lifecycle.State
	Outcome     string
	FailureKind string
	StatusCode  int
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
	structuredQueryRuntime := structuredquery.NewRuntime(structuredquery.Options{
		ProjectionPath:     cfg.StructuredQueryProjectionPath,
		TrustedTimeRFC3339: cfg.StructuredQueryTrustedTimeRFC3339,
	})

	return &Server{
		config:          cfg,
		bridge:          bridgeClient,
		admission:       admissionController,
		lifecycle:       registry,
		logger:          logger,
		metrics:         metrics,
		telemetry:       telemetryEmitter,
		executionAudit:  executionAuditEmitter,
		structuredQuery: structuredQueryRuntime,
	}
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
	return firstErr
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	path := request.URL.Path
	startedAt := time.Now()
	traceID := strings.TrimSpace(request.Header.Get("x-trace-id"))
	writer := newObservedResponseWriter(response)
	var finish func(statusCode int, outcome string, duration time.Duration)
	if path != "/metrics" {
		finish = s.metrics.BeginRequest(path)
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
	case request.Method == http.MethodPost && path == "/internal/execution/cancel":
		s.handleCancel(writer, request)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/service-status":
		s.handleStructuredQuery(writer, request, structuredquery.ToolServiceStatusLookup)
	case request.Method == http.MethodPost && path == "/internal/query/campus-services/transport-schedule":
		s.handleStructuredQuery(writer, request, structuredquery.ToolTransportScheduleLookup)
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

func (s *Server) handleReadyz(response http.ResponseWriter, request *http.Request) {
	bridgeConfigured := s.bridge != nil && s.bridge.Configured()
	bridgeReachable := false
	bridgeHealthy := false
	bridgeStatusCode := 0
	bridgeStatus := ""
	bridgeLastError := ""
	readinessBody := map[string]any{}
	if bridgeConfigured {
		ctx, cancel := context.WithTimeout(request.Context(), time.Second)
		defer cancel()

		bridgeReadyz, err := s.bridge.Readyz(ctx)
		if err == nil {
			parsedBody, parseErr := decodeJSONObject(bridgeReadyz.Body)
			if parseErr == nil {
				readinessBody = parsedBody
				bridgeReachable = true
				bridgeStatusCode = bridgeReadyz.StatusCode
				bridgeStatus, _ = readinessBody["status"].(string)
				bridgeHealthy = bridgeReadyz.StatusCode == http.StatusOK && bridgeStatus == "ready"
			} else {
				bridgeLastError = "Supervisor Python bridge returned invalid readiness JSON."
			}
		} else {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				bridgeLastError = "Supervisor Python bridge readiness timed out."
			} else {
				bridgeLastError = err.Error()
			}
		}
	}

	transportStatus := s.admission.Status()
	telemetryStatus := s.telemetry.Status()
	executionAuditStatus := s.executionAudit.Status()
	telemetryHealthy := !telemetryStatus.Enabled || telemetryStatus.ExporterConfigured
	ready := bridgeHealthy && transportStatus.Healthy && telemetryHealthy
	statusCode := http.StatusOK
	statusText := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		statusText = "degraded"
	}

	bridgeSnapshot := s.metrics.BridgeRuntimeSnapshot()
	responseBody := map[string]any{
		"status":                   statusText,
		"transport_runtime":        transportStatus,
		"lifecycle_runtime":        s.lifecycle.Snapshot(),
		"telemetry_runtime":        telemetryStatus,
		"execution_audit_runtime":  executionAuditStatus,
		"structured_query_runtime": s.structuredQuery.Status(),
		"bridge_runtime": map[string]any{
			"configured": bridgeConfigured,
			"reachable":  bridgeReachable,
			"healthy":    bridgeHealthy,
			"worker_status": defaultString(
				bridgeStatus,
				func() string {
					if bridgeConfigured {
						return "degraded"
					}
					return ""
				}(),
			),
			"status_code":              bridgeStatusCode,
			"last_error":               bridgeLastError,
			"last_answer_failure_code": bridgeSnapshot.LastAnswerFailureCode,
			"last_answer_failure_at":   bridgeSnapshot.LastAnswerFailureAt,
			"last_answer_success_at":   bridgeSnapshot.LastAnswerSuccessAt,
		},
	}
	for _, key := range []string{
		"runtime_provider",
		"supervisor_model",
		"specialist_model",
		"prompt_runtime",
		"prompt_http_pool",
		"audit_runtime",
	} {
		if value, ok := readinessBody[key]; ok {
			responseBody[key] = value
		}
	}

	writeJSON(response, statusCode, responseBody)
}

func (s *Server) handleStructuredQuery(
	response http.ResponseWriter,
	request *http.Request,
	tool string,
) {
	if !s.structuredQueryAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid structured query auth.", false)
		s.metrics.RecordStructuredQuery(tool, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		s.metrics.RecordStructuredQuery(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	var result structuredquery.Response
	switch tool {
	case structuredquery.ToolServiceStatusLookup:
		result = s.structuredQuery.LookupServiceStatus(ctx, body)
	case structuredquery.ToolTransportScheduleLookup:
		result = s.structuredQuery.LookupTransportSchedule(ctx, body)
	default:
		result = structuredquery.Response{
			StatusCode: http.StatusNotFound,
			Outcome:    "not_found",
			Body: map[string]any{
				"error": map[string]any{
					"code":      "not_found",
					"message":   "Structured query tool not found.",
					"retryable": false,
				},
			},
		}
	}
	setOutcome(response, result.Outcome)
	s.metrics.RecordStructuredQuery(tool, result.Outcome, result.StatusCode)
	writeJSON(response, result.StatusCode, result.Body)
}

func (s *Server) handleMetrics(response http.ResponseWriter, request *http.Request) {
	if !s.metricsAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid metrics bearer token.", false)
		return
	}
	response.Header().Set("content-type", "text/plain; version=0.0.4")
	response.WriteHeader(http.StatusOK)
	status := s.admission.Status()
	laneSnapshots := make(map[string]observability.AdmissionLaneSnapshot, len(status.Lanes))
	for lane, laneStatus := range status.Lanes {
		laneSnapshots[lane] = observability.AdmissionLaneSnapshot{
			Active:        laneStatus.Active,
			Queued:        laneStatus.Queued,
			QueueCapacity: laneStatus.QueueCapacity,
		}
	}
	lifecycleStatus := s.lifecycle.Snapshot()
	telemetryStatus := s.telemetry.Status()
	executionAuditStatus := s.executionAudit.Status()
	_, _ = response.Write(s.metrics.Prometheus(observability.AdmissionSnapshot{
		Active:        status.Active,
		Queued:        status.Queued,
		QueueCapacity: status.QueueCapacity,
		Draining:      status.Draining,
		Lanes:         laneSnapshots,
		Lifecycle: observability.LifecycleSnapshot{
			ActiveExecutions:     lifecycleStatus.ActiveExecutions,
			CancelRequestedCount: lifecycleStatus.CancelRequestedCount,
			CompletedRetained:    lifecycleStatus.CompletedRetained,
			CompletedByState:     lifecycleStatus.CompletedByState,
		},
		Telemetry: observability.TelemetrySnapshot{
			Enabled:            telemetryStatus.Enabled,
			ExporterConfigured: telemetryStatus.ExporterConfigured,
			DroppedCount:       telemetryStatus.DroppedCount,
			LastError:          telemetryStatus.LastError,
		},
		ExecutionAudit: observability.ExecutionAuditSnapshot{
			Configured:   executionAuditStatus.Configured,
			DroppedCount: executionAuditStatus.DroppedCount,
			EmittedCount: executionAuditStatus.EmittedCount,
			Enabled:      executionAuditStatus.Enabled,
			FailedCount:  executionAuditStatus.FailedCount,
			LastError:    executionAuditStatus.LastError,
			QueueDepth:   executionAuditStatus.QueueDepth,
		},
	}))
}

func (s *Server) handleAnswer(response http.ResponseWriter, request *http.Request) {
	startedAt := time.Now()
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	executionRequest, httpErr := execution.ParseAnswerRequest(
		body,
		lowerHeaders(request.Header),
		s.config,
	)
	if httpErr != nil {
		setOutcome(response, httpErr.Code)
		writeExecutionError(response, httpErr)
		return
	}
	setTraceID(response, executionRequest.TraceID)

	if s.bridge == nil || !s.bridge.Configured() {
		setOutcome(response, "bridge_not_configured")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"bridge_not_configured",
			"Supervisor Python bridge is not configured.",
			true,
		)
		return
	}

	timeoutCtx, requestCancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.RequestTimeoutMS)*time.Millisecond,
	)
	defer requestCancel()
	executionHandle, requestCtx, registerErr := s.lifecycle.Register(timeoutCtx, lifecycle.Metadata{
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
	})
	if registerErr != nil {
		if errors.Is(registerErr, lifecycle.ErrDuplicateExecution) {
			setOutcome(response, "execution_already_in_flight")
			writeError(
				response,
				http.StatusConflict,
				"execution_already_in_flight",
				"Supervisor execution request_id is already active.",
				true,
			)
			return
		}
		setOutcome(response, "execution_lifecycle_unavailable")
		writeError(
			response,
			http.StatusInternalServerError,
			"execution_lifecycle_unavailable",
			"Supervisor execution lifecycle could not be registered.",
			true,
		)
		return
	}
	finalState := lifecycle.StateFailed
	defer func() {
		s.lifecycle.Complete(executionHandle.RequestID(), finalState)
	}()
	s.telemetry.Emit(requestCtx, telemetry.Event{
		Name:                "answer.accepted",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
	})

	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateQueued)
	lease, decision := s.admission.AcquireLane(requestCtx, executionRequest.Lane)
	if lease != nil {
		defer lease.Release()
		s.metrics.RecordAdmissionDecisionForLane(
			executionRequest.Lane,
			string(decision),
			lease.WaitDuration(),
		)
	} else {
		s.metrics.RecordAdmissionDecisionForLane(executionRequest.Lane, string(decision), 0)
		finalState = s.lifecycleStateForRejectedAdmission(executionRequest.RequestID, decision, requestCtx)
		s.telemetry.Emit(requestCtx, telemetry.Event{
			Name:                "answer.admission_rejected",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Decision:            string(decision),
			Outcome:             string(decision),
			Duration:            time.Since(startedAt),
		})
		s.emitExecutionAudit(requestCtx, executionaudit.Event{
			Decision:            string(decision),
			Duration:            time.Since(startedAt),
			EventType:           "execution.admission_rejected",
			HTTPStatus:          http.StatusServiceUnavailable,
			Lane:                executionRequest.Lane,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           true,
			TraceID:             executionRequest.TraceID,
		})
		if s.writeAdmissionRejection(response, decision, executionRequest.RequestID) {
			return
		}
		return
	}

	s.lifecycle.Transition(executionRequest.RequestID, lifecycle.StateRunningBridge)
	bridgeCtx, bridgeCancel := context.WithTimeout(
		requestCtx,
		time.Duration(s.config.BridgeTimeoutMS)*time.Millisecond,
	)
	defer bridgeCancel()

	bridgeStartedAt := time.Now()
	bridgeResponse, err := s.bridge.Execute(bridgeCtx, bridge.Request{
		Payload: executionRequest.Payload,
	})
	bridgeDuration := time.Since(bridgeStartedAt)
	s.metrics.RecordBridgeDuration(bridgeDuration)
	if err != nil {
		if s.lifecycle.Canceled(executionRequest.RequestID) ||
			errors.Is(context.Cause(requestCtx), lifecycle.ErrExecutionCanceled) ||
			errors.Is(context.Cause(bridgeCtx), lifecycle.ErrExecutionCanceled) {
			finalState = lifecycle.StateCanceled
			setOutcome(response, "execution_cancelled")
			s.telemetry.Emit(requestCtx, telemetry.Event{
				Name:                "answer.cancelled",
				RequestID:           executionRequest.RequestID,
				TraceID:             executionRequest.TraceID,
				Lane:                executionRequest.Lane,
				RequestedCapability: executionRequest.RequestedCapability,
				Outcome:             "execution_cancelled",
				StatusCode:          statusClientClosedRequest,
				Duration:            time.Since(startedAt),
			})
			s.emitExecutionAudit(requestCtx, executionaudit.Event{
				BridgeDuration:      bridgeDuration,
				Duration:            time.Since(startedAt),
				EventType:           "execution.cancelled",
				HTTPStatus:          statusClientClosedRequest,
				Lane:                executionRequest.Lane,
				RequestID:           executionRequest.RequestID,
				RequestedCapability: executionRequest.RequestedCapability,
				Retryable:           false,
				TraceID:             executionRequest.TraceID,
			})
			writeError(
				response,
				statusClientClosedRequest,
				"execution_cancelled",
				"Supervisor execution was cancelled.",
				false,
			)
			return
		}
		if errors.Is(err, context.Canceled) || errors.Is(requestCtx.Err(), context.Canceled) {
			finalState = lifecycle.StateClientCanceled
			setOutcome(response, "client_canceled")
			return
		}
		code := "supervisor_bridge_unavailable"
		message := err.Error()
		status := http.StatusBadGateway
		failureKind := "unavailable"
		if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
			code = "transport_request_timeout"
			message = "Supervisor execution request timed out."
			status = http.StatusGatewayTimeout
			failureKind = "request_timeout"
			finalState = lifecycle.StateTimedOut
		} else if errors.Is(err, context.DeadlineExceeded) ||
			errors.Is(bridgeCtx.Err(), context.DeadlineExceeded) {
			code = "supervisor_bridge_timeout"
			message = "Supervisor Python bridge timed out."
			status = http.StatusGatewayTimeout
			failureKind = "timeout"
			finalState = lifecycle.StateTimedOut
		} else {
			finalState = lifecycle.StateFailed
		}
		s.metrics.RecordBridgeFailure(failureKind)
		setOutcome(response, code)
		s.telemetry.Emit(requestCtx, telemetry.Event{
			Name:                "answer.failed",
			RequestID:           executionRequest.RequestID,
			TraceID:             executionRequest.TraceID,
			Lane:                executionRequest.Lane,
			RequestedCapability: executionRequest.RequestedCapability,
			Outcome:             code,
			FailureCode:         failureKind,
			StatusCode:          status,
			Duration:            time.Since(startedAt),
		})
		eventType := "execution.bridge_failed"
		if finalState == lifecycle.StateTimedOut {
			eventType = "execution.timed_out"
		}
		s.emitExecutionAudit(requestCtx, executionaudit.Event{
			BridgeDuration:      bridgeDuration,
			Duration:            time.Since(startedAt),
			EventType:           eventType,
			FailureKind:         failureKind,
			HTTPStatus:          status,
			Lane:                executionRequest.Lane,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           true,
			TraceID:             executionRequest.TraceID,
		})
		writeError(response, status, code, message, true)
		return
	}

	writeOutcome := s.writeBridgeResponse(response, bridgeResponse, executionRequest.TraceID)
	finalState = writeOutcome.State
	eventName := "answer.failed"
	if writeOutcome.State == lifecycle.StateCompleted {
		eventName = "answer.completed"
	}
	s.telemetry.Emit(requestCtx, telemetry.Event{
		Name:                eventName,
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             writeOutcome.Outcome,
		FailureCode:         writeOutcome.FailureKind,
		StatusCode:          writeOutcome.StatusCode,
		Duration:            time.Since(startedAt),
	})
	if writeOutcome.State == lifecycle.StateFailed && writeOutcome.FailureKind != "" {
		s.emitExecutionAudit(requestCtx, executionaudit.Event{
			Duration:            time.Since(startedAt),
			EventType:           "execution.bridge_failed",
			FailureKind:         writeOutcome.FailureKind,
			HTTPStatus:          writeOutcome.StatusCode,
			Lane:                executionRequest.Lane,
			RequestID:           executionRequest.RequestID,
			RequestedCapability: executionRequest.RequestedCapability,
			Retryable:           writeOutcome.StatusCode >= 500,
			TraceID:             executionRequest.TraceID,
		})
	}
}

func (s *Server) writeAdmissionRejection(
	response http.ResponseWriter,
	decision admission.Decision,
	requestID string,
) bool {
	switch decision {
	case admission.DecisionQueueFull:
		setOutcome(response, "transport_queue_full")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_queue_full",
			"Supervisor execution admission queue is full.",
		)
		return true
	case admission.DecisionLaneQueueFull:
		setOutcome(response, "transport_lane_queue_full")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_lane_queue_full",
			"Supervisor execution admission lane queue is full.",
		)
		return true
	case admission.DecisionQueueTimeout:
		setOutcome(response, "transport_queue_timeout")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_queue_timeout",
			"Supervisor execution admission queue wait timed out.",
		)
		return true
	case admission.DecisionLaneQueueTimeout:
		setOutcome(response, "transport_lane_queue_timeout")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_lane_queue_timeout",
			"Supervisor execution admission lane queue wait timed out.",
		)
		return true
	case admission.DecisionDraining:
		setOutcome(response, "transport_draining")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_draining",
			"Supervisor execution runtime is draining.",
		)
		return true
	case admission.DecisionClientCanceled:
		if s.lifecycle.Canceled(requestID) {
			setOutcome(response, "execution_cancelled")
			writeError(
				response,
				statusClientClosedRequest,
				"execution_cancelled",
				"Supervisor execution was cancelled.",
				false,
			)
			return true
		}
		setOutcome(response, "client_canceled")
		return true
	default:
		setOutcome(response, "transport_admission_rejected")
		writeRetryableAdmissionError(
			response,
			s.config.QueueTimeoutMS,
			"transport_admission_rejected",
			"Supervisor execution admission rejected the request.",
		)
		return true
	}
}

func (s *Server) lifecycleStateForRejectedAdmission(
	requestID string,
	decision admission.Decision,
	requestCtx context.Context,
) lifecycle.State {
	if decision == admission.DecisionClientCanceled {
		if s.lifecycle.Canceled(requestID) ||
			errors.Is(context.Cause(requestCtx), lifecycle.ErrExecutionCanceled) {
			return lifecycle.StateCanceled
		}
		return lifecycle.StateClientCanceled
	}
	if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
		return lifecycle.StateTimedOut
	}
	return lifecycle.StateFailed
}

func (s *Server) handleCancel(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}

	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	payload, err := decodeJSONObject(body)
	if err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Cancel request body must be a JSON object.", false)
		return
	}
	requestID, ok := payload["request_id"].(string)
	requestID = strings.TrimSpace(requestID)
	if !ok || requestID == "" {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "request_id is required.", false)
		return
	}
	reason, _ := payload["reason"].(string)
	result, cancelErr := s.lifecycle.Cancel(requestID, strings.TrimSpace(reason))
	if cancelErr != nil {
		setOutcome(response, "execution_not_found")
		writeError(response, http.StatusNotFound, "execution_not_found", "Execution request_id is not active.", false)
		return
	}
	bridgeCancelStatus := s.propagateBridgeCancel(requestID, strings.TrimSpace(reason))
	setOutcome(response, "cancel_requested")
	s.telemetry.Emit(request.Context(), telemetry.Event{
		Name:      "execution.cancel_requested",
		RequestID: result.RequestID,
		TraceID:   result.TraceID,
		Outcome:   result.Status,
	})
	s.emitExecutionAudit(request.Context(), executionaudit.Event{
		EventType:  "execution.cancel_requested",
		HTTPStatus: http.StatusAccepted,
		RequestID:  result.RequestID,
		Retryable:  false,
		TraceID:    result.TraceID,
	})
	writeJSON(response, http.StatusAccepted, map[string]any{
		"request_id":           result.RequestID,
		"trace_id":             result.TraceID,
		"status":               result.Status,
		"bridge_cancel_status": bridgeCancelStatus,
	})
}

func (s *Server) propagateBridgeCancel(requestID string, reason string) string {
	if s.bridge == nil || !s.bridge.Configured() {
		s.metrics.RecordBridgeCancel("not_configured")
		return "not_configured"
	}
	ctx, cancel := context.WithTimeout(
		context.Background(),
		time.Duration(s.config.BridgeCancelTimeoutMS)*time.Millisecond,
	)
	defer cancel()
	response, err := s.bridge.Cancel(ctx, bridge.CancelRequest{
		RequestID: requestID,
		Reason:    reason,
	})
	if err != nil {
		s.metrics.RecordBridgeCancel("failed")
		return "failed"
	}
	if response.StatusCode == http.StatusNotFound {
		s.metrics.RecordBridgeCancel("not_found")
		return "not_found"
	}
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		s.metrics.RecordBridgeCancel("accepted")
		return "accepted"
	}
	s.metrics.RecordBridgeCancel("failed")
	return "failed"
}

func (s *Server) emitExecutionAudit(ctx context.Context, event executionaudit.Event) {
	if s.executionAudit == nil {
		return
	}
	s.executionAudit.Emit(ctx, event)
}

func (s *Server) internalWorkerAuthorized(request *http.Request) bool {
	secret := strings.TrimSpace(s.config.WorkerSharedSecret)
	if secret == "" {
		return false
	}
	presented := strings.TrimSpace(request.Header.Get("x-worker-origin-auth"))
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}

func (s *Server) structuredQueryAuthorized(request *http.Request) bool {
	secret := strings.TrimSpace(s.config.StructuredQuerySharedSecret)
	if secret == "" {
		return false
	}
	presented := strings.TrimSpace(request.Header.Get("x-supervisor-query-auth"))
	if presented == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(presented), []byte(secret)) == 1
}

func (s *Server) readJSONBody(response http.ResponseWriter, request *http.Request) (json.RawMessage, bool) {
	limited := http.MaxBytesReader(response, request.Body, s.config.RequestBodyLimitBytes)

	body, err := io.ReadAll(limited)
	closeErr := limited.Close()
	if err != nil {
		setOutcome(response, "request_body_too_large")
		writeError(
			response,
			http.StatusRequestEntityTooLarge,
			"request_body_too_large",
			"Request body exceeds supervisor execution limit.",
			false,
		)
		return nil, false
	}
	if closeErr != nil {
		setOutcome(response, "request_body_unreadable")
		writeError(
			response,
			http.StatusBadRequest,
			"request_body_unreadable",
			"Request body could not be fully read.",
			false,
		)
		return nil, false
	}
	if len(body) == 0 {
		return json.RawMessage(`{}`), true
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil || decoded == nil {
		setOutcome(response, "invalid_json")
		writeError(
			response,
			http.StatusBadRequest,
			"invalid_json",
			"Request body must be a JSON object.",
			false,
		)
		return nil, false
	}

	return json.RawMessage(body), true
}

func writeError(
	response http.ResponseWriter,
	status int,
	code string,
	message string,
	retryable bool,
) {
	writeJSON(response, status, map[string]any{
		"error": errorInfo{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
	})
}

func writeRetryableAdmissionError(
	response http.ResponseWriter,
	queueTimeoutMS int,
	code string,
	message string,
) {
	response.Header().Set("retry-after", retryAfterSeconds(queueTimeoutMS))
	writeError(response, http.StatusServiceUnavailable, code, message, true)
}

func retryAfterSeconds(timeoutMS int) string {
	if timeoutMS <= 0 {
		return "1"
	}
	seconds := (timeoutMS + 999) / 1000
	if seconds <= 0 {
		seconds = 1
	}
	return strconv.Itoa(seconds)
}

func writeJSON(response http.ResponseWriter, status int, body any) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(body)
}

func writeExecutionError(response http.ResponseWriter, httpErr *execution.HTTPError) {
	writeError(
		response,
		httpErr.Status,
		httpErr.Code,
		httpErr.Message,
		httpErr.Retryable,
	)
}

func lowerHeaders(headers http.Header) map[string]string {
	normalized := make(map[string]string, len(headers))
	for key, values := range headers {
		if len(values) > 0 {
			normalized[http.CanonicalHeaderKey(key)] = values[0]
			normalized[toLowerASCII(key)] = values[0]
		}
	}
	return normalized
}

func (s *Server) metricsAuthorized(request *http.Request) bool {
	token := strings.TrimSpace(s.config.MetricsBearerToken)
	if token == "" {
		return true
	}
	return extractBearerToken(request.Header.Get("authorization")) == token
}

func extractBearerToken(headerValue string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(headerValue, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(headerValue, prefix))
}

func (s *Server) writeBridgeResponse(
	response http.ResponseWriter,
	bridgeResponse bridge.ExecuteResponse,
	traceID string,
) bridgeWriteOutcome {
	switch bridgeResponse.Kind {
	case "supervisor_response":
		setOutcome(response, "supervisor_response")
		body, err := injectTraceID(bridgeResponse.Body, traceID)
		if err != nil {
			s.metrics.RecordBridgeFailure("invalid_response")
			setOutcome(response, "supervisor_bridge_invalid_response")
			writeError(
				response,
				http.StatusBadGateway,
				"supervisor_bridge_invalid_response",
				"Supervisor Python bridge returned an invalid response body.",
				true,
			)
			return bridgeWriteOutcome{
				State:       lifecycle.StateFailed,
				Outcome:     "supervisor_bridge_invalid_response",
				FailureKind: "invalid_response",
				StatusCode:  http.StatusBadGateway,
			}
		}
		s.metrics.RecordBridgeSuccess()
		writeRawJSON(response, bridgeResponse.StatusCode, body)
		return bridgeWriteOutcome{
			State:      lifecycle.StateCompleted,
			Outcome:    "supervisor_response",
			StatusCode: bridgeResponse.StatusCode,
		}
	case "supervisor_error":
		setOutcome(response, "supervisor_error")
		body, err := normalizeJSONObjectJSON(bridgeResponse.Body)
		if err != nil {
			s.metrics.RecordBridgeFailure("invalid_response")
			setOutcome(response, "supervisor_bridge_invalid_response")
			writeError(
				response,
				http.StatusBadGateway,
				"supervisor_bridge_invalid_response",
				"Supervisor Python bridge returned an invalid response body.",
				true,
			)
			return bridgeWriteOutcome{
				State:       lifecycle.StateFailed,
				Outcome:     "supervisor_bridge_invalid_response",
				FailureKind: "invalid_response",
				StatusCode:  http.StatusBadGateway,
			}
		}
		writeRawJSON(response, bridgeResponse.StatusCode, body)
		return bridgeWriteOutcome{
			State:       lifecycle.StateFailed,
			Outcome:     "supervisor_error",
			FailureKind: "supervisor_error",
			StatusCode:  bridgeResponse.StatusCode,
		}
	case "bridge_invalid_request":
		setOutcome(response, "supervisor_bridge_invalid_request")
		writeError(
			response,
			http.StatusBadGateway,
			"supervisor_bridge_invalid_request",
			"Supervisor Python bridge rejected the projected request payload.",
			false,
		)
		return bridgeWriteOutcome{
			State:       lifecycle.StateFailed,
			Outcome:     "supervisor_bridge_invalid_request",
			FailureKind: "invalid_request",
			StatusCode:  http.StatusBadGateway,
		}
	default:
		s.metrics.RecordBridgeFailure("invalid_response")
		setOutcome(response, "supervisor_bridge_invalid_response")
		writeError(
			response,
			http.StatusBadGateway,
			"supervisor_bridge_invalid_response",
			"Supervisor Python bridge returned an invalid response envelope.",
			true,
		)
		return bridgeWriteOutcome{
			State:       lifecycle.StateFailed,
			Outcome:     "supervisor_bridge_invalid_response",
			FailureKind: "invalid_response",
			StatusCode:  http.StatusBadGateway,
		}
	}
}

func writeRawJSON(response http.ResponseWriter, status int, body []byte) {
	response.Header().Set("content-type", "application/json")
	response.WriteHeader(status)
	_, _ = response.Write(body)
}

func injectTraceID(rawBody []byte, traceID string) ([]byte, error) {
	body, err := decodeJSONObject(rawBody)
	if err != nil {
		return nil, err
	}
	body["trace_id"] = traceID
	return json.Marshal(body)
}

func normalizeJSONObjectJSON(rawBody []byte) ([]byte, error) {
	body, err := decodeJSONObject(rawBody)
	if err != nil {
		return nil, err
	}
	return json.Marshal(body)
}

func decodeJSONObject(rawBody []byte) (map[string]any, error) {
	var body map[string]any
	if err := json.Unmarshal(rawBody, &body); err != nil || body == nil {
		return nil, errors.New("invalid JSON object")
	}
	return body, nil
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func toLowerASCII(value string) string {
	buffer := []byte(value)
	for index, item := range buffer {
		if item >= 'A' && item <= 'Z' {
			buffer[index] = item + ('a' - 'A')
		}
	}
	return string(buffer)
}

func defaultOutcome(path string, statusCode int) string {
	if path == "/readyz" {
		if statusCode == http.StatusOK {
			return "ready"
		}
		return "degraded"
	}
	if path == "/metrics" || path == "/healthz" {
		return "ok"
	}
	if statusCode == 499 {
		return "client_canceled"
	}
	if statusCode == http.StatusNotFound {
		return "not_found"
	}
	return "unknown"
}

func (s *Server) logAnswerRequest(
	ctx context.Context,
	traceID string,
	statusCode int,
	outcome string,
	duration time.Duration,
) {
	level := slog.LevelInfo
	switch {
	case outcome == "transport_queue_full":
		level = slog.LevelWarn
	case outcome == "transport_queue_timeout":
		level = slog.LevelWarn
	case outcome == "transport_draining":
		level = slog.LevelWarn
	case outcome == "transport_request_timeout":
		level = slog.LevelWarn
	case outcome == "supervisor_bridge_timeout":
		level = slog.LevelWarn
	case outcome == "supervisor_bridge_unavailable":
		level = slog.LevelWarn
	case outcome == "supervisor_bridge_invalid_response":
		level = slog.LevelWarn
	case statusCode >= 500:
		level = slog.LevelWarn
	}
	s.logger.LogAttrs(
		ctx,
		level,
		"go_shell.answer_request",
		slog.String("route", "/api/v1/answer"),
		slog.String("trace_id", traceID),
		slog.Int("status_code", statusCode),
		slog.String("outcome", outcome),
		slog.Int64("duration_ms", duration.Milliseconds()),
	)
}

type observedResponseWriter struct {
	http.ResponseWriter
	status       int
	wrote        bool
	outcomeValue string
	traceIDValue string
}

func newObservedResponseWriter(writer http.ResponseWriter) *observedResponseWriter {
	return &observedResponseWriter{
		ResponseWriter: writer,
	}
}

func (w *observedResponseWriter) Write(body []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

func (w *observedResponseWriter) WriteHeader(status int) {
	w.status = status
	w.wrote = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *observedResponseWriter) statusCode() int {
	if w.wrote {
		return w.status
	}
	if w.outcomeValue == "client_canceled" {
		return 499
	}
	return 0
}

func (w *observedResponseWriter) outcome() string {
	return w.outcomeValue
}

func (w *observedResponseWriter) traceID() string {
	return w.traceIDValue
}

type outcomeSetter interface {
	setOutcome(string)
}

type traceIDSetter interface {
	setTraceID(string)
}

func (w *observedResponseWriter) setOutcome(outcome string) {
	w.outcomeValue = outcome
}

func (w *observedResponseWriter) setTraceID(traceID string) {
	w.traceIDValue = traceID
}

func setOutcome(response http.ResponseWriter, outcome string) {
	if writer, ok := response.(outcomeSetter); ok {
		writer.setOutcome(outcome)
	}
}

func setTraceID(response http.ResponseWriter, traceID string) {
	if writer, ok := response.(traceIDSetter); ok {
		writer.setTraceID(traceID)
	}
}
