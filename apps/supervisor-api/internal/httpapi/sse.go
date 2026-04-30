package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/admission"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/lifecycle"
)

type streamPayload struct {
	RequestID  string     `json:"request_id"`
	TraceID    string     `json:"trace_id"`
	EventType  string     `json:"event_type"`
	OccurredAt string     `json:"occurred_at"`
	Status     string     `json:"status"`
	Outcome    string     `json:"outcome,omitempty"`
	Retryable  bool       `json:"retryable"`
	HTTPStatus int        `json:"http_status,omitempty"`
	Error      *errorInfo `json:"error,omitempty"`
	Response   any        `json:"response,omitempty"`
}

func startSSE(response http.ResponseWriter) {
	header := response.Header()
	header.Set("content-type", "text/event-stream; charset=utf-8")
	header.Set("cache-control", "no-cache")
	header.Set("x-accel-buffering", "no")
	response.WriteHeader(http.StatusOK)
}

func emitSSE(response http.ResponseWriter, event string, payload streamPayload) {
	if payload.EventType == "" {
		payload.EventType = event
	}
	if payload.OccurredAt == "" {
		payload.OccurredAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	_, _ = response.Write([]byte("event: " + event + "\n"))
	_, _ = response.Write([]byte("data: "))
	_, _ = response.Write(raw)
	_, _ = response.Write([]byte("\n\n"))
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
}

func terminalStreamEventName(state lifecycle.State) string {
	switch state {
	case lifecycle.StateCompleted:
		return "execution.completed"
	case lifecycle.StateCanceled, lifecycle.StateClientCanceled:
		return "execution.cancelled"
	default:
		return "execution.failed"
	}
}

func streamStatusForLifecycle(state lifecycle.State) string {
	switch state {
	case lifecycle.StateCompleted:
		return "completed"
	case lifecycle.StateCanceled, lifecycle.StateClientCanceled:
		return "cancelled"
	case lifecycle.StateTimedOut:
		return "timed_out"
	default:
		return "failed"
	}
}

func admissionErrorForStream(decision admission.Decision, executionCanceled bool) (string, string, bool) {
	switch decision {
	case admission.DecisionQueueFull:
		return "transport_queue_full", "Supervisor execution admission queue is full.", true
	case admission.DecisionLaneQueueFull:
		return "transport_lane_queue_full", "Supervisor execution admission lane queue is full.", true
	case admission.DecisionQueueTimeout:
		return "transport_queue_timeout", "Supervisor execution admission queue wait timed out.", true
	case admission.DecisionLaneQueueTimeout:
		return "transport_lane_queue_timeout", "Supervisor execution admission lane queue wait timed out.", true
	case admission.DecisionDraining:
		return "transport_draining", "Supervisor execution runtime is draining.", true
	case admission.DecisionClientCanceled:
		if executionCanceled {
			return "execution_cancelled", "Supervisor execution was cancelled.", false
		}
		return "client_canceled", "Supervisor execution client disconnected.", false
	default:
		return "transport_admission_rejected", "Supervisor execution admission rejected the request.", true
	}
}

func (s *Server) streamBridgePayload(
	bridgeResponse bridge.ExecuteResponse,
	executionRequest execution.AnswerExecutionRequest,
	runState bridgeExecutionRunState,
) (streamPayload, bridgeWriteOutcome) {
	if !validBridgeResponseEnvelope(bridgeResponse) {
		return s.invalidBridgeStreamPayload("Supervisor Python bridge returned an invalid response envelope.")
	}
	switch bridgeResponse.Kind {
	case "agent_response":
		body, err := decodeJSONObject(bridgeResponse.Body)
		if err != nil {
			return s.invalidBridgeStreamPayload("Supervisor Python bridge returned an invalid response body.")
		}
		responseBody, err := finalizeAgentBridgeResponse(
			body,
			executionRequest.TraceID,
			finalizerContextFromExecutionRequest(executionRequest, "delegate", runState),
		)
		if err != nil {
			return s.invalidBridgeStreamPayload("Supervisor Python bridge returned an invalid agent response.")
		}
		statusCode := bridgeResponse.StatusCode
		if statusCode <= 0 {
			statusCode = http.StatusOK
		}
		s.metrics.RecordBridgeSuccess()
		return streamPayload{
				TraceID:    executionRequest.TraceID,
				EventType:  "execution.completed",
				Status:     "completed",
				Outcome:    "supervisor_response",
				HTTPStatus: statusCode,
				Response:   responseBody,
			}, bridgeWriteOutcome{
				State:          lifecycle.StateCompleted,
				Outcome:        "supervisor_response",
				StatusCode:     statusCode,
				CircuitSuccess: true,
			}
	case "supervisor_error":
		body, err := decodeJSONObject(bridgeResponse.Body)
		if err != nil {
			return s.invalidBridgeStreamPayload("Supervisor Python bridge returned an invalid response body.")
		}
		errInfo := errorInfoFromBridgeBody(body, "supervisor_error", "Supervisor Python bridge returned an error.", true)
		statusCode := bridgeResponse.StatusCode
		if errInfo.Code == "execution_cancelled" {
			if statusCode <= 0 {
				statusCode = statusClientClosedRequest
			}
			return streamPayload{
					TraceID:    executionRequest.TraceID,
					EventType:  "execution.cancelled",
					Status:     "cancelled",
					Outcome:    "execution_cancelled",
					HTTPStatus: statusCode,
					Error:      errInfo,
					Retryable:  errInfo.Retryable,
				}, bridgeWriteOutcome{
					State:          lifecycle.StateCanceled,
					Outcome:        "execution_cancelled",
					StatusCode:     statusCode,
					CircuitSuccess: true,
				}
		}
		if statusCode <= 0 {
			statusCode = http.StatusBadGateway
		}
		return streamPayload{
				TraceID:    executionRequest.TraceID,
				EventType:  "execution.failed",
				Status:     "failed",
				Outcome:    "supervisor_error",
				HTTPStatus: statusCode,
				Error:      errInfo,
				Retryable:  errInfo.Retryable,
			}, bridgeWriteOutcome{
				State:          lifecycle.StateFailed,
				Outcome:        "supervisor_error",
				FailureKind:    "supervisor_error",
				StatusCode:     statusCode,
				CircuitSuccess: true,
			}
	case "bridge_invalid_request":
		return streamPayload{
				TraceID:    executionRequest.TraceID,
				EventType:  "execution.failed",
				Status:     "failed",
				Outcome:    "supervisor_bridge_invalid_request",
				HTTPStatus: http.StatusBadGateway,
				Error: &errorInfo{
					Code:      "supervisor_bridge_invalid_request",
					Message:   "Supervisor Python bridge rejected the projected request payload.",
					Retryable: false,
				},
			}, bridgeWriteOutcome{
				State:          lifecycle.StateFailed,
				Outcome:        "supervisor_bridge_invalid_request",
				FailureKind:    "invalid_request",
				StatusCode:     http.StatusBadGateway,
				CircuitSuccess: true,
			}
	default:
		return s.invalidBridgeStreamPayload("Supervisor Python bridge returned an invalid response envelope.")
	}
}

func (s *Server) invalidBridgeStreamPayload(message string) (streamPayload, bridgeWriteOutcome) {
	s.metrics.RecordBridgeFailure("invalid_response")
	return streamPayload{
			EventType:  "execution.failed",
			Status:     "failed",
			Outcome:    "supervisor_bridge_invalid_response",
			HTTPStatus: http.StatusBadGateway,
			Retryable:  true,
			Error: &errorInfo{
				Code:      "supervisor_bridge_invalid_response",
				Message:   message,
				Retryable: true,
			},
		}, bridgeWriteOutcome{
			State:          lifecycle.StateFailed,
			Outcome:        "supervisor_bridge_invalid_response",
			FailureKind:    "invalid_response",
			StatusCode:     http.StatusBadGateway,
			CircuitFailure: true,
		}
}

func errorInfoFromBridgeBody(
	body map[string]any,
	fallbackCode string,
	fallbackMessage string,
	fallbackRetryable bool,
) *errorInfo {
	errorBody, _ := body["error"].(map[string]any)
	code, _ := errorBody["code"].(string)
	message, _ := errorBody["message"].(string)
	retryable, ok := errorBody["retryable"].(bool)
	if strings.TrimSpace(code) == "" {
		code = fallbackCode
	}
	if strings.TrimSpace(message) == "" {
		message = fallbackMessage
	}
	if !ok {
		retryable = fallbackRetryable
	}
	return &errorInfo{
		Code:      strings.TrimSpace(code),
		Message:   strings.TrimSpace(message),
		Retryable: retryable,
	}
}
