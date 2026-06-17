package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/structuredquery"
)

func isStructuredPayloadKind(payloadKind string) bool {
	switch payloadKind {
	case structuredquery.ToolServiceStatusLookup,
		structuredquery.ToolServiceGuideLookup,
		structuredquery.ToolTransportScheduleLookup,
		structuredquery.ToolContactDirectoryLookup,
		structuredquery.ToolAcademicCalendarLookup,
		structuredquery.ToolCampusNoticeDiscover,
		structuredquery.ToolCampusNoticeChangeSet,
		structuredquery.ToolCampusNoticeGet:
		return true
	default:
		return false
	}
}

func structuredQueryPayload(
	handoff *execution.RuntimeHandoff,
	accessContext map[string]any,
) ([]byte, error) {
	return json.Marshal(map[string]any{
		"payload":        handoff.Payload,
		"access_context": accessContext,
	})
}

func (s *Server) shouldExecuteDirectStructuredHandoff(
	handoff *execution.RuntimeHandoff,
) bool {
	if handoff == nil || !isStructuredPayloadKind(handoff.PayloadKind) {
		return false
	}
	selectedTool := selectedToolForDirectStructuredHandoff(handoff)
	if selectedTool == "" {
		return false
	}
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return false
	}
	return directStructuredHandoffDecision(handoff, registry)
}

func directStructuredHandoffDecision(
	handoff *execution.RuntimeHandoff,
	registry runtimepolicy.ToolSpecRegistry,
) bool {
	if handoff == nil || !isStructuredPayloadKind(handoff.PayloadKind) {
		return false
	}
	selectedTool := selectedToolForDirectStructuredHandoff(handoff)
	if selectedTool == "" {
		return false
	}
	tool, ok := registry.ToolByName(selectedTool)
	if !ok || tool.PayloadKind != handoff.PayloadKind || tool.OwnerCapability != handoff.Capability {
		return false
	}
	return tool.RuntimePosture == "typed_handoff_only"
}

func selectedToolForDirectStructuredHandoff(handoff *execution.RuntimeHandoff) string {
	if handoff == nil || len(handoff.AllowedTools) != 1 {
		return ""
	}
	return handoff.AllowedTools[0]
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
	case structuredquery.ToolAcademicCalendarLookup:
		return s.structuredQuery.LookupAcademicCalendar(ctx, rawPayload)
	case structuredquery.ToolCampusNoticeDiscover:
		return s.structuredQuery.LookupCampusNoticeDiscover(ctx, rawPayload)
	case structuredquery.ToolCampusNoticePeriodSummary:
		return s.structuredQuery.LookupCampusNoticePeriodSummary(ctx, rawPayload)
	case structuredquery.ToolCampusNoticeChangeSet:
		return s.structuredQuery.LookupCampusNoticeChangeSet(ctx, rawPayload)
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
