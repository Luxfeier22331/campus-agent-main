package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/structuredquery"
)

func isStructuredPayloadKind(payloadKind string) bool {
	switch payloadKind {
	case structuredquery.ToolServiceStatusLookup,
		structuredquery.ToolServiceGuideLookup,
		structuredquery.ToolTransportScheduleLookup,
		structuredquery.ToolContactDirectoryLookup,
		structuredquery.ToolCampusNoticeDiscover,
		structuredquery.ToolCampusNoticeGet:
		return true
	default:
		return false
	}
}

func structuredQueryPayload(
	handoff *execution.RuntimeHandoff,
	noticeAccessContext map[string]any,
) ([]byte, error) {
	if handoff.PayloadKind == structuredquery.ToolCampusNoticeDiscover ||
		handoff.PayloadKind == structuredquery.ToolCampusNoticeGet {
		return json.Marshal(map[string]any{
			"payload":        handoff.Payload,
			"access_context": noticeAccessContext,
		})
	}
	return json.Marshal(handoff.Payload)
}

func (s *Server) executeStructuredRuntime(
	ctx context.Context,
	payloadKind string,
	rawPayload []byte,
) structuredquery.Response {
	switch payloadKind {
	case structuredquery.ToolServiceStatusLookup:
		return s.structuredQuery.LookupServiceStatus(ctx, rawPayload)
	case structuredquery.ToolServiceGuideLookup:
		return s.structuredQuery.LookupServiceGuide(ctx, rawPayload)
	case structuredquery.ToolTransportScheduleLookup:
		return s.structuredQuery.LookupTransportSchedule(ctx, rawPayload)
	case structuredquery.ToolContactDirectoryLookup:
		return s.structuredQuery.LookupContactDirectory(ctx, rawPayload)
	case structuredquery.ToolCampusNoticeDiscover:
		return s.structuredQuery.LookupCampusNoticeDiscover(ctx, rawPayload)
	case structuredquery.ToolCampusNoticeGet:
		return s.structuredQuery.LookupCampusNoticeGet(ctx, rawPayload)
	default:
		return structuredquery.Response{
			StatusCode: http.StatusBadRequest,
			Outcome:    "invalid_request",
			Body: map[string]any{
				"error": map[string]any{
					"code":    "invalid_request",
					"message": "unsupported structured payload kind",
				},
			},
		}
	}
}

func structuredResultMap(body any) (map[string]any, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}
