package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/telemetry"
)

func (s *Server) handleDirectStructuredAnswer(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	handoff := executionRequest.StructuredHandoff
	if !s.shouldExecuteDirectStructuredHandoff(handoff) {
		return false
	}

	requestCtx, complete, ok := s.beginDirectStructuredExecution(
		response,
		request,
		executionRequest,
		startedAt,
	)
	if !ok {
		return true
	}
	defer complete(lifecycle.StateCompleted)

	ctx, cancel := context.WithTimeout(
		requestCtx,
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	rawPayload, err := structuredQueryPayload(handoff, executionRequest.NoticeAccessContext)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_payload")
		writeError(
			response,
			http.StatusBadGateway,
			"structured_runtime_invalid_payload",
			"Go structured runtime payload could not be encoded.",
			false,
		)
		return true
	}

	result := s.executeStructuredRuntime(ctx, handoff.PayloadKind, rawPayload)
	s.metrics.RecordStructuredQuery(handoff.PayloadKind, result.Outcome, result.StatusCode)
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_error")
		writeError(
			response,
			http.StatusBadGateway,
			"structured_runtime_error",
			"Go structured runtime returned an invalid response.",
			true,
		)
		return true
	}

	resultBody, err := structuredResultMap(result.Body)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_response")
		writeError(
			response,
			http.StatusBadGateway,
			"structured_runtime_invalid_response",
			"Go structured runtime response could not be encoded.",
			true,
		)
		return true
	}

	supervisorResponse := shapeStructuredSupervisorResponse(
		handoff.Target,
		handoff.PayloadKind,
		resultBody,
		executionRequest.TraceID,
		finalizerContextFromExecutionRequest(executionRequest, "direct"),
	)
	setOutcome(response, "supervisor_response")
	if err := s.emitTelemetry(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "supervisor_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest)); err != nil {
		complete(lifecycle.StateFailed)
		s.writeTelemetryFailure(response, executionRequest.RequestID, executionRequest.TraceID)
		return true
	}
	writeJSON(response, http.StatusOK, supervisorResponse)
	return true
}

func (s *Server) handleDirectStructuredAnswerStream(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	handoff := executionRequest.StructuredHandoff
	if !s.shouldExecuteDirectStructuredHandoff(handoff) {
		return false
	}

	requestCtx, complete, ok := s.beginDirectStructuredStreamExecution(
		response,
		request,
		executionRequest,
		startedAt,
	)
	if !ok {
		return true
	}
	defer complete(lifecycle.StateCompleted)

	ctx, cancel := context.WithTimeout(
		requestCtx,
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	rawPayload, err := structuredQueryPayload(handoff, executionRequest.NoticeAccessContext)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_payload")
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusBadGateway,
			"structured_runtime_invalid_payload",
			"Go structured runtime payload could not be encoded.",
			false,
		)
		return true
	}

	result := s.executeStructuredRuntime(ctx, handoff.PayloadKind, rawPayload)
	s.metrics.RecordStructuredQuery(handoff.PayloadKind, result.Outcome, result.StatusCode)
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_error")
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusBadGateway,
			"structured_runtime_error",
			"Go structured runtime returned an invalid response.",
			true,
		)
		return true
	}

	resultBody, err := structuredResultMap(result.Body)
	if err != nil {
		complete(lifecycle.StateFailed)
		setOutcome(response, "structured_runtime_invalid_response")
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusBadGateway,
			"structured_runtime_invalid_response",
			"Go structured runtime response could not be encoded.",
			true,
		)
		return true
	}

	supervisorResponse := shapeStructuredSupervisorResponse(
		handoff.Target,
		handoff.PayloadKind,
		resultBody,
		executionRequest.TraceID,
		finalizerContextFromExecutionRequest(executionRequest, "direct"),
	)
	setOutcome(response, "supervisor_response")
	if err := s.emitTelemetry(requestCtx, runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer_stream.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "supervisor_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest)); err != nil {
		complete(lifecycle.StateFailed)
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusServiceUnavailable,
			"telemetry_delivery_failed",
			"Supervisor telemetry delivery failed.",
			true,
		)
		return true
	}
	emitSSE(response, "execution.completed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.completed",
		Status:     "completed",
		Outcome:    "supervisor_response",
		HTTPStatus: http.StatusOK,
		Response:   supervisorResponse,
	})
	return true
}
