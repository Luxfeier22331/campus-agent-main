//go:build retired_bridge_serving

package httpapi

import (
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func (s *Server) handleDirectTerminalAnswer(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	if len(executionRequest.TerminalEnvelope) == 0 {
		return false
	}
	executionResponse := terminalExecutionResponse(
		executionRequest.TerminalEnvelope,
		executionRequest.TraceID,
		finalizerContextFromExecutionRequest(executionRequest, "terminal"),
	)
	setOutcome(response, "execution_response")
	if err := s.emitTelemetry(request.Context(), s.runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "execution_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest)); err != nil {
		s.writeTelemetryFailure(response, executionRequest.RequestID, executionRequest.TraceID)
		return true
	}
	writeJSON(response, http.StatusOK, executionResponse)
	return true
}

func (s *Server) handleDirectTerminalAnswerStream(
	response http.ResponseWriter,
	request *http.Request,
	executionRequest execution.AnswerExecutionRequest,
	startedAt time.Time,
) bool {
	if len(executionRequest.TerminalEnvelope) == 0 {
		return false
	}
	executionResponse := terminalExecutionResponse(
		executionRequest.TerminalEnvelope,
		executionRequest.TraceID,
		finalizerContextFromExecutionRequest(executionRequest, "terminal"),
	)
	setOutcome(response, "execution_response")
	if err := s.emitTelemetry(request.Context(), s.runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer_stream.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "execution_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest)); err != nil {
		emitStructuredRuntimeStreamFailure(
			response,
			executionRequest,
			http.StatusServiceUnavailable,
			"telemetry_delivery_failed",
			"Execution telemetry delivery failed.",
			true,
		)
		return true
	}
	emitSSE(response, "execution.completed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.completed",
		Status:     streamStatusForLifecycle(lifecycle.StateCompleted),
		Outcome:    "execution_response",
		HTTPStatus: http.StatusOK,
		Response:   executionResponse,
	})
	return true
}

func terminalExecutionResponse(
	envelope map[string]any,
	traceID string,
	context executionFinalizerContext,
) map[string]any {
	response := make(map[string]any, len(envelope)+2)
	for key, value := range envelope {
		response[key] = value
	}
	if _, exists := response["result"]; !exists {
		response["result"] = nil
	}
	if _, exists := response["error"]; !exists {
		response["error"] = nil
	}
	if _, exists := response["workflow_trace_summary"]; !exists {
		target, _ := response["selected_capability"].(string)
		status, _ := response["status"].(string)
		result, _ := response["result"].(map[string]any)
		response["workflow_trace_summary"] = buildWorkflowTraceSummary(
			context,
			target,
			status,
			result,
			nil,
		)
	}
	response["trace_id"] = traceID
	return response
}
