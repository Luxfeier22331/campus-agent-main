package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

func (s *Server) handleToolReadModel(
	response http.ResponseWriter,
	request *http.Request,
	tool string,
) {
	if !s.toolReadModelAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid tool read model auth.", false)
		s.metrics.RecordToolReadModel(tool, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		s.metrics.RecordToolReadModel(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.ToolReadModelTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	var result toolreadmodel.Response
	switch tool {
	case toolreadmodel.ToolTransportScheduleLookup:
		result = s.toolReadModel.LookupTransportSchedule(ctx, body)
	default:
		result = toolreadmodel.Response{
			StatusCode: http.StatusNotFound,
			Outcome:    "not_found",
			Body: map[string]any{
				"error": map[string]any{
					"code":      "not_found",
					"message":   "Tool read model tool not found.",
					"retryable": false,
				},
			},
		}
	}
	setOutcome(response, result.Outcome)
	s.metrics.RecordToolReadModel(tool, result.Outcome, result.StatusCode)
	writeJSON(response, result.StatusCode, result.Body)
}
