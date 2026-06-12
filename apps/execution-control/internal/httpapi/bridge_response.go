//go:build retired_bridge_serving

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/lifecycle"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func (s *Server) emitTelemetry(ctx context.Context, event telemetry.Event) error {
	if s.telemetry == nil {
		return nil
	}
	if err := s.telemetry.Emit(ctx, event); err != nil {
		return fmt.Errorf("telemetry delivery failed: %w", err)
	}
	return nil
}

func (s *Server) writeTelemetryFailure(
	response http.ResponseWriter,
	requestID string,
	traceID string,
) {
	setOutcome(response, "telemetry_delivery_failed")
	writeRuntimeFailure(
		response,
		http.StatusServiceUnavailable,
		"telemetry_delivery_failed",
		"Execution telemetry delivery failed.",
		true,
		requestID,
		traceID,
		"telemetry_delivery_failed",
	)
}

func (s *Server) emitExecutionAudit(ctx context.Context, event executionaudit.Event) error {
	if s.executionAudit == nil {
		return nil
	}
	if err := s.executionAudit.Emit(ctx, event); err != nil {
		return fmt.Errorf("execution audit delivery failed: %w", err)
	}
	return nil
}

func (s *Server) writeExecutionAuditFailure(
	response http.ResponseWriter,
	requestID string,
	traceID string,
) {
	setOutcome(response, "execution_audit_delivery_failed")
	writeRuntimeFailure(
		response,
		http.StatusServiceUnavailable,
		"execution_audit_delivery_failed",
		"Execution audit delivery failed.",
		true,
		requestID,
		traceID,
		"execution_audit_delivery_failed",
	)
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
			"Execution was cancelled.",
			statusClientClosedRequest,
			"cancelled",
			lifecycle.StateCanceled
	}
	if errors.Is(err, context.Canceled) || errors.Is(requestCtx.Err(), context.Canceled) {
		return "client_canceled",
			"Execution client disconnected.",
			statusClientClosedRequest,
			"client_canceled",
			lifecycle.StateClientCanceled
	}
	if errors.Is(requestCtx.Err(), context.DeadlineExceeded) {
		return "transport_request_timeout",
			"Execution request timed out.",
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

type preparedBridgeResponse struct {
	Body       []byte
	Outcome    bridgeWriteOutcome
	StatusCode int
}

func (s *Server) prepareBridgeResponse(
	bridgeResponse bridge.ExecuteResponse,
	executionRequest execution.AnswerExecutionRequest,
	runState bridgeExecutionRunState,
	workflowRuns ...*execution.WorkflowRun,
) preparedBridgeResponse {
	if !validBridgeResponseEnvelope(bridgeResponse) {
		return s.invalidBridgePreparedResponse(
			"Supervisor Python bridge returned an invalid response envelope.",
		)
	}
	switch bridgeResponse.Kind {
	case "capability_response":
		body, err := decodeJSONObject(bridgeResponse.Body)
		if err != nil {
			return s.invalidBridgePreparedResponse(
				"Supervisor Python bridge returned an invalid response body.",
			)
		}
		executionResponse, err := finalizeAgentBridgeResponse(
			body,
			executionRequest.TraceID,
			finalizerContextWithWorkflowRun(
				finalizerContextFromExecutionRequest(executionRequest, workflowBranchForRequest(executionRequest), runState),
				firstWorkflowRun(workflowRuns),
			),
		)
		if err != nil {
			return s.invalidBridgePreparedResponse(
				"Supervisor Python bridge returned an invalid agent response.",
			)
		}
		rawExecutionResponse, err := json.Marshal(executionResponse)
		if err != nil {
			return s.invalidBridgePreparedResponse(
				"Supervisor Python bridge response could not be finalized.",
			)
		}
		s.metrics.RecordBridgeSuccess()
		return preparedBridgeResponse{
			Body:       rawExecutionResponse,
			StatusCode: bridgeResponse.StatusCode,
			Outcome: bridgeWriteOutcome{
				State:          lifecycle.StateCompleted,
				Outcome:        "execution_response",
				StatusCode:     bridgeResponse.StatusCode,
				CircuitSuccess: true,
			},
		}
	case "supervisor_error":
		if bridgeErrorCode(bridgeResponse.Body) == "execution_cancelled" {
			body, err := normalizeJSONObjectJSON(bridgeResponse.Body)
			if err != nil {
				return s.invalidBridgePreparedResponse(
					"Supervisor Python bridge returned an invalid response body.",
				)
			}
			statusCode := bridgeResponse.StatusCode
			if statusCode <= 0 {
				statusCode = statusClientClosedRequest
			}
			return preparedBridgeResponse{
				Body:       body,
				StatusCode: statusCode,
				Outcome: bridgeWriteOutcome{
					State:          lifecycle.StateCanceled,
					Outcome:        "execution_cancelled",
					StatusCode:     statusCode,
					CircuitSuccess: true,
				},
			}
		}
		body, err := normalizeJSONObjectJSON(bridgeResponse.Body)
		if err != nil {
			return s.invalidBridgePreparedResponse(
				"Supervisor Python bridge returned an invalid response body.",
			)
		}
		return preparedBridgeResponse{
			Body:       body,
			StatusCode: bridgeResponse.StatusCode,
			Outcome: bridgeWriteOutcome{
				State:          lifecycle.StateFailed,
				Outcome:        "supervisor_error",
				FailureKind:    "supervisor_error",
				StatusCode:     bridgeResponse.StatusCode,
				CircuitSuccess: true,
			},
		}
	case "bridge_invalid_request":
		return preparedBridgeResponse{
			Body: mustMarshalErrorBody(
				"supervisor_bridge_invalid_request",
				"Supervisor Python bridge rejected the projected request payload.",
				false,
			),
			StatusCode: http.StatusBadGateway,
			Outcome: bridgeWriteOutcome{
				State:          lifecycle.StateFailed,
				Outcome:        "supervisor_bridge_invalid_request",
				FailureKind:    "invalid_request",
				StatusCode:     http.StatusBadGateway,
				CircuitSuccess: true,
			},
		}
	default:
		return s.invalidBridgePreparedResponse(
			"Supervisor Python bridge returned an invalid response envelope.",
		)
	}
}

func writePreparedBridgeResponse(response http.ResponseWriter, prepared preparedBridgeResponse) {
	setOutcome(response, prepared.Outcome.Outcome)
	writeRawJSON(response, prepared.StatusCode, prepared.Body)
}

func mustMarshalErrorBody(code string, message string, retryable bool) []byte {
	body, err := json.Marshal(map[string]any{
		"error": errorInfo{
			Code:      code,
			Message:   message,
			Retryable: retryable,
		},
	})
	if err != nil {
		panic(err)
	}
	return body
}

func validBridgeResponseEnvelope(bridgeResponse bridge.ExecuteResponse) bool {
	switch bridgeResponse.Kind {
	case "capability_response":
		return bridgeResponse.StatusCode >= 200 && bridgeResponse.StatusCode < 300
	case "supervisor_error":
		return bridgeResponse.StatusCode >= 400 && bridgeResponse.StatusCode < 600
	case "bridge_invalid_request":
		return true
	default:
		return false
	}
}

func (s *Server) invalidBridgePreparedResponse(
	message string,
) preparedBridgeResponse {
	s.metrics.RecordBridgeFailure("invalid_response")
	return preparedBridgeResponse{
		Body: mustMarshalErrorBody(
			"supervisor_bridge_invalid_response",
			message,
			true,
		),
		StatusCode: http.StatusBadGateway,
		Outcome: bridgeWriteOutcome{
			State:          lifecycle.StateFailed,
			Outcome:        "supervisor_bridge_invalid_response",
			FailureKind:    "invalid_response",
			StatusCode:     http.StatusBadGateway,
			CircuitFailure: true,
		},
	}
}
