package structuredquery

func transportCandidatesFromRoutes(routes []transportRouteRecord) []transportRouteCandidate {
	candidates := make([]transportRouteCandidate, 0, len(routes))
	for _, route := range routes {
		candidates = append(candidates, transportRouteCandidate{
			Route:             *transportRouteRefFromRecord(route),
			ClarificationHint: route.DisplayName,
		})
	}
	return candidates
}

func transportRouteRefFromRecord(route transportRouteRecord) *transportRouteRef {
	return &transportRouteRef{
		RouteID:       route.RouteID,
		DisplayName:   route.DisplayName,
		ServiceFamily: normalizeTransportServiceFamily(route.ServiceFamily),
	}
}

func transportStopRefFromRecord(stop transportStopRecord) transportStopRef {
	return transportStopRef{
		StopID:      stop.StopID,
		DisplayName: stop.DisplayName,
	}
}

func stopRefByID(route transportRouteRecord, stopID string) *transportStopRef {
	for _, stop := range route.Stops {
		if stop.StopID == stopID {
			ref := transportStopRefFromRecord(stop)
			return &ref
		}
	}
	return nil
}

func transportScheduleSnapshotRefFromRecord(
	snapshot transportScheduleSnapshotRecord,
) *transportScheduleSnapshotRef {
	return &transportScheduleSnapshotRef{
		SnapshotID:     snapshot.SnapshotID,
		PublishedAt:    snapshot.PublishedAt,
		EffectiveFrom:  snapshot.EffectiveFrom,
		EffectiveUntil: snapshot.EffectiveUntil,
		SourceRef:      snapshot.SourceRef,
	}
}

func normalizeTransportServiceFamily(value string) string {
	normalized := normalizeSearchText(value)
	switch normalized {
	case "metro_shuttle", "subway", "地铁接驳车":
		return "subway_shuttle"
	default:
		return normalized
	}
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func failClosedTransportSchedule(
	request transportScheduleRequest,
	timeAnchor string,
) Response {
	return failClosedTransportScheduleWithReason(request, timeAnchor, "source_family_unavailable")
}

func failClosedTransportScheduleWithReason(
	request transportScheduleRequest,
	timeAnchor string,
	reason string,
) Response {
	body := transportScheduleResult{
		QueryText:         request.QueryText,
		Intent:            request.Intent,
		Outcome:           "temporarily_unverifiable",
		ServiceStatus:     "unknown",
		QueriedTimeAnchor: timeAnchor,
		FailCloseReason:   reason,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}
