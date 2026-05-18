package structuredquery

import (
	"context"
	"encoding/json"
)

func (r *Runtime) LookupContactDirectory(ctx context.Context, rawBody []byte) Response {
	payloadBody, err := structuredQueryPayloadBody(rawBody)
	if err != nil {
		return invalidRequest("Contact directory request body must be a JSON object.")
	}
	var request contactDirectoryRequest
	if err := json.Unmarshal(payloadBody, &request); err != nil {
		return invalidRequest("Contact directory request body must be a JSON object.")
	}
	normalizeContactDirectoryRequest(&request)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if request.ContactFocus == "" {
		return invalidRequest("contact_focus is required.")
	}
	if err := validateContactDirectoryRequest(request); err != nil {
		return invalidRequest(err.Error())
	}
	if err := ctx.Err(); err != nil {
		return failClosedContactDirectory(request, r.timeAnchor(), "source_truth_unavailable")
	}
	return r.lookupContactDirectory(ctx, request)
}

func (r *Runtime) lookupContactDirectory(
	ctx context.Context,
	request contactDirectoryRequest,
) Response {
	timeAnchor := r.timeAnchor()
	bundle, err := r.loadContactDirectoryBundle(ctx)
	if err != nil {
		return failClosedContactDirectory(request, timeAnchor, "source_truth_unavailable")
	}
	if len(bundle.ContactDirectoryRecords) == 0 {
		return failClosedContactDirectory(request, timeAnchor, "source_family_unavailable")
	}
	if err := ctx.Err(); err != nil {
		return failClosedContactDirectory(request, timeAnchor, "source_truth_unavailable")
	}
	matches := matchContactDirectoryRecords(bundle.ContactDirectoryRecords, request)
	if len(matches) == 0 {
		body := contactDirectoryResult{
			QueryText:         request.QueryText,
			ContactFocus:      request.ContactFocus,
			Outcome:           "not_found",
			QueriedTimeAnchor: timeAnchor,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	readyMatches := contactDirectoryReadyMatches(matches)
	if len(readyMatches) == 0 {
		reason := contactDirectoryNonReadyReason(matches[0].record)
		return failClosedContactDirectory(request, timeAnchor, reason)
	}
	matches = readyMatches
	if len(matches) > 1 && matches[0].score == matches[1].score &&
		(request.EntitySelector == nil || request.EntitySelector.ContactID == "") {
		body := contactDirectoryResult{
			QueryText:           request.QueryText,
			ContactFocus:        request.ContactFocus,
			Outcome:             "clarification_required",
			CandidateContacts:   contactDirectoryCandidates(matches, request.ResultLimit),
			QueriedTimeAnchor:   timeAnchor,
			ClarificationReason: "contact_entity_ambiguous",
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	record := matches[0].record
	if contactDirectoryHasConflict(record.ContactID, bundle.ContactDirectoryConflicts) {
		return failClosedContactDirectory(request, timeAnchor, "source_conflict")
	}
	if contactDirectoryRequiresManualReview(record.ContactID, bundle.ContactDirectoryManualReview) {
		return failClosedContactDirectory(request, timeAnchor, "source_truth_unavailable")
	}
	if !validateContactDirectoryRecord(record) {
		return failClosedContactDirectory(request, timeAnchor, "source_truth_unavailable")
	}
	body := contactDirectoryResultFromRecord(request, record, timeAnchor)
	if !contactDirectoryFocusSatisfied(body) {
		if contactDirectoryFocusNotProvidedBySource(record, request.ContactFocus) {
			return failClosedContactDirectoryForRecord(
				request,
				record,
				timeAnchor,
				"field_not_provided_by_source",
			)
		}
		return failClosedContactDirectory(request, timeAnchor, "stable_contact_unavailable")
	}
	if len(body.SourceRefs) == 0 {
		return failClosedContactDirectory(request, timeAnchor, "source_truth_unavailable")
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}
