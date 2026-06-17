package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func (s *Server) handleProfileMemoryUpsert(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input memoryruntime.UpsertProfileMemoryItemRequest
	if err := json.Unmarshal(body, &input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile memory upsert request is invalid.", false)
		return
	}
	if err := memoryruntime.ValidateUpsertProfileMemoryItemRequest(input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	executor, ok := s.profileMemoryExecutorForCommand(response)
	if !ok {
		return
	}
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.UpsertProfileMemoryItem(ctx, input)
	if err != nil {
		setOutcome(response, "profile_memory_upsert_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_upsert_failed", err.Error(), true)
		return
	}
	setOutcome(response, "profile_memory_upserted")
	writeJSON(response, http.StatusAccepted, result)
}

func (s *Server) handleProfileMemoryAppend(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input memoryruntime.AppendConversationTurnRequest
	if err := json.Unmarshal(body, &input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile memory append request is invalid.", false)
		return
	}
	if err := memoryruntime.ValidateAppendConversationTurnRequest(input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	executor, ok := s.profileMemoryExecutorForCommand(response)
	if !ok {
		return
	}
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.AppendConversationTurn(ctx, input)
	if err != nil {
		setOutcome(response, "profile_memory_append_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_append_failed", err.Error(), true)
		return
	}
	setOutcome(response, "profile_memory_appended")
	writeJSON(response, http.StatusAccepted, result)
}

func (s *Server) handleProfileMemoryRecall(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input memoryruntime.RecallRequest
	if err := json.Unmarshal(body, &input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile memory recall request is invalid.", false)
		return
	}
	if err := memoryruntime.ValidateRecallRequest(input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	executor, ok := s.profileMemoryExecutorForCommand(response)
	if !ok {
		return
	}
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.Recall(ctx, input)
	if err != nil {
		setOutcome(response, "profile_memory_recall_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_recall_failed", err.Error(), true)
		return
	}
	bodyOut := map[string]any{
		"memory_context_items":  result.Items,
		"memory_ref":            result.MemoryRef,
		"payload_sha256":        result.PayloadSHA256,
		"schema_version":        result.SchemaVersion,
		"selected_memory_chars": result.SelectedMemoryChars,
		"selected_memory_count": result.SelectedMemoryCount,
		"status":                "completed",
		"user_id":               result.UserID,
	}
	setOutcome(response, "profile_memory_recalled")
	writeJSON(response, http.StatusAccepted, bodyOut)
}

func (s *Server) handleProfileMemoryItemDisable(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input memoryruntime.DisableProfileMemoryItemRequest
	if err := json.Unmarshal(body, &input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile memory disable request is invalid.", false)
		return
	}
	if err := memoryruntime.ValidateDisableProfileMemoryItemRequest(input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	executor, ok := s.profileMemoryExecutorForCommand(response)
	if !ok {
		return
	}
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.DeleteProfileMemoryItem(ctx, input)
	if err != nil {
		setOutcome(response, "profile_memory_disable_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_disable_failed", err.Error(), true)
		return
	}
	setOutcome(response, "profile_memory_disabled")
	writeJSON(response, http.StatusAccepted, result)
}

func (s *Server) handleProfileMemoryOwnerDisable(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input memoryruntime.DisableProfileMemoryOwnerRequest
	if err := json.Unmarshal(body, &input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile memory owner disable request is invalid.", false)
		return
	}
	if err := memoryruntime.ValidateDisableProfileMemoryOwnerRequest(input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	executor, ok := s.profileMemoryExecutorForCommand(response)
	if !ok {
		return
	}
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.DeleteProfileMemoryOwner(ctx, input)
	if err != nil {
		setOutcome(response, "profile_memory_owner_disable_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_owner_disable_failed", err.Error(), true)
		return
	}
	setOutcome(response, "profile_memory_owner_disabled")
	writeJSON(response, http.StatusAccepted, result)
}

func (s *Server) profileMemoryExecutorForCommand(
	response http.ResponseWriter,
) (personalMemoryExecutor, bool) {
	if s.personalMemoryErr != nil {
		setOutcome(response, "profile_memory_not_configured")
		writeError(response, http.StatusServiceUnavailable, "profile_memory_not_configured", s.personalMemoryErr.Error(), true)
		return nil, false
	}
	if s.personalMemoryExecutor == nil {
		setOutcome(response, "profile_memory_not_configured")
		writeError(response, http.StatusServiceUnavailable, "profile_memory_not_configured", "Personal memory executor is not configured.", true)
		return nil, false
	}
	return s.personalMemoryExecutor, true
}

func contextWithPersonalMemoryTimeout(s *Server, request *http.Request) (context.Context, context.CancelFunc) {
	timeout := time.Duration(s.config.PersonalMemoryTimeoutSeconds * float64(time.Second))
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return context.WithTimeout(request.Context(), timeout)
}
