package toolreadmodel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
)

const campusServicesToolResultSchemaVersion = "campus_services_tool_result.v1"

func transportScheduleResponse(body transportScheduleResult) Response {
	body.ResultEnvelope = transportScheduleResultEnvelope(body)
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func transportScheduleResultEnvelope(
	body transportScheduleResult,
) *campusServicesResultEnvelope {
	result := body
	result.ResultEnvelope = nil
	envelope := &campusServicesResultEnvelope{
		SchemaVersion: campusServicesToolResultSchemaVersion,
		Tool:          ToolTransportScheduleLookup,
		ToolName:      ToolTransportScheduleLookup,
		QueryKind:     "transport_schedule",
		Outcome:       body.Outcome,
		Facts: campusServicesScheduleFacts{
			Kind:   "schedule_facts",
			Result: result,
		},
		SourceRefs:           transportScheduleSourceRefs(body),
		ClarificationOptions: transportScheduleClarificationOptions(body),
		FailCloseReason:      strings.TrimSpace(body.FailCloseReason),
	}
	envelope.ContentHash = transportScheduleEnvelopeContentHash(*envelope)
	envelope.ProjectionRef = "projection:campus_services:transport_schedule:" +
		strings.TrimPrefix(envelope.ContentHash, "sha256:")[:16]
	return envelope
}

func transportScheduleSourceRefs(body transportScheduleResult) []string {
	refs := []string{}
	if body.ScheduleSnapshot != nil {
		refs = appendUniqueTransportRefs(refs, []string{body.ScheduleSnapshot.SourceRef})
	}
	refs = appendUniqueTransportRefs(refs, body.RelatedNoticeRefs)
	for _, notice := range body.OperationalNotices {
		refs = appendUniqueTransportRefs(refs, []string{notice.SourceRef})
	}
	return refs
}

func transportScheduleClarificationOptions(body transportScheduleResult) []string {
	options := []string{}
	for _, candidate := range body.CandidateRoutes {
		if candidate.Route.RouteID != "" {
			options = append(options, candidate.Route.RouteID)
		}
	}
	for _, stop := range body.StopRefs {
		if stop.StopID != "" {
			options = append(options, stop.StopID)
		}
	}
	return options
}

func transportScheduleEnvelopeContentHash(envelope campusServicesResultEnvelope) string {
	envelope.ProjectionRef = ""
	envelope.ContentHash = ""
	raw, err := json.Marshal(envelope)
	if err != nil {
		return "sha256:"
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}
