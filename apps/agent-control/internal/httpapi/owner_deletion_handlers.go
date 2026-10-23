package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/agent-control/internal/executionapplication"
)

func ownerUserIDFromDeletionPath(path string, suffix string) string {
	path = strings.TrimSuffix(path, suffix)
	return strings.TrimSpace(strings.TrimPrefix(path, "/internal/owners/"))
}

func (s *Server) handleOwnerDeletionBegin(
	response http.ResponseWriter,
	request *http.Request,
	ownerUserID string,
) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.ownerDeletion == nil || !s.ownerDeletion.StoreConfigured() {
		writeError(response, http.StatusServiceUnavailable, "projection_store_not_configured", "Execution projection store is not configured.", true)
		return
	}
	if ownerUserID == "" || strings.Contains(ownerUserID, "/") {
		writeError(response, http.StatusBadRequest, "invalid_request", "owner_user_id is required.", false)
		return
	}
	status, err := s.ownerDeletion.Begin(request.Context(), ownerUserID)
	if err != nil {
		writeError(response, http.StatusInternalServerError, "owner_deletion_begin_failed", err.Error(), true)
		return
	}
	writeOwnerDeletionStatus(response, http.StatusOK, status)
}

func (s *Server) handleOwnerDeletionFinalize(
	response http.ResponseWriter,
	request *http.Request,
	ownerUserID string,
) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid worker origin auth.", false)
		return
	}
	if s.ownerDeletion == nil || !s.ownerDeletion.StoreConfigured() {
		writeError(response, http.StatusServiceUnavailable, "projection_store_not_configured", "Execution projection store is not configured.", true)
		return
	}
	if ownerUserID == "" || strings.Contains(ownerUserID, "/") {
		writeError(response, http.StatusBadRequest, "invalid_request", "owner_user_id is required.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	decoded, err := decodeJSONObject(body)
	if err != nil || decoded["memory_erased"] != true {
		writeError(response, http.StatusBadRequest, "invalid_request", "memory_erased must be true.", false)
		return
	}
	status, err := s.ownerDeletion.Finalize(request.Context(), ownerUserID)
	if err != nil {
		var beginError *executionapplication.OwnerDeletionBeginError
		switch {
		case errors.As(err, &beginError):
			writeError(response, http.StatusInternalServerError, "owner_deletion_begin_failed", err.Error(), true)
		case errors.Is(err, execution.ErrOwnerDeletionNotDrained):
			writeOwnerDeletionStatus(response, http.StatusConflict, status)
		case errors.Is(err, execution.ErrOwnerDeletionNotStarted):
			writeError(response, http.StatusNotFound, "owner_deletion_not_started", "Owner deletion has not started.", false)
		default:
			writeError(response, http.StatusInternalServerError, "owner_deletion_finalize_failed", err.Error(), true)
		}
		return
	}
	writeOwnerDeletionStatus(response, http.StatusOK, status)
}

func writeOwnerDeletionStatus(response http.ResponseWriter, statusCode int, status execution.OwnerDeletionStatus) {
	writeJSON(response, statusCode, map[string]any{
		"owner_user_id":    status.OwnerUserID,
		"state":            string(status.State),
		"active_run_count": status.ActiveRuns,
	})
}
