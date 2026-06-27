package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/execution"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/toolreadmodel"
)

func isToolReadModelPayloadKind(payloadKind string) bool {
	switch payloadKind {
	case toolreadmodel.ToolTransportScheduleLookup,
		toolreadmodel.ToolCampusNoticeDiscover,
		toolreadmodel.ToolCampusNoticeChangeSet,
		toolreadmodel.ToolCampusNoticeGet:
		return true
	default:
		return false
	}
}

func toolReadModelPayload(
	handoff *execution.RuntimeHandoff,
	accessContext map[string]any,
) ([]byte, error) {
	return json.Marshal(map[string]any{
		"payload":        handoff.Payload,
		"access_context": accessContext,
	})
}

func (s *Server) shouldExecuteDirectToolHandoff(
	handoff *execution.RuntimeHandoff,
) bool {
	if handoff == nil || !isToolReadModelPayloadKind(handoff.PayloadKind) {
		return false
	}
	selectedTool := selectedToolForDirectToolHandoff(handoff)
	if selectedTool == "" {
		return false
	}
	registry, ok := runtimepolicy.DefaultToolSpecRegistry()
	if !ok {
		return false
	}
	return directToolHandoffDecision(handoff, registry)
}

func directToolHandoffDecision(
	handoff *execution.RuntimeHandoff,
	registry runtimepolicy.ToolSpecRegistry,
) bool {
	if handoff == nil || !isToolReadModelPayloadKind(handoff.PayloadKind) {
		return false
	}
	selectedTool := selectedToolForDirectToolHandoff(handoff)
	if selectedTool == "" {
		return false
	}
	tool, ok := registry.ToolByName(selectedTool)
	if !ok || selectedTool != handoff.PayloadKind {
		return false
	}
	return tool.Handler.Type == "execution_control_internal_query" && tool.Exposure != "closed"
}

func selectedToolForDirectToolHandoff(handoff *execution.RuntimeHandoff) string {
	if handoff == nil || len(handoff.AllowedTools) != 1 {
		return ""
	}
	return handoff.AllowedTools[0]
}

func (s *Server) executeToolReadModelRuntime(
	ctx context.Context,
	payloadKind string,
	rawPayload []byte,
) toolreadmodel.Response {
	switch payloadKind {
	case toolreadmodel.ToolTransportScheduleLookup:
		return s.toolReadModel.LookupTransportSchedule(ctx, rawPayload)
	case toolreadmodel.ToolCampusNoticeDiscover:
		return s.toolReadModel.LookupCampusNoticeDiscover(ctx, rawPayload)
	case toolreadmodel.ToolCampusNoticePeriodSummary:
		return s.toolReadModel.LookupCampusNoticePeriodSummary(ctx, rawPayload)
	case toolreadmodel.ToolCampusNoticeChangeSet:
		return s.toolReadModel.LookupCampusNoticeChangeSet(ctx, rawPayload)
	case toolreadmodel.ToolCampusNoticeGet:
		return s.toolReadModel.LookupCampusNoticeGet(ctx, rawPayload)
	default:
		return toolreadmodel.Response{
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

func toolReadModelResultMap(body any) (map[string]any, error) {
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
