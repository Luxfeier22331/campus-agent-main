package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

func (s *Server) handlePersonalMemoryUpsert(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var command memoryruntime.UpsertRequest
	if err := json.Unmarshal(body, &command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Personal memory upsert request is invalid.", false)
		return
	}
	command = normalizePersonalMemoryUpsertCommand(command)
	if err := memoryruntime.ValidateUpsertRequest(command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	result, err := s.upsertPersonalMemory(request.Context(), command)
	if err != nil {
		setOutcome(response, "personal_memory_index_failed")
		writeError(response, http.StatusBadGateway, "personal_memory_index_failed", err.Error(), true)
		return
	}
	setOutcome(response, "accepted")
	writeJSON(response, http.StatusAccepted, personalMemoryUpsertWire(result))
}

func (s *Server) handlePersonalMemoryDisable(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var command memoryruntime.DisableRequest
	if err := json.Unmarshal(body, &command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Personal memory disable request is invalid.", false)
		return
	}
	command.MemoryID = strings.TrimSpace(command.MemoryID)
	command.UserID = strings.TrimSpace(command.UserID)
	command.TenantID = strings.TrimSpace(command.TenantID)
	command.UpdatedAt = strings.TrimSpace(command.UpdatedAt)
	if err := memoryruntime.ValidateDisableRequest(command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	result, err := s.disablePersonalMemory(request.Context(), command)
	if err != nil {
		setOutcome(response, "personal_memory_index_failed")
		writeError(response, http.StatusBadGateway, "personal_memory_index_failed", err.Error(), true)
		return
	}
	setOutcome(response, "accepted")
	writeJSON(response, http.StatusAccepted, personalMemoryUpsertWire(result))
}

func (s *Server) handlePersonalMemoryOwnerDisable(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var command memoryruntime.DisableOwnerRequest
	if err := json.Unmarshal(body, &command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Personal memory owner disable request is invalid.", false)
		return
	}
	command.UserID = strings.TrimSpace(command.UserID)
	command.TenantID = strings.TrimSpace(command.TenantID)
	command.UpdatedAt = strings.TrimSpace(command.UpdatedAt)
	if err := memoryruntime.ValidateDisableOwnerRequest(command); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	result, err := s.disableOwnerPersonalMemory(request.Context(), command)
	if err != nil {
		setOutcome(response, "personal_memory_index_failed")
		writeError(response, http.StatusBadGateway, "personal_memory_index_failed", err.Error(), true)
		return
	}
	setOutcome(response, "accepted")
	writeJSON(response, http.StatusAccepted, personalMemoryOwnerDisableWire(result))
}

func normalizePersonalMemoryUpsertCommand(command memoryruntime.UpsertRequest) memoryruntime.UpsertRequest {
	command.MemoryID = strings.TrimSpace(command.MemoryID)
	command.UserID = strings.TrimSpace(command.UserID)
	command.TenantID = strings.TrimSpace(command.TenantID)
	command.MemoryType = strings.TrimSpace(command.MemoryType)
	command.Capability = strings.TrimSpace(command.Capability)
	command.Status = strings.TrimSpace(command.Status)
	command.Source = strings.TrimSpace(command.Source)
	command.CompactText = strings.TrimSpace(command.CompactText)
	command.UpdatedAt = strings.TrimSpace(command.UpdatedAt)
	return command
}

func personalMemoryUpsertWire(result memoryruntime.UpsertResult) map[string]any {
	return map[string]any{
		"memory_id":      result.MemoryID,
		"point_id":       result.PointID,
		"schema_version": result.SchemaVersion,
		"status":         result.Status,
		"updated_at":     result.UpdatedAt,
	}
}

func personalMemoryOwnerDisableWire(result memoryruntime.DisableOwnerResult) map[string]any {
	return map[string]any{
		"schema_version": result.SchemaVersion,
		"status":         result.Status,
		"updated_at":     result.UpdatedAt,
		"user_id":        result.UserID,
	}
}

func (s *Server) upsertPersonalMemory(
	ctx context.Context,
	request memoryruntime.UpsertRequest,
) (memoryruntime.UpsertResult, error) {
	if s.personalMemoryErr != nil {
		return memoryruntime.UpsertResult{}, s.personalMemoryErr
	}
	if s.personalMemoryExecutor == nil {
		return memoryruntime.UpsertResult{}, errors.New("personal memory executor is not configured")
	}
	return s.personalMemoryExecutor.Upsert(ctx, request)
}

func (s *Server) disablePersonalMemory(
	ctx context.Context,
	request memoryruntime.DisableRequest,
) (memoryruntime.UpsertResult, error) {
	if s.personalMemoryErr != nil {
		return memoryruntime.UpsertResult{}, s.personalMemoryErr
	}
	if s.personalMemoryExecutor == nil {
		return memoryruntime.UpsertResult{}, errors.New("personal memory executor is not configured")
	}
	return s.personalMemoryExecutor.Disable(ctx, request)
}

func (s *Server) disableOwnerPersonalMemory(
	ctx context.Context,
	request memoryruntime.DisableOwnerRequest,
) (memoryruntime.DisableOwnerResult, error) {
	if s.personalMemoryErr != nil {
		return memoryruntime.DisableOwnerResult{}, s.personalMemoryErr
	}
	if s.personalMemoryExecutor == nil {
		return memoryruntime.DisableOwnerResult{}, errors.New("personal memory executor is not configured")
	}
	return s.personalMemoryExecutor.DisableOwner(ctx, request)
}
