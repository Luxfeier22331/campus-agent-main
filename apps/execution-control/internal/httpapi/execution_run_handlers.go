package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/telemetry"
)

func (s *Server) handleExecutionRunCreate(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runService == nil || !s.runService.StoreConfigured() {
		writeError(
			response,
			http.StatusServiceUnavailable,
			"projection_store_not_configured",
			"Execution projection store is not configured.",
			true,
		)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	wire, err := contracts.DecodeExecutionRunCreateRequestWireJSON(body)
	if err != nil {
		writeError(
			response,
			http.StatusBadRequest,
			"invalid_request",
			"invalid execution run create request: "+err.Error(),
			false,
		)
		return
	}
	traceParent := telemetry.InjectExecutionTraceHeaders(request.Context(), "")["traceparent"]
	result, err := s.runService.CreateRun(
		request.Context(),
		executionapplication.CreateRunRequest{
			TraceParent: traceParent,
			Wire:        wire,
		},
	)
	if err != nil {
		if execution.IsDependencyNotReady(err) || execution.InputErrorIsRetryable(err) {
			writeError(
				response,
				http.StatusServiceUnavailable,
				"dependency_not_ready",
				"A required execution dependency is not ready.",
				true,
			)
			return
		}
		if executionapplication.IsRunCreatePreparationError(err) {
			writeError(response, http.StatusBadRequest, "execution_workflow_input_invalid", err.Error(), false)
			return
		}
		if errors.Is(err, execution.ErrOwnerDeleted) {
			writeError(response, http.StatusGone, "owner_deleted", "Owner has been deleted.", false)
			return
		}
		if errors.Is(err, execution.ErrOwnerDeletionNotDrained) {
			writeError(response, http.StatusConflict, "owner_deleting", "Owner deletion is in progress.", false)
			return
		}
		if errors.Is(err, execution.ErrConversationActiveRun) {
			writeError(
				response,
				http.StatusConflict,
				"conversation_active_run",
				"Conversation already has an active primary run.",
				true,
			)
			return
		}
		if errors.Is(err, execution.ErrDurableRunFingerprintConflict) {
			writeError(
				response,
				http.StatusConflict,
				"execution_run_fingerprint_conflict",
				"request_id is already bound to a different request fingerprint.",
				false,
			)
			return
		}
		writeError(response, http.StatusBadRequest, "execution_run_create_failed", err.Error(), false)
		return
	}
	writeJSON(response, http.StatusAccepted, durableRunResponse(result.Run))
}

func (s *Server) handleExecutionRunCancel(
	response http.ResponseWriter,
	request *http.Request,
	runID string,
) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.runService == nil || !s.runService.StoreConfigured() {
		writeError(
			response,
			http.StatusServiceUnavailable,
			"projection_store_not_configured",
			"Execution projection store is not configured.",
			true,
		)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	payload, err := decodeJSONObject(body)
	if err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "Cancel request body must be a JSON object.", false)
		return
	}
	runID = strings.TrimSpace(runID)
	requested, err := s.runService.RequestRunCancellation(
		request.Context(),
		executionapplication.RequestRunCancellationRequest{
			RequestID: runID,
			Reason:    optionalStringFromMap(payload, "reason"),
		},
	)
	if err != nil {
		if executionapplication.IsRunRequestValidationError(err) {
			writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
			return
		}
		if errors.Is(err, execution.ErrDurableRunNotFound) {
			writeError(response, http.StatusNotFound, "execution_run_not_found", "Execution run not found.", false)
			return
		}
		if errors.Is(err, execution.ErrDurableRunTerminalConflict) {
			writeError(response, http.StatusConflict, "execution_run_cancel_conflict", err.Error(), false)
			return
		}
		writeError(response, http.StatusInternalServerError, "execution_run_cancel_request_failed", err.Error(), true)
		return
	}
	writeJSON(response, http.StatusAccepted, durableRunResponse(requested))
}

func executionRequestIDFromPath(path string, suffix string) (string, bool) {
	const prefix = "/internal/execution/requests/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	if suffix != "" {
		if !strings.HasSuffix(rest, suffix) {
			return "", false
		}
		rest = strings.TrimSuffix(rest, suffix)
	}
	if strings.Contains(rest, "/") || strings.TrimSpace(rest) == "" {
		return "", false
	}
	return rest, true
}
