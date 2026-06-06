package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/bridge"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/executionaudit"
	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/telemetry"
)

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
	if err := s.emitTelemetry(request.Context(), telemetry.Event{
		Name:               "execution.cancel_requested",
		RequestID:          result.RequestID,
		TraceID:            result.TraceID,
		Outcome:            result.Status,
		BridgeCancelStatus: bridgeCancelStatus,
	}); err != nil {
		s.writeTelemetryFailure(response, result.RequestID, result.TraceID)
		return
	}
	if err := s.emitExecutionAudit(request.Context(), executionaudit.Event{
		EventType:          "execution.cancel_requested",
		HTTPStatus:         http.StatusAccepted,
		RequestID:          result.RequestID,
		Retryable:          false,
		TraceID:            result.TraceID,
		BridgeCancelStatus: bridgeCancelStatus,
	}); err != nil {
		s.writeExecutionAuditFailure(response, result.RequestID, result.TraceID)
		return
	}
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
