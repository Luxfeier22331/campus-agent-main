package httpapi

import (
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/memory-service/memoryruntime"
	"net/http"
)

func (s *Server) handlePersonalMemoryProfileGet(response http.ResponseWriter, request *http.Request) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var query memoryruntime.ProfileQuery
	if json.Unmarshal(body, &query) != nil || memoryruntime.ValidateProfileQuery(query) != nil {
		writeError(response, http.StatusBadRequest, "invalid_request", "Profile query is invalid.", false)
		return
	}
	if s.personalMemoryReader == nil {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_unavailable", "Personal memory is unavailable.", true)
		return
	}
	result, err := s.personalMemoryReader.GetProfile(request.Context(), query)
	if errors.Is(err, memoryruntime.ErrMemoryFenceConflict) {
		writeError(response, http.StatusConflict, "memory_lifecycle_blocked", "Memory lifecycle is not readable right now.", false)
		return
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_profile_failed", "Personal memory profile could not be read.", true)
		return
	}
	writeJSON(response, http.StatusOK, result)
}
