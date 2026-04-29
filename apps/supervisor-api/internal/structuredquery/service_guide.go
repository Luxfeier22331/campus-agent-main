package structuredquery

import (
	"context"
	"encoding/json"
)

func (r *Runtime) LookupServiceGuide(ctx context.Context, rawBody []byte) Response {
	payloadBody, err := structuredQueryPayloadBody(rawBody)
	if err != nil {
		return invalidRequest("Service guide request body must be a JSON object.")
	}
	var request serviceGuideRequest
	if err := json.Unmarshal(payloadBody, &request); err != nil {
		return invalidRequest("Service guide request body must be a JSON object.")
	}
	normalizeServiceGuideRequest(&request)
	if request.ServiceQuery == "" {
		return invalidRequest("service_query is required.")
	}
	if !isAllowedServiceGuideFocus(request.GuideFocus) {
		return invalidRequest("unsupported guide_focus: " + request.GuideFocus)
	}
	if err := validateServiceGuideRequest(request); err != nil {
		return invalidRequest(err.Error())
	}
	if err := ctx.Err(); err != nil {
		return failClosedServiceGuide(request, r.timeAnchor(), "source_truth_unavailable")
	}
	return r.lookupServiceGuide(ctx, request)
}

func (r *Runtime) lookupServiceGuide(ctx context.Context, request serviceGuideRequest) Response {
	bundle, err := r.loadServiceGuideBundle(ctx)
	timeAnchor := r.timeAnchor()
	if err != nil {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	if len(bundle.ServiceGuideRecords) == 0 {
		return failClosedServiceGuide(request, timeAnchor, "source_family_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	queryTime, err := serviceGuideQueryTime(request, timeAnchor)
	if err != nil {
		return failClosedServiceGuide(request, timeAnchor, "temporal_scope_ambiguous")
	}
	matches := matchServiceGuideRecords(bundle.ServiceGuideRecords, request)
	if len(matches) == 0 {
		body := serviceGuideResult{
			ServiceQuery:      request.ServiceQuery,
			GuideFocus:        request.GuideFocus,
			Outcome:           "not_found",
			QueriedTimeAnchor: timeAnchor,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	readyMatches := serviceGuideReadyMatches(matches)
	if len(readyMatches) == 0 {
		reason := serviceGuideNonReadyReason(matches[0].record)
		return failClosedServiceGuide(request, timeAnchor, reason)
	}
	matches = readyMatches
	if len(matches) > 1 && matches[0].score == matches[1].score {
		body := serviceGuideResult{
			ServiceQuery:        request.ServiceQuery,
			GuideFocus:          request.GuideFocus,
			Outcome:             "clarification_required",
			CandidateServices:   serviceGuideCandidates(matches, request.ResultLimit),
			QueriedTimeAnchor:   timeAnchor,
			ClarificationReason: "service_ambiguous",
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	record := matches[0].record
	if serviceGuideHasConflict(record.ServiceID, bundle.ServiceGuideConflicts) {
		return failClosedServiceGuide(request, timeAnchor, "source_conflict")
	}
	if serviceGuideRequiresManualReview(record.ServiceID, bundle.ServiceGuideManualReviews) {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	status, err := validateServiceGuideRecord(record)
	if err != nil {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	if queryTime.Before(status.effectiveFrom) || !queryTime.Before(status.effectiveUntil) {
		return failClosedServiceGuide(request, timeAnchor, "current_state_unverifiable")
	}
	if !serviceGuideFocusBackedByRecord(record, request.GuideFocus) {
		return failClosedServiceGuide(request, timeAnchor, "source_truth_unavailable")
	}
	body := serviceGuideResultFromRecord(request, record, timeAnchor)
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}
