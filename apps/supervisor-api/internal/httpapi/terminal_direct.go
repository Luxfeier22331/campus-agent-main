package httpapi

import (
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/telemetry"
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
	supervisorResponse := terminalSupervisorResponse(
		executionRequest.TerminalEnvelope,
		executionRequest.TraceID,
	)
	setOutcome(response, "supervisor_response")
	s.telemetry.Emit(request.Context(), runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "supervisor_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	writeJSON(response, http.StatusOK, supervisorResponse)
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
	supervisorResponse := terminalSupervisorResponse(
		executionRequest.TerminalEnvelope,
		executionRequest.TraceID,
	)
	setOutcome(response, "supervisor_response")
	s.telemetry.Emit(request.Context(), runtimeTelemetryEvent(telemetry.Event{
		Name:                "answer_stream.completed",
		RequestID:           executionRequest.RequestID,
		TraceID:             executionRequest.TraceID,
		Lane:                executionRequest.Lane,
		RequestedCapability: executionRequest.RequestedCapability,
		Outcome:             "supervisor_response",
		StatusCode:          http.StatusOK,
		Duration:            time.Since(startedAt),
	}, executionRequest))
	emitSSE(response, "execution.completed", streamPayload{
		RequestID:  executionRequest.RequestID,
		TraceID:    executionRequest.TraceID,
		EventType:  "execution.completed",
		Status:     streamStatusForLifecycle(lifecycle.StateCompleted),
		Outcome:    "supervisor_response",
		HTTPStatus: http.StatusOK,
		Response:   supervisorResponse,
	})
	return true
}

func terminalSupervisorResponse(envelope map[string]any, traceID string) map[string]any {
	response := make(map[string]any, len(envelope)+1)
	for key, value := range envelope {
		response[key] = value
	}
	response["trace_id"] = traceID
	return response
}
