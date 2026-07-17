package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
)

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
	startedAt := time.Now().UTC()
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.AppendConversationTurn(ctx, input)
	if err != nil {
		s.recordPersonalMemoryOperation("append", "failed", "profile_memory_append_failed", startedAt, 0, 0)
		setOutcome(response, "profile_memory_append_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_append_failed", err.Error(), true)
		return
	}
	s.recordPersonalMemoryOperation("append", result.Status, "none", startedAt, result.AppendedMessageCount, 0)
	setOutcome(response, "profile_memory_appended")
	writeJSON(response, http.StatusOK, result)
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
	startedAt := time.Now().UTC()
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.Recall(ctx, input)
	if err != nil {
		s.recordPersonalMemoryOperation("recall", "failed", "profile_memory_recall_failed", startedAt, 0, 0)
		setOutcome(response, "profile_memory_recall_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_recall_failed", err.Error(), true)
		return
	}
	s.recordPersonalMemoryOperation("recall", "completed", "none", startedAt, result.SelectedMemoryCount, result.SelectedMemoryChars)
	setOutcome(response, "profile_memory_recalled")
	writeJSON(response, http.StatusOK, result)
}

func (s *Server) handleProfileMemoryReflect(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var input memoryruntime.ReflectRequest
	if err := json.Unmarshal(body, &input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile memory reflect request is invalid.", false)
		return
	}
	if err := memoryruntime.ValidateReflectRequest(input); err != nil {
		setOutcome(response, "invalid_request")
		writeError(response, http.StatusBadRequest, "invalid_request", err.Error(), false)
		return
	}
	executor, ok := s.profileMemoryExecutorForCommand(response)
	if !ok {
		return
	}
	startedAt := time.Now().UTC()
	ctx, cancel := contextWithPersonalMemoryTimeout(s, request)
	defer cancel()
	result, err := executor.Reflect(ctx, input)
	if err != nil {
		s.recordPersonalMemoryOperation("reflect", "failed", "profile_memory_reflect_failed", startedAt, 0, 0)
		setOutcome(response, "profile_memory_reflect_failed")
		writeError(response, http.StatusBadGateway, "profile_memory_reflect_failed", err.Error(), true)
		return
	}
	s.recordPersonalMemoryOperation("reflect", result.Status, "none", startedAt, len(result.BasedOnMemoryItems), len([]rune(result.Text)))
	setOutcome(response, "profile_memory_reflected")
	writeJSON(response, http.StatusOK, result)
}

func (s *Server) profileMemoryExecutorForCommand(response http.ResponseWriter) (personalMemoryExecutor, bool) {
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
		timeout = 90 * time.Second
	}
	return context.WithTimeout(request.Context(), timeout)
}
