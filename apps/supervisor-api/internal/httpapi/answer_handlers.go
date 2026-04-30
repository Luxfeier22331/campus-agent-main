package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
)

func (s *Server) handleAnswer(response http.ResponseWriter, request *http.Request) {
	startedAt := time.Now()
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	executionRequest, httpErr := execution.ParseAnswerRequestWithIntentPolicy(
		body,
		lowerHeaders(request.Header),
		s.config,
		s.intentPolicy,
		s.intentPolicyErr,
	)
	if httpErr != nil {
		setOutcome(response, httpErr.Code)
		writeExecutionError(response, httpErr)
		return
	}
	setTraceID(response, executionRequest.TraceID)
	s.recordRuntimeDecision(executionRequest)
	if s.rejectClosedStructuredRuntime(response, request.Context(), executionRequest, time.Since(startedAt)) {
		return
	}
	if s.handleDirectTerminalAnswer(response, request, executionRequest, startedAt) {
		return
	}
	if s.handleDirectStructuredAnswer(response, request, executionRequest, startedAt) {
		return
	}

	if s.rejectBridgeNotConfigured(response, request.Context(), executionRequest, startedAt) {
		return
	}

	runResult := s.runBridgeExecution(
		request.Context(),
		executionRequest,
		startedAt,
		executionModeAnswer,
		nil,
	)
	if runResult.Terminal != nil {
		setOutcome(response, runResult.Terminal.Outcome)
		if runResult.Terminal.Code == "client_canceled" {
			return
		}
		s.writeTerminalError(response, *runResult.Terminal)
		return
	}
	writeOutcome := s.writeBridgeResponse(
		response,
		runResult.BridgeResponse,
		executionRequest,
		runResult.BridgeRunState,
	)
	s.recordBridgeWriteOutcome(
		runResult.RequestContext,
		executionRequest,
		startedAt,
		runResult.BridgeDuration,
		runResult.QueueWait,
		executionModeAnswer,
		writeOutcome,
	)
	runResult.Complete(writeOutcome.State)
}

