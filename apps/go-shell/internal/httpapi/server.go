package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/go-shell/internal/observability"
)

type Server struct {
	config  config.Config
	bridge  bridge.Client
	limiter *admission.Limiter
	logger  *slog.Logger
	metrics *observability.Metrics
}

type errorInfo struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func NewServer(cfg config.Config, bridgeClient bridge.Client) *Server {
	return NewServerWithDependencies(
		cfg,
		bridgeClient,
		admission.NewLimiter(cfg.MaxConcurrentAnswers),
		nil,
		nil,
	)
}

func NewServerWithLimiter(
	cfg config.Config,
	bridgeClient bridge.Client,
	limiter *admission.Limiter,
) *Server {
	return NewServerWithDependencies(cfg, bridgeClient, limiter, nil, nil)
}

func NewServerWithDependencies(
	cfg config.Config,
	bridgeClient bridge.Client,
	limiter *admission.Limiter,
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
	if limiter == nil {
		limiter = admission.NewLimiter(cfg.MaxConcurrentAnswers)
	}
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	if metrics == nil {
		metrics = observability.NewMetrics()
	}

	return &Server{
		config:  cfg,
		bridge:  bridgeClient,
		limiter: limiter,
		logger:  logger,
		metrics: metrics,
	}
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
		s.handleMetrics(writer)
	case request.Method == http.MethodPost && path == "/api/v1/answer":
		s.handleAnswer(writer, request)
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
	bridgeWorkerTransport := map[string]any(nil)
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
				bridgeWorkerTransport = mapFromAny(readinessBody["transport_runtime"])
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

	transportStatus := s.limiter.Status()
	ready := bridgeHealthy && transportStatus.Healthy
	statusCode := http.StatusOK
	statusText := "ready"
	if !ready {
		statusCode = http.StatusServiceUnavailable
		statusText = "degraded"
	}

	bridgeSnapshot := s.metrics.BridgeRuntimeSnapshot()
	responseBody := map[string]any{
		"status":            statusText,
		"transport_runtime": transportStatus,
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
			"worker_transport_runtime": bridgeWorkerTransport,
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

func (s *Server) handleMetrics(response http.ResponseWriter) {
	response.Header().Set("content-type", "text/plain; version=0.0.4")
	response.WriteHeader(http.StatusOK)
	_, _ = response.Write(s.metrics.Prometheus())
}

func (s *Server) handleAnswer(response http.ResponseWriter, request *http.Request) {
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

	release, admitted := s.limiter.TryAcquire()
	if !admitted {
		s.metrics.RecordTransportSaturated()
		setOutcome(response, "transport_saturated")
		writeError(
			response,
			http.StatusServiceUnavailable,
			"transport_saturated",
			"Supervisor execution admission is saturated.",
			true,
		)
		return
	}
	defer release()

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

	ctx, cancel := context.WithTimeout(request.Context(), time.Duration(s.config.BridgeTimeoutMS)*time.Millisecond)
	defer cancel()
	bridgeResponse, err := s.bridge.Execute(ctx, bridge.Request{
		Payload: executionRequest.Payload,
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			setOutcome(response, "client_canceled")
			return
		}
		code := "supervisor_bridge_unavailable"
		message := err.Error()
		status := http.StatusBadGateway
		failureKind := "unavailable"
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = "supervisor_bridge_timeout"
			message = "Supervisor Python bridge timed out."
			status = http.StatusGatewayTimeout
			failureKind = "timeout"
		}
		s.metrics.RecordBridgeFailure(failureKind)
		setOutcome(response, code)
		writeError(response, status, code, message, true)
		return
	}

	s.writeBridgeResponse(response, bridgeResponse, executionRequest.TraceID)
}

func (s *Server) readJSONBody(response http.ResponseWriter, request *http.Request) (json.RawMessage, bool) {
	limited := http.MaxBytesReader(response, request.Body, s.config.RequestBodyLimitBytes)
	defer limited.Close()

	body, err := io.ReadAll(limited)
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

func (s *Server) writeBridgeResponse(
	response http.ResponseWriter,
	bridgeResponse bridge.ExecuteResponse,
	traceID string,
) {
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
			return
		}
		s.metrics.RecordBridgeSuccess()
		writeRawJSON(response, bridgeResponse.StatusCode, body)
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
			return
		}
		writeRawJSON(response, bridgeResponse.StatusCode, body)
	case "bridge_invalid_request":
		setOutcome(response, "supervisor_bridge_invalid_request")
		writeError(
			response,
			http.StatusBadGateway,
			"supervisor_bridge_invalid_request",
			"Supervisor Python bridge rejected the projected request payload.",
			false,
		)
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

func mapFromAny(value any) map[string]any {
	record, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	return record
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
	case outcome == "transport_saturated":
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
