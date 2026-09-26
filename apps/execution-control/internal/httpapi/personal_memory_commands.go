package httpapi

import (
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/executionapplication"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"net/http"
	"strings"
	"time"
)

type personalMemoryCommandStatusRequest struct {
	CommandID string `json:"command_id"`
	TenantID  string `json:"tenant_id"`
	UserID    string `json:"user_id"`
}

func (s *Server) handlePersonalMemoryCommand(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var command memoryruntime.PersonalMemoryCommandRequest
	if err := json.Unmarshal(body, &command); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "Personal memory command is invalid.", false)
		return
	}
	if err := memoryruntime.ValidatePersonalMemoryCommandRequest(command); err != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	if s.temporalStarter == nil || s.temporalStarterErr != nil {
		writeError(response, http.StatusServiceUnavailable, "temporal_not_ready", "Temporal workflow admission is unavailable.", true)
		return
	}
	workflowID := "campus-agent.memory.command." + strings.TrimSpace(command.CommandID)
	if err := s.temporalStarter.StartPersonalMemoryCommandWorkflow(
		request.Context(),
		executionapplication.PersonalMemoryCommandInput{Command: command, WorkflowID: workflowID},
	); err != nil {
		writeError(response, http.StatusServiceUnavailable, "temporal_admission_failed", "Personal memory workflow admission failed.", true)
		return
	}
	writeJSON(response, http.StatusAccepted, map[string]any{})
}

func (s *Server) handlePersonalMemoryCommandStatus(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input personalMemoryCommandStatusRequest
	if err := json.Unmarshal(body, &input); err != nil || strings.TrimSpace(input.CommandID) == "" || strings.TrimSpace(input.TenantID) == "" || strings.TrimSpace(input.UserID) == "" {
		writeError(response, http.StatusBadRequest, "invalid_request", "Personal memory command status request is invalid.", false)
		return
	}
	if s.personalMemoryStateStore == nil || s.personalMemoryStateErr != nil {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_unavailable", "Personal memory state is unavailable.", true)
		return
	}
	ownerHash := memoryruntime.OwnerScopeHash(s.config.PersonalMemoryOwnerSalt, input.TenantID, input.UserID)
	receipt, err := s.personalMemoryStateStore.GetCommand(request.Context(), ownerHash, input.CommandID)
	if errors.Is(err, memoryruntime.ErrMemoryCommandNotFound) {
		writeError(response, http.StatusNotFound, "command_not_found", "Personal memory command was not found.", false)
		return
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_status_failed", "Personal memory command status is unavailable.", true)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"command_id":         receipt.CommandID,
		"error_code":         receipt.ErrorCode,
		"generation":         receipt.Generation,
		"kind":               receipt.Kind,
		"result_fingerprint": receipt.ResultFingerprint,
		"sequence":           receipt.Sequence,
		"stale":              memoryruntime.CommandReceiptStale(receipt, time.Now()),
		"status":             receipt.Status,
	})
}