func (s *Server) handleAnswerStream(response http.ResponseWriter, request *http.Request) {
	startedAt := time.Now()
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	executionRequest, httpErr := execution.ParseAnswerRequestWithIntentPolicy(
		body,
		lowerHeaders(request.Header),
		s.config,
		s.intentPolicy,
		s.intentPolicyErr,
	)
	if httpErr != nil {
		setOutcome(response, httpErr.Code)
		writeExecutionError(response, httpErr)
		return
	}
	setTraceID(response, executionRequest.TraceID)
	s.recordRuntimeDecision(executionRequest)
	startSSE(response)
	emitSSE(response, "execution.started", streamPayload{
		RequestID: executionRequest.RequestID,
		TraceID:   executionRequest.TraceID,
		EventType: "execution.started",
		Status:    "started",
		Outcome:   "accepted",
	})
	if s.rejectClosedStructuredRuntimeStream(response, request.Context(), executionRequest, time.Since(startedAt)) {
		return
	}
	if s.handleDirectTerminalAnswerStream(response, request, executionRequest, startedAt) {
		return
	}
	if s.handleDirectStructuredAnswerStream(response, request, executionRequest, startedAt) {
		return
	}

	if s.rejectBridgeNotConfiguredStream(response, request.Context(), executionRequest, startedAt) {
		return
	}

	runResult := s.runBridgeExecution(
		request.Context(),
		executionRequest,
		startedAt,
		executionModeAnswerStream,
		func(event executionRunnerEvent) {
			emitSSE(response, event.Name, event.Payload)
		},
	)
	if runResult.Terminal != nil {
		setOutcome(response, runResult.Terminal.Outcome)
		emitSSE(response, terminalStreamEventName(runResult.Terminal.State), streamPayload{
			RequestID:  executionRequest.RequestID,
			TraceID:    executionRequest.TraceID,
			EventType:  terminalStreamEventName(runResult.Terminal.State),
			Status:     streamStatusForLifecycle(runResult.Terminal.State),
			Outcome:    runResult.Terminal.Code,
			HTTPStatus: runResult.Terminal.StatusCode,
			Retryable:  runResult.Terminal.Retryable,
			Error: &errorInfo{
				Code:      runResult.Terminal.Code,
				Message:   runResult.Terminal.Message,
				Retryable: runResult.Terminal.Retryable,
			},
			OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
		})
		return
	}

	payload, outcome := s.streamBridgePayload(
		runResult.BridgeResponse,
		executionRequest,
		runResult.BridgeRunState,
	)
	payload.RequestID = executionRequest.RequestID
	if payload.TraceID == "" {
		payload.TraceID = executionRequest.TraceID
	}
	setOutcome(response, outcome.Outcome)
	s.recordBridgeWriteOutcome(
		runResult.RequestContext,
		executionRequest,
		startedAt,
		runResult.BridgeDuration,
		runResult.QueueWait,
		executionModeAnswerStream,
		outcome,
	)
	runResult.Complete(outcome.State)
	emitSSE(response, terminalStreamEventName(outcome.State), payload)
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

func (s *Server) rejectClosedStructuredRuntime(
	response http.ResponseWriter,
	ctx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	duration time.Duration,
) bool {
	if !s.structuredRuntimeGateApplies(executionRequest.RequestedCapability) {
		return false
	}
	if s.config.CapabilityOpen(executionRequest.RequestedCapability) {
		s.metrics.RecordCapabilityGate(
			executionRequest.RequestedCapability,
			"structured_runtime",
			"open",
		)
		return false
	}
	s.metrics.RecordCapabilityGate(
		executionRequest.RequestedCapability,
		"structured_runtime",
		"closed",
	)
	setOutcome(response, "structured_runtime_closed")
	s.telemetry.Emit(ctx, runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer.admission_rejected",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Decision:            "structured_runtime_closed",
		Outcome:             "structured_runtime_closed",
		FailureCode:         "structured_runtime_closed",
		StatusCode:          http.StatusServiceUnavailable,
		Duration:            duration,
	}, executionRequest))
	s.emitExecutionAudit(ctx, runtimeAuditEvent(executionaudit.Event{
		Decision:            "structured_runtime_closed",
		Duration:            duration,
		EventType:           "execution.admission_rejected",
		FailureKind:         "structured_runtime_closed",
		HTTPStatus:          http.StatusServiceUnavailable,
		Lane:                executionRequest.Lane,
		RequestID:           executionRequest.RequestID,
		RequestedCapability: executionRequest.RequestedCapability,
		Retryable:           false,
		TraceID:             executionRequest.TraceID,
	}, executionRequest))
	writeRuntimeFailure(
		response,
		http.StatusServiceUnavailable,
		"structured_runtime_closed",
		"Structured runtime capability is not opened for product serving.",
		false,
		executionRequest.RequestID,
		executionRequest.TraceID,
		"structured_runtime_closed",
	)
	return true
}

