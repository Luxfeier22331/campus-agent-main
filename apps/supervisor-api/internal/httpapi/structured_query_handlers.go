package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
)

func (s *Server) handleStructuredQuery(
	response http.ResponseWriter,
	request *http.Request,
	tool string,
) {
	if !s.structuredQueryAuthorized(request) {
		setOutcome(response, "unauthorized")
		writeError(response, http.StatusUnauthorized, "unauthorized", "Invalid structured query auth.", false)
		s.metrics.RecordStructuredQuery(tool, "unauthorized", http.StatusUnauthorized)
		return
	}
	body, ok := s.readJSONBody(response, request)
	if !ok {
		s.metrics.RecordStructuredQuery(tool, "invalid_request", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(
		request.Context(),
		time.Duration(s.config.StructuredQueryTimeoutMS)*time.Millisecond,
	)
	defer cancel()

	var result structuredquery.Response
	switch tool {
	case structuredquery.ToolServiceStatusLookup:
		result = s.structuredQuery.LookupServiceStatus(ctx, body)
	case structuredquery.ToolServiceGuideLookup:
		result = s.structuredQuery.LookupServiceGuide(ctx, body)
	case structuredquery.ToolTransportScheduleLookup:
		result = s.structuredQuery.LookupTransportSchedule(ctx, body)
	case structuredquery.ToolContactDirectoryLookup:
		result = s.structuredQuery.LookupContactDirectory(ctx, body)
	case structuredquery.ToolAcademicCalendarLookup:
		result = s.structuredQuery.LookupAcademicCalendar(ctx, body)
	case structuredquery.ToolCampusNoticeDiscover:
		result = s.structuredQuery.LookupCampusNoticeDiscover(ctx, body)
	case structuredquery.ToolCampusNoticeGet:
		result = s.structuredQuery.LookupCampusNoticeGet(ctx, body)
	default:
		result = structuredquery.Response{
			StatusCode: http.StatusNotFound,
			Outcome:    "not_found",
			Body: map[string]any{
				"error": map[string]any{
					"code":      "not_found",
					"message":   "Structured query tool not found.",
					"retryable": false,
				},
			},
		}
	}
	setOutcome(response, result.Outcome)
	s.metrics.RecordStructuredQuery(tool, result.Outcome, result.StatusCode)
	writeJSON(response, result.StatusCode, result.Body)
}
