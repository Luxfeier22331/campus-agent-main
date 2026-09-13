package httpapi

import (
	"encoding/json"
	"errors"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/memoryruntime"
	"net/http"
	"strings"
)

func (s *Server) handlePersonalMemoryRead(response http.ResponseWriter, request *http.Request, detail bool) {
	if !s.internalWorkerAuthorized(request) {
		writeError(response, http.StatusUnauthorized, "unauthorized", "Internal worker authorization failed.", false)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		return
	}
	var query memoryruntime.MemoryQuery
	if json.Unmarshal(body, &query) != nil || strings.TrimSpace(query.TenantID) == "" || strings.TrimSpace(query.OwnerUserID) == "" || query.OwnerGeneration < 1 ||
		(detail && query.MemoryID == "") || (!detail && (query.Limit < 1 || query.Limit > 100 || query.Offset < 0)) ||
		(query.Kind != "" && query.Kind != "fact" && query.Kind != "experience" && query.Kind != "summary") ||
		(query.State != "" && query.State != "active" && query.State != "inactive") {
		writeError(response, http.StatusBadRequest, "invalid_request", "Memory query is invalid.", false)
		return
	}
	if s.personalMemoryReader == nil {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_unavailable", "Personal memory is unavailable.", true)
		return
	}
	var result any
	var err error
	if detail {
		result, err = s.personalMemoryReader.GetMemory(request.Context(), query)
	} else {
		result, err = s.personalMemoryReader.ListMemories(request.Context(), query)
	}
	if errors.Is(err, memoryruntime.ErrMemoryNotFound) {
		writeError(response, http.StatusNotFound, "profile_memory_item_not_found", "Memory not found.", false)
		return
	}
	if err != nil {
		writeError(response, http.StatusServiceUnavailable, "personal_memory_read_failed", "Personal memory could not be read.", true)
		return
	}
	writeJSON(response, http.StatusOK, result)
}
