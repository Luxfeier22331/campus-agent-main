package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
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
	if s.runProjectionStore == nil || s.runProjectionStoreErr != nil {
		writeError(response, http.StatusServiceUnavailable, "projection_store_not_configured", "Execution projection store is not configured.", true)
		return
	}
	if ownerUserID == "" || strings.Contains(ownerUserID, "/") {
		writeError(response, http.StatusBadRequest, "invalid_request", "owner_user_id is required.", false)
		return
	}
	status, err := s.runProjectionStore.BeginOwnerDeletion(request.Context(), ownerUserID, time.Now().UTC().Truncate(time.Microsecond))
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
	if s.runProjectionStore == nil || s.runProjectionStoreErr != nil {
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
	status, err := s.runProjectionStore.BeginOwnerDeletion(request.Context(), ownerUserID, time.Now().UTC().Truncate(time.Microsecond))
	if err != nil {
		writeError(response, http.StatusInternalServerError, "owner_deletion_begin_failed", err.Error(), true)
		return
	}
	if status.State == execution.OwnerDeletionStateDeleted {
		writeOwnerDeletionStatus(response, http.StatusOK, status)
		return
	}
	if status.ActiveRuns > 0 {
		writeOwnerDeletionStatus(response, http.StatusConflict, status)
		return
	}
	if s.personalMemoryStateStore == nil || s.personalMemoryStateErr != nil || strings.TrimSpace(s.config.PersonalMemoryOwnerSalt) == "" {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_state_unavailable", "Personal memory state is not configured.", true)
		return
	}
	ownerHash := memoryruntime.OwnerScopeHash(s.config.PersonalMemoryOwnerSalt, "tenant-main", ownerUserID)
	if err := s.personalMemoryStateStore.MarkOwnerDeleted(request.Context(), ownerHash); err != nil {
		if errors.Is(err, memoryruntime.ErrMemoryOwnerNotDrained) {
			writeError(response, http.StatusConflict, "owner_deletion_not_drained", "Personal memory deletion has not drained.", true)
			return
		}
		writeError(response, http.StatusInternalServerError, "personal_memory_state_delete_failed", err.Error(), true)
		return
	}
	status, err = s.runProjectionStore.FinalizeOwnerDeletion(request.Context(), execution.OwnerDeletionFinalizeRequest{
		OwnerUserID: ownerUserID,
		Now:         time.Now().UTC().Truncate(time.Microsecond),
	})
	if err != nil {
		if errors.Is(err, execution.ErrOwnerDeletionNotDrained) {
			writeOwnerDeletionStatus(response, http.StatusConflict, status)
			return
		}
		if errors.Is(err, execution.ErrOwnerDeletionNotStarted) {
			writeError(response, http.StatusNotFound, "owner_deletion_not_started", "Owner deletion has not started.", false)
			return
		}
		writeError(response, http.StatusInternalServerError, "owner_deletion_finalize_failed", err.Error(), true)
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