func (s *Server) rejectClosedStructuredRuntimeStream(
	response http.ResponseWriter,
	ctx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	duration time.Duration,
) bool {
	if !s.structuredRuntimeGateApplies(executionRequest.RequestedCapability) {
		return false
	}
	if s.config.CapabilityOpen(executionRequest.RequestedCapability) {
		s.metrics.RecordCapabilityGate(
			executionRequest.RequestedCapability,
			"structured_runtime",
			"open",
		)
		return false
	}
	s.metrics.RecordCapabilityGate(
		executionRequest.RequestedCapability,
		"structured_runtime",
		"closed",
	)
	setOutcome(response, "structured_runtime_closed")
	s.telemetry.Emit(ctx, runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer_stream.admission_rejected",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Decision:            "structured_runtime_closed",
		Outcome:             "structured_runtime_closed",
		FailureCode:         "structured_runtime_closed",
		StatusCode:          http.StatusServiceUnavailable,
		Duration:            duration,
	}, executionRequest))
	s.emitExecutionAudit(ctx, runtimeAuditEvent(executionaudit.Event{
		Decision:            "structured_runtime_closed",
		Duration:            duration,
		EventType:           "execution.admission_rejected",
		FailureKind:         "structured_runtime_closed",
		HTTPStatus:          http.StatusServiceUnavailable,
		Lane:                executionRequest.Lane,
		RequestID:           executionRequest.RequestID,
		RequestedCapability: executionRequest.RequestedCapability,
		Retryable:           false,
		TraceID:             executionRequest.TraceID,
	}, executionRequest))
	emitSSE(response, "execution.failed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.failed",
		Status:     "failed",
		Outcome:    "structured_runtime_closed",
		HTTPStatus: http.StatusServiceUnavailable,
		Retryable:  false,
		Error: &errorInfo{
			Code:      "structured_runtime_closed",
			Message:   "Structured runtime capability is not opened for product serving.",
			Retryable: false,
		},
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	return true
}

func (s *Server) rejectBridgeNotConfigured(
	response http.ResponseWriter,
	ctx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	if s.bridge != nil && s.bridge.Configured() {
		return false
	}
	setOutcome(response, "bridge_not_configured")
	s.telemetry.Emit(ctx, runtimeTelemetryEvent(telemetry.Event{
		Name:                string(executionModeAnswer) + ".failed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "bridge_not_configured",
		FailureCode:         "bridge_not_configured",
		StatusCode:          http.StatusServiceUnavailable,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	s.emitExecutionAudit(ctx, runtimeAuditEvent(executionaudit.Event{
		Duration:            time.Since(startedAt),
		EventType:           "execution.bridge_failed",
		FailureKind:         "bridge_not_configured",
		HTTPStatus:          http.StatusServiceUnavailable,
		Lane:                executionRequest.Lane,
		RequestID:           executionRequest.RequestID,
		RequestedCapability: executionRequest.RequestedCapability,
		Retryable:           true,
		TraceID:             executionRequest.TraceID,
	}, executionRequest))
	writeError(
		response,
		http.StatusServiceUnavailable,
		"bridge_not_configured",
		"Supervisor Python bridge is not configured.",
		true,
	)
	return true
}

func (s *Server) rejectBridgeNotConfiguredStream(
	response http.ResponseWriter,
	ctx context.Context,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	if s.bridge != nil && s.bridge.Configured() {
		return false
	}
	setOutcome(response, "bridge_not_configured")
	s.telemetry.Emit(ctx, runtimeTelemetryEvent(telemetry.Event{
		Name:                string(executionModeAnswerStream) + ".failed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "bridge_not_configured",
		FailureCode:         "bridge_not_configured",
		StatusCode:          http.StatusServiceUnavailable,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	s.emitExecutionAudit(ctx, runtimeAuditEvent(executionaudit.Event{
		Duration:            time.Since(startedAt),
		EventType:           "execution.bridge_failed",
		FailureKind:         "bridge_not_configured",
		HTTPStatus:          http.StatusServiceUnavailable,
		Lane:                executionRequest.Lane,
		RequestID:           executionRequest.RequestID,
		RequestedCapability: executionRequest.RequestedCapability,
		Retryable:           true,
		TraceID:             executionRequest.TraceID,
	}, executionRequest))
	emitSSE(response, "execution.failed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.failed",
		Status:     "failed",
		Outcome:    "bridge_not_configured",
		HTTPStatus: http.StatusServiceUnavailable,
		Retryable:  true,
		Error:      &errorInfo{Code: "bridge_not_configured", Message: "Supervisor Python bridge is not configured.", Retryable: true},
		OccurredAt: time.Now().UTC().Format(time.RFC3339Nano),
	})
	return true
}
