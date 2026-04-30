package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
)

func (s *Server) emitExecutionAudit(ctx context.Context, event executionaudit.Event) {
	if s.executionAudit == nil {
		return
	}
	s.executionAudit.Emit(ctx, event)
}

func (s *Server) bridgeExecutionError(
	err error,
	requestCtx context.Context,
	bridgeCtx context.Context,
	requestID string,
) (string, string, int, string, lifecycle.State) {
	if s.lifecycle.Canceled(requestID) ||
		errors.Is(context.Cause(requestCtx), lifecycle.ErrExecutionCanceled) ||
		errors.Is(context.Cause(bridgeCtx), lifecycle.ErrExecutionCanceled) {
		return "execution_cancelled",
			"Supervisor execution was cancelled.",
			statusClientClosedRequest,
			"cancelled",
			lifecycle.StateCanceled
	}
	if errors.Is(err, context.Canceled) || errors.Is(requestCtx.Err(), context.Canceled) {
		return "client_canceled",
			"Supervisor execution client disconnected.",
			statusClientClosedRequest,
			"client_canceled",
			lifecycle.StateClientCanceled
	}
	if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
		return "transport_request_timeout",
			"Supervisor execution request timed out.",
			http.StatusGatewayTimeout,
			"request_timeout",
			lifecycle.StateTimedOut
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(bridgeCtx.Err(), context.DeadlineExceeded) {
		return "supervisor_bridge_timeout",
			"Supervisor Python bridge timed out.",
			http.StatusGatewayTimeout,
			"timeout",
			lifecycle.StateTimedOut
	}
	if errors.Is(err, bridge.ErrResponseTooLarge) {
		return "supervisor_bridge_invalid_response",
			"Supervisor Python bridge response exceeded the configured size limit.",
			http.StatusBadGateway,
			"invalid_response",
			lifecycle.StateFailed
	}
	return "supervisor_bridge_unavailable",
		"Supervisor Python bridge is unavailable.",
		http.StatusBadGateway,
		"unavailable",
		lifecycle.StateFailed
}

func auditEventTypeForBridgeFailure(state lifecycle.State) string {
	switch state {
	case lifecycle.StateCanceled:
		return "execution.cancelled"
	case lifecycle.StateTimedOut:
		return "execution.timed_out"
	default:
		return "execution.bridge_failed"
	}
}

func (s *Server) writeBridgeResponse(
	response http.ResponseWriter,
	bridgeResponse bridge.ExecuteResponse,
	executionRequest execution.AnswerExecutionRequest,
	runState bridgeExecutionRunState,
) bridgeWriteOutcome {
	if !validBridgeResponseEnvelope(bridgeResponse) {
		return s.writeInvalidBridgeResponse(
			response,
			"Supervisor Python bridge returned an invalid response envelope.",
		)
	}
	switch bridgeResponse.Kind {
	case "agent_response":
		setOutcome(response, "supervisor_response")
		body, err := decodeJSONObject(bridgeResponse.Body)
		if err != nil {
			return s.writeInvalidBridgeResponse(
				response,
				"Supervisor Python bridge returned an invalid response body.",
			)
		}
		supervisorResponse, err := finalizeAgentBridgeResponse(
			body,
			executionRequest.TraceID,
			finalizerContextFromExecutionRequest(executionRequest, "delegate", runState),
		)
		if err != nil {
			return s.writeInvalidBridgeResponse(
				response,
				"Supervisor Python bridge returned an invalid agent response.",
			)
		}
		rawSupervisorResponse, err := json.Marshal(supervisorResponse)
		if err != nil {
			return s.writeInvalidBridgeResponse(
				response,
				"Supervisor Python bridge response could not be finalized.",
			)
		}
		s.metrics.RecordBridgeSuccess()
		writeRawJSON(response, bridgeResponse.StatusCode, rawSupervisorResponse)
		return bridgeWriteOutcome{
			State:          lifecycle.StateCompleted,
			Outcome:        "supervisor_response",
			StatusCode:     bridgeResponse.StatusCode,
			CircuitSuccess: true,
		}
	case "supervisor_error":
		if bridgeErrorCode(bridgeResponse.Body) == "execution_cancelled" {
			setOutcome(response, "execution_cancelled")
			body, err := normalizeJSONObjectJSON(bridgeResponse.Body)
			if err != nil {
				return s.writeInvalidBridgeResponse(
					response,
					"Supervisor Python bridge returned an invalid response body.",
				)
			}
			statusCode := bridgeResponse.StatusCode
			if statusCode <= 0 {
				statusCode = statusClientClosedRequest
			}
			writeRawJSON(response, statusCode, body)
			return bridgeWriteOutcome{
				State:          lifecycle.StateCanceled,
				Outcome:        "execution_cancelled",
				StatusCode:     statusCode,
				CircuitSuccess: true,
			}
		}
		setOutcome(response, "supervisor_error")
		body, err := normalizeJSONObjectJSON(bridgeResponse.Body)
		if err != nil {
			return s.writeInvalidBridgeResponse(
				response,
				"Supervisor Python bridge returned an invalid response body.",
			)
		}
		writeRawJSON(response, bridgeResponse.StatusCode, body)
		return bridgeWriteOutcome{
			State:          lifecycle.StateFailed,
			Outcome:        "supervisor_error",
			FailureKind:    "supervisor_error",
			StatusCode:     bridgeResponse.StatusCode,
			CircuitSuccess: true,
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
			State:          lifecycle.StateFailed,
			Outcome:        "supervisor_bridge_invalid_request",
			FailureKind:    "invalid_request",
			StatusCode:     http.StatusBadGateway,
			CircuitSuccess: true,
		}
	default:
		return s.writeInvalidBridgeResponse(
			response,
			"Supervisor Python bridge returned an invalid response envelope.",
		)
	}
}

func validBridgeResponseEnvelope(bridgeResponse bridge.ExecuteResponse) bool {
	switch bridgeResponse.Kind {
	case "agent_response":
		return bridgeResponse.StatusCode >= 200 && bridgeResponse.StatusCode < 300
	case "supervisor_error":
		return bridgeResponse.StatusCode >= 400 && bridgeResponse.StatusCode < 600
	case "bridge_invalid_request":
		return true
	default:
		return false
	}
}

func (s *Server) writeInvalidBridgeResponse(
	response http.ResponseWriter,
	message string,
) bridgeWriteOutcome {
	s.metrics.RecordBridgeFailure("invalid_response")
	setOutcome(response, "supervisor_bridge_invalid_response")
	writeError(
		response,
		http.StatusBadGateway,
		"supervisor_bridge_invalid_response",
		message,
		true,
	)
	return bridgeWriteOutcome{
		State:          lifecycle.StateFailed,
		Outcome:        "supervisor_bridge_invalid_response",
		FailureKind:    "invalid_response",
		StatusCode:     http.StatusBadGateway,
		CircuitFailure: true,
	}
}
