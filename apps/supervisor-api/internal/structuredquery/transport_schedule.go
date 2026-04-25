package structuredquery

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	transportLocalDateLayout     = "2006-01-02"
	transportWallTimeLayout      = "15:04"
	transportScheduleResultLimit = 20
)

var transportLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type transportScheduleSnapshotRecord struct {
	SnapshotID     string `json:"snapshot_id"`
	PublishedAt    string `json:"published_at"`
	EffectiveFrom  string `json:"effective_from"`
	EffectiveUntil string `json:"effective_until"`
	SourceRef      string `json:"source_ref"`
	IsCurrent      bool   `json:"is_current"`
}

type transportRouteRecord struct {
	RouteID           string                `json:"route_id"`
	DisplayName       string                `json:"display_name"`
	ServiceFamily     string                `json:"service_family"`
	Aliases           []string              `json:"aliases"`
	OriginCampus      string                `json:"origin_campus"`
	DestinationCampus string                `json:"destination_campus"`
	Stops             []transportStopRecord `json:"stops"`
}

type transportStopRecord struct {
	StopID      string   `json:"stop_id"`
	DisplayName string   `json:"display_name"`
	Aliases     []string `json:"aliases"`
}

type scheduledDepartureRecord struct {
	SnapshotID         string   `json:"snapshot_id"`
	RouteID            string   `json:"route_id"`
	ServiceDates       []string `json:"service_dates"`
	DepartureTime      string   `json:"departure_time"`
	ArrivalTime        string   `json:"arrival_time"`
	OriginStopID       string   `json:"origin_stop_id"`
	DestinationStopID  string   `json:"destination_stop_id"`
	RelatedNoticeRefs  []string `json:"related_notice_refs"`
	OperationalComment string   `json:"operational_comment"`
}

type transportServiceExceptionRecord struct {
	SnapshotID         string   `json:"snapshot_id"`
	RouteID            string   `json:"route_id"`
	ServiceDate        string   `json:"service_date"`
	ServiceStatus      string   `json:"service_status"`
	RelatedNoticeRefs  []string `json:"related_notice_refs"`
	OperationalComment string   `json:"operational_comment"`
}

type transportSnapshotSelection struct {
	record                    transportScheduleSnapshotRecord
	outcome                   string
	historicalDowngradeReason string
}

type transportRouteSelection struct {
	record              transportRouteRecord
	outcome             string
	clarificationReason string
	candidateRoutes     []transportRouteCandidate
	stopRefs            []transportStopRef
}

func normalizeTransportScheduleRequest(request *transportScheduleRequest) {
	request.QueryText = strings.TrimSpace(request.QueryText)
	request.Intent = strings.TrimSpace(request.Intent)
	if request.SnapshotQuery.Mode == "" {
		request.SnapshotQuery.Mode = "current"
	}
	request.SnapshotQuery.Mode = strings.TrimSpace(request.SnapshotQuery.Mode)
	request.SnapshotQuery.AsOf = strings.TrimSpace(request.SnapshotQuery.AsOf)
	request.SnapshotQuery.YearHint = strings.TrimSpace(request.SnapshotQuery.YearHint)
	if request.RouteSelector != nil {
		request.RouteSelector.RouteID = strings.TrimSpace(request.RouteSelector.RouteID)
		request.RouteSelector.ServiceFamily = normalizeTransportServiceFamily(
			request.RouteSelector.ServiceFamily,
		)
		request.RouteSelector.RouteVariantQuery = strings.TrimSpace(
			request.RouteSelector.RouteVariantQuery,
		)
		request.RouteSelector.OriginCampus = strings.TrimSpace(request.RouteSelector.OriginCampus)
		request.RouteSelector.DestinationCampus = strings.TrimSpace(
			request.RouteSelector.DestinationCampus,
		)
		request.RouteSelector.OriginStopQuery = strings.TrimSpace(
			request.RouteSelector.OriginStopQuery,
		)
		request.RouteSelector.DestinationStopQuery = strings.TrimSpace(
			request.RouteSelector.DestinationStopQuery,
		)
	}
	if request.ServiceTimeQuery != nil {
		request.ServiceTimeQuery.DateMode = strings.TrimSpace(request.ServiceTimeQuery.DateMode)
		request.ServiceTimeQuery.ServiceDate = strings.TrimSpace(
			request.ServiceTimeQuery.ServiceDate,
		)
		request.ServiceTimeQuery.Daypart = strings.TrimSpace(request.ServiceTimeQuery.Daypart)
		request.ServiceTimeQuery.DepartureNotBefore = strings.TrimSpace(
			request.ServiceTimeQuery.DepartureNotBefore,
		)
		request.ServiceTimeQuery.DepartureNotAfter = strings.TrimSpace(
			request.ServiceTimeQuery.DepartureNotAfter,
		)
	}
}

func validateTransportScheduleRequest(request transportScheduleRequest) error {
	switch request.Intent {
	case "next_departure",
		"first_departure",
		"last_departure",
		"departure_list",
		"service_window",
		"timetable",
		"schedule_snapshot_metadata":
	default:
		return fmt.Errorf("unsupported intent: %s", request.Intent)
	}
	switch request.SnapshotQuery.Mode {
	case "current", "latest", "effective", "as_of", "current_year":
	default:
		return fmt.Errorf("unsupported snapshot_query.mode: %s", request.SnapshotQuery.Mode)
	}
	if request.SnapshotQuery.Mode == "as_of" && request.SnapshotQuery.AsOf == "" {
		return errors.New("snapshot_query.as_of is required when mode is as_of")
	}
	if request.SnapshotQuery.Mode == "current_year" && request.SnapshotQuery.YearHint == "" {
		return errors.New("snapshot_query.year_hint is required when mode is current_year")
	}
	if request.Intent == "schedule_snapshot_metadata" && request.ServiceTimeQuery != nil {
		return errors.New("service_time_query is not allowed for schedule_snapshot_metadata")
	}
	if request.ServiceTimeQuery != nil {
		if err := validateTransportServiceTimeQuery(*request.ServiceTimeQuery); err != nil {
			return err
		}
	}
	if request.ResultLimit != nil && *request.ResultLimit <= 0 {
		return errors.New("result_limit must be positive")
	}
	return nil
}

func validateTransportServiceTimeQuery(query transportServiceTimeQuery) error {
	switch query.DateMode {
	case "", "today", "tomorrow", "date":
	default:
		return fmt.Errorf("unsupported service_time_query.date_mode: %s", query.DateMode)
	}
	if query.DateMode == "date" && query.ServiceDate == "" {
		return errors.New("service_time_query.service_date is required when date_mode is date")
	}
	if query.DateMode != "date" && query.ServiceDate != "" {
		return errors.New("service_time_query.service_date is only allowed when date_mode is date")
	}
	switch query.Daypart {
	case "", "morning", "afternoon", "evening", "all_day":
	default:
		return fmt.Errorf("unsupported service_time_query.daypart: %s", query.Daypart)
	}
	if query.DepartureNotBefore != "" {
		if _, err := time.Parse(transportWallTimeLayout, query.DepartureNotBefore); err != nil {
			return errors.New("service_time_query.departure_not_before must be HH:MM")
		}
	}
	if query.DepartureNotAfter != "" {
		if _, err := time.Parse(transportWallTimeLayout, query.DepartureNotAfter); err != nil {
			return errors.New("service_time_query.departure_not_after must be HH:MM")
		}
	}
	if query.DepartureNotBefore != "" && query.DepartureNotAfter != "" &&
		query.DepartureNotBefore > query.DepartureNotAfter {
		return errors.New("service_time_query.departure_not_before must not be later than departure_not_after")
	}
	return nil
}

func (r *Runtime) lookupTransportSchedule(
	ctx context.Context,
	request transportScheduleRequest,
) Response {
	bundle, err := r.loadBundle()
	if err != nil {
		return failClosedTransportScheduleWithReason(
			request,
			r.timeAnchor(),
			"source_truth_unavailable",
		)
	}
	if len(bundle.TransportScheduleSnapshots) == 0 {
		return failClosedTransportScheduleWithReason(
			request,
			r.timeAnchor(),
			"source_family_unavailable",
		)
	}
	if err := ctx.Err(); err != nil {
		return failClosedTransportScheduleWithReason(
			request,
			r.timeAnchor(),
			"source_truth_unavailable",
		)
	}

	anchor, err := time.Parse(time.RFC3339, r.timeAnchor())
	if err != nil {
		anchor = time.Now().In(transportLocation)
	}
	anchor = anchor.In(transportLocation)
	snapshot, ok := selectTransportScheduleSnapshot(bundle, request, anchor)
	if !ok {
		return failClosedTransportScheduleWithReason(
			request,
			anchor.Format(time.RFC3339),
			"current_state_unverifiable",
		)
	}

	if request.Intent == "schedule_snapshot_metadata" {
		body := transportScheduleResult{
			QueryText:                 request.QueryText,
			Intent:                    request.Intent,
			Outcome:                   snapshot.outcome,
			QueriedTimeAnchor:         anchor.Format(time.RFC3339),
			ScheduleSnapshot:          transportScheduleSnapshotRefFromRecord(snapshot.record),
			HistoricalDowngradeReason: snapshot.historicalDowngradeReason,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}

	routeSelection := selectTransportRoute(bundle.TransportRoutes, request)
	if routeSelection.outcome != "resolved" {
		body := transportScheduleResult{
			QueryText:           request.QueryText,
			Intent:              request.Intent,
			Outcome:             routeSelection.outcome,
			QueriedTimeAnchor:   anchor.Format(time.RFC3339),
			CandidateRoutes:     routeSelection.candidateRoutes,
			ClarificationReason: routeSelection.clarificationReason,
			StopRefs:            routeSelection.stopRefs,
			ScheduleSnapshot:    nil,
			ServiceStatus:       "",
			FailCloseReason:     "",
			RelatedNoticeRefs:   nil,
			DepartureOptions:    nil,
			TimetableEntries:    nil,
			SelectedDeparture:   nil,
			ServiceWindow:       nil,
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}

	serviceDate, serviceDateText, err := requestedTransportServiceDate(request, anchor)
	if err != nil {
		body := transportScheduleResult{
			QueryText:           request.QueryText,
			Intent:              request.Intent,
			Outcome:             "clarification_required",
			QueriedTimeAnchor:   anchor.Format(time.RFC3339),
			ResolvedRoute:       transportRouteRefFromRecord(routeSelection.record),
			ClarificationReason: "service_date_required",
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}

	base := transportScheduleResult{
		QueryText:                 request.QueryText,
		Intent:                    request.Intent,
		Outcome:                   snapshot.outcome,
		ResolvedRoute:             transportRouteRefFromRecord(routeSelection.record),
		QueriedTimeAnchor:         anchor.Format(time.RFC3339),
		RequestedServiceDate:      serviceDateText,
		ServiceStatus:             "running",
		ScheduleSnapshot:          transportScheduleSnapshotRefFromRecord(snapshot.record),
		HistoricalDowngradeReason: snapshot.historicalDowngradeReason,
	}

	if exception, ok := matchTransportServiceException(
		bundle.TransportServiceExceptions,
		snapshot.record,
		routeSelection.record,
		serviceDateText,
	); ok {
		base.ServiceStatus = exception.ServiceStatus
		base.RelatedNoticeRefs = append([]string(nil), exception.RelatedNoticeRefs...)
		return Response{StatusCode: 200, Outcome: base.Outcome, Body: base}
	}

	departures := buildTransportDepartures(
		bundle.ScheduledDepartures,
		snapshot.record,
		routeSelection.record,
		serviceDate,
	)
	departures = filterTransportDepartures(departures, request, anchor, serviceDate)
	if len(departures) == 0 {
		base.Outcome = "not_found"
		base.ServiceStatus = "not_running"
		base.ScheduleSnapshot = nil
		return Response{StatusCode: 200, Outcome: base.Outcome, Body: base}
	}

	switch request.Intent {
	case "next_departure", "first_departure":
		base.SelectedDeparture = &departures[0]
	case "last_departure":
		base.SelectedDeparture = &departures[len(departures)-1]
	case "departure_list":
		base.DepartureOptions = limitTransportDepartures(departures, request.ResultLimit)
	case "service_window":
		base.ServiceWindow = &transportServiceWindow{
			FirstDepartureAt: departures[0].DepartureAt,
			LastDepartureAt:  departures[len(departures)-1].DepartureAt,
		}
	case "timetable":
		base.TimetableEntries = limitTransportDepartures(departures, request.ResultLimit)
	default:
		return failClosedTransportScheduleWithReason(
			request,
			anchor.Format(time.RFC3339),
			"source_family_unavailable",
		)
	}
	return Response{StatusCode: 200, Outcome: base.Outcome, Body: base}
}

func selectTransportScheduleSnapshot(
	bundle projectionBundle,
	request transportScheduleRequest,
	anchor time.Time,
) (transportSnapshotSelection, bool) {
	snapshots := append([]transportScheduleSnapshotRecord(nil), bundle.TransportScheduleSnapshots...)
	sort.SliceStable(snapshots, func(i, j int) bool {
		return snapshots[i].PublishedAt > snapshots[j].PublishedAt
	})
	switch request.SnapshotQuery.Mode {
	case "current", "effective", "":
		for _, snapshot := range snapshots {
			if snapshot.IsCurrent || snapshotEffectiveAt(snapshot, anchor) {
				return transportSnapshotSelection{
					record:  snapshot,
					outcome: "resolved_current",
				}, true
			}
		}
		return transportSnapshotSelection{}, false
	case "latest":
		if len(snapshots) == 0 {
			return transportSnapshotSelection{}, false
		}
		return transportSnapshotSelection{record: snapshots[0], outcome: "resolved_current"}, true
	case "as_of":
		asOf, ok := parseTransportAsOf(request.SnapshotQuery.AsOf)
		if !ok {
			return transportSnapshotSelection{}, false
		}
		for _, snapshot := range snapshots {
			if snapshotEffectiveAt(snapshot, asOf) || publishedBefore(snapshot, asOf) {
				return transportSnapshotSelection{
					record:  snapshot,
					outcome: "resolved_historical_reference",
				}, true
			}
		}
		return transportSnapshotSelection{}, false
	case "current_year":
		for _, snapshot := range snapshots {
			if strings.HasPrefix(snapshot.PublishedAt, request.SnapshotQuery.YearHint+"-") {
				return transportSnapshotSelection{
					record:  snapshot,
					outcome: "resolved_current",
				}, true
			}
		}
		if len(snapshots) == 0 {
			return transportSnapshotSelection{}, false
		}
		return transportSnapshotSelection{
			record:                    snapshots[0],
			outcome:                   "resolved_historical_reference",
			historicalDowngradeReason: "current_year_miss",
		}, true
	default:
		return transportSnapshotSelection{}, false
	}
}

func snapshotEffectiveAt(snapshot transportScheduleSnapshotRecord, anchor time.Time) bool {
	if snapshot.EffectiveFrom == "" {
		return false
	}
	effectiveFrom, err := time.Parse(time.RFC3339, snapshot.EffectiveFrom)
	if err != nil || anchor.Before(effectiveFrom) {
		return false
	}
	if snapshot.EffectiveUntil == "" {
		return true
	}
	effectiveUntil, err := time.Parse(time.RFC3339, snapshot.EffectiveUntil)
	return err == nil && anchor.Before(effectiveUntil)
}

func publishedBefore(snapshot transportScheduleSnapshotRecord, anchor time.Time) bool {
	publishedAt, err := time.Parse(time.RFC3339, snapshot.PublishedAt)
	return err == nil && !publishedAt.After(anchor)
}

func parseTransportAsOf(value string) (time.Time, bool) {
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.In(transportLocation), true
	}
	if parsed, err := time.Parse(transportLocalDateLayout, value); err == nil {
		return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 23, 59, 59, 0, transportLocation), true
	}
	return time.Time{}, false
}

func selectTransportRoute(
	routes []transportRouteRecord,
	request transportScheduleRequest,
) transportRouteSelection {
	if len(routes) == 0 {
		return transportRouteSelection{outcome: "not_found"}
	}
	if request.RouteSelector == nil || transportRouteSelectorEmpty(*request.RouteSelector) {
		return transportRouteSelection{
			outcome:             "clarification_required",
			clarificationReason: "route_family_required",
			candidateRoutes:     transportCandidatesFromRoutes(routes),
		}
	}

	selector := *request.RouteSelector
	candidates := append([]transportRouteRecord(nil), routes...)
	if selector.RouteID != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return route.RouteID == selector.RouteID
		})
	}
	if selector.ServiceFamily != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return normalizeTransportServiceFamily(route.ServiceFamily) == selector.ServiceFamily ||
				matchesNormalizedAlias(selector.ServiceFamily, route.Aliases)
		})
	}
	if selector.OriginCampus != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return normalizeSearchText(route.OriginCampus) == normalizeSearchText(selector.OriginCampus)
		})
	}
	if selector.DestinationCampus != "" {
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return normalizeSearchText(route.DestinationCampus) ==
				normalizeSearchText(selector.DestinationCampus)
		})
	}
	if selector.RouteVariantQuery != "" {
		needle := normalizeSearchText(selector.RouteVariantQuery)
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return matchesTransportRouteText(route, needle)
		})
	}

	originStopMatches := []transportStopRef(nil)
	if selector.OriginStopQuery != "" {
		stopIDs, stopRefs := matchingTransportStopIDs(candidates, selector.OriginStopQuery)
		if len(stopIDs) > 1 {
			return transportRouteSelection{
				outcome:             "clarification_required",
				clarificationReason: "origin_stop_ambiguous",
				stopRefs:            stopRefs,
			}
		}
		if len(stopIDs) == 0 {
			return transportRouteSelection{outcome: "not_found"}
		}
		originStopMatches = stopRefs
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return routeContainsStop(route, stopIDs[0])
		})
	}
	destinationStopMatches := []transportStopRef(nil)
	if selector.DestinationStopQuery != "" {
		stopIDs, stopRefs := matchingTransportStopIDs(candidates, selector.DestinationStopQuery)
		if len(stopIDs) > 1 {
			return transportRouteSelection{
				outcome:             "clarification_required",
				clarificationReason: "destination_stop_ambiguous",
				stopRefs:            stopRefs,
			}
		}
		if len(stopIDs) == 0 {
			return transportRouteSelection{outcome: "not_found"}
		}
		destinationStopMatches = stopRefs
		candidates = filterTransportRoutes(candidates, func(route transportRouteRecord) bool {
			return routeContainsStop(route, stopIDs[0])
		})
	}

	if len(candidates) == 0 {
		return transportRouteSelection{outcome: "not_found"}
	}
	if len(candidates) > 1 {
		return transportRouteSelection{
			outcome:             "clarification_required",
			clarificationReason: routeClarificationReason(selector),
			candidateRoutes:     transportCandidatesFromRoutes(candidates),
			stopRefs:            append(originStopMatches, destinationStopMatches...),
		}
	}
	return transportRouteSelection{
		record:  candidates[0],
		outcome: "resolved",
		stopRefs: append(
			append([]transportStopRef(nil), originStopMatches...),
			destinationStopMatches...,
		),
	}
}

func routeClarificationReason(selector transportRouteSelector) string {
	if selector.RouteVariantQuery != "" || selector.OriginCampus != "" ||
		selector.DestinationCampus != "" {
		return "route_variant_ambiguous"
	}
	if selector.ServiceFamily != "" {
		return "route_direction_required"
	}
	return "route_family_required"
}

func transportRouteSelectorEmpty(selector transportRouteSelector) bool {
	return selector.RouteID == "" &&
		selector.ServiceFamily == "" &&
		selector.RouteVariantQuery == "" &&
		selector.OriginCampus == "" &&
		selector.DestinationCampus == "" &&
		selector.OriginStopQuery == "" &&
		selector.DestinationStopQuery == ""
}

func filterTransportRoutes(
	routes []transportRouteRecord,
	predicate func(transportRouteRecord) bool,
) []transportRouteRecord {
	filtered := make([]transportRouteRecord, 0, len(routes))
	for _, route := range routes {
		if predicate(route) {
			filtered = append(filtered, route)
		}
	}
	return filtered
}

func matchesTransportRouteText(route transportRouteRecord, needle string) bool {
	candidates := append([]string{route.RouteID, route.DisplayName, route.ServiceFamily}, route.Aliases...)
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		if strings.Contains(needle, normalized) || strings.Contains(normalized, needle) {
			return true
		}
	}
	return false
}

func matchesNormalizedAlias(needle string, aliases []string) bool {
	for _, alias := range aliases {
		if normalizeTransportServiceFamily(alias) == needle || normalizeSearchText(alias) == needle {
			return true
		}
	}
	return false
}

func matchingTransportStopIDs(
	routes []transportRouteRecord,
	query string,
) ([]string, []transportStopRef) {
	needle := normalizeSearchText(query)
	seen := map[string]bool{}
	stopIDs := []string{}
	stopRefs := []transportStopRef{}
	for _, route := range routes {
		for _, stop := range route.Stops {
			if !matchesTransportStopText(stop, needle) || seen[stop.StopID] {
				continue
			}
			seen[stop.StopID] = true
			stopIDs = append(stopIDs, stop.StopID)
			stopRefs = append(stopRefs, transportStopRefFromRecord(stop))
		}
	}
	return stopIDs, stopRefs
}

func matchesTransportStopText(stop transportStopRecord, needle string) bool {
	candidates := append([]string{stop.StopID, stop.DisplayName}, stop.Aliases...)
	for _, candidate := range candidates {
		normalized := normalizeSearchText(candidate)
		if normalized == "" {
			continue
		}
		if strings.Contains(needle, normalized) || strings.Contains(normalized, needle) {
			return true
		}
	}
	return false
}

func routeContainsStop(route transportRouteRecord, stopID string) bool {
	for _, stop := range route.Stops {
		if stop.StopID == stopID {
			return true
		}
	}
	return false
}

func requestedTransportServiceDate(
	request transportScheduleRequest,
	anchor time.Time,
) (time.Time, string, error) {
	query := transportServiceTimeQuery{DateMode: "today", Daypart: "all_day"}
	if request.ServiceTimeQuery != nil {
		query = *request.ServiceTimeQuery
	}
	switch query.DateMode {
	case "", "today":
		date := beginningOfTransportDay(anchor)
		return date, date.Format(transportLocalDateLayout), nil
	case "tomorrow":
		date := beginningOfTransportDay(anchor).AddDate(0, 0, 1)
		return date, date.Format(transportLocalDateLayout), nil
	case "date":
		date, err := time.ParseInLocation(transportLocalDateLayout, query.ServiceDate, transportLocation)
		if err != nil {
			return time.Time{}, "", err
		}
		return date, date.Format(transportLocalDateLayout), nil
	default:
		return time.Time{}, "", errors.New("unsupported service date mode")
	}
}

func beginningOfTransportDay(value time.Time) time.Time {
	local := value.In(transportLocation)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, transportLocation)
}

func matchTransportServiceException(
	exceptions []transportServiceExceptionRecord,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate string,
) (transportServiceExceptionRecord, bool) {
	for _, exception := range exceptions {
		if exception.RouteID != route.RouteID {
			continue
		}
		if exception.SnapshotID != "" && exception.SnapshotID != snapshot.SnapshotID {
			continue
		}
		if exception.ServiceDate != serviceDate {
			continue
		}
		if exception.ServiceStatus == "" {
			continue
		}
		return exception, true
	}
	return transportServiceExceptionRecord{}, false
}

func buildTransportDepartures(
	records []scheduledDepartureRecord,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate time.Time,
) []scheduledDeparture {
	departures := []scheduledDeparture{}
	serviceDateText := serviceDate.Format(transportLocalDateLayout)
	for _, record := range records {
		if record.RouteID != route.RouteID {
			continue
		}
		if record.SnapshotID != "" && record.SnapshotID != snapshot.SnapshotID {
			continue
		}
		if len(record.ServiceDates) > 0 && !stringSliceContains(record.ServiceDates, serviceDateText) {
			continue
		}
		departure, ok := buildTransportDeparture(record, route, serviceDate)
		if ok {
			departures = append(departures, departure)
		}
	}
	sort.SliceStable(departures, func(i, j int) bool {
		return departures[i].DepartureAt < departures[j].DepartureAt
	})
	return departures
}

func buildTransportDeparture(
	record scheduledDepartureRecord,
	route transportRouteRecord,
	serviceDate time.Time,
) (scheduledDeparture, bool) {
	departureAt, ok := combineTransportDateAndTime(serviceDate, record.DepartureTime)
	if !ok {
		return scheduledDeparture{}, false
	}
	arrivalAt := ""
	if record.ArrivalTime != "" {
		if parsed, ok := combineTransportDateAndTime(serviceDate, record.ArrivalTime); ok {
			arrivalAt = parsed.Format(time.RFC3339)
		}
	}
	departure := scheduledDeparture{
		DepartureAt:        departureAt.Format(time.RFC3339),
		ArrivalAt:          arrivalAt,
		OriginStopRef:      stopRefByID(route, record.OriginStopID),
		DestinationStopRef: stopRefByID(route, record.DestinationStopID),
	}
	return departure, true
}

func combineTransportDateAndTime(serviceDate time.Time, wallClock string) (time.Time, bool) {
	parsedTime, err := time.Parse(transportWallTimeLayout, wallClock)
	if err != nil {
		return time.Time{}, false
	}
	return time.Date(
		serviceDate.Year(),
		serviceDate.Month(),
		serviceDate.Day(),
		parsedTime.Hour(),
		parsedTime.Minute(),
		0,
		0,
		transportLocation,
	), true
}

func filterTransportDepartures(
	departures []scheduledDeparture,
	request transportScheduleRequest,
	anchor time.Time,
	serviceDate time.Time,
) []scheduledDeparture {
	query := transportServiceTimeQuery{Daypart: "all_day"}
	if request.ServiceTimeQuery != nil {
		query = *request.ServiceTimeQuery
	}
	from := query.DepartureNotBefore
	until := query.DepartureNotAfter
	daypartFrom, daypartUntil := transportDaypartBounds(query.Daypart)
	if from == "" {
		from = daypartFrom
	}
	if until == "" {
		until = daypartUntil
	}
	if request.Intent == "next_departure" &&
		serviceDate.Format(transportLocalDateLayout) == anchor.Format(transportLocalDateLayout) &&
		query.DepartureNotBefore == "" &&
		daypartFrom == "" {
		from = anchor.Format(transportWallTimeLayout)
	}

	filtered := make([]scheduledDeparture, 0, len(departures))
	for _, departure := range departures {
		departureAt, err := time.Parse(time.RFC3339, departure.DepartureAt)
		if err != nil {
			continue
		}
		wallClock := departureAt.In(transportLocation).Format(transportWallTimeLayout)
		if from != "" && wallClock < from {
			continue
		}
		if until != "" && wallClock > until {
			continue
		}
		filtered = append(filtered, departure)
	}
	return filtered
}

func transportDaypartBounds(daypart string) (string, string) {
	switch daypart {
	case "morning":
		return "05:00", "11:59"
	case "afternoon":
		return "12:00", "17:59"
	case "evening":
		return "18:00", "23:59"
	default:
		return "", ""
	}
}

func limitTransportDepartures(
	departures []scheduledDeparture,
	limit *int,
) []scheduledDeparture {
	effectiveLimit := transportScheduleResultLimit
	if limit != nil && *limit < effectiveLimit {
		effectiveLimit = *limit
	}
	if effectiveLimit <= 0 {
		effectiveLimit = transportScheduleResultLimit
	}
	if effectiveLimit >= len(departures) {
		return append([]scheduledDeparture(nil), departures...)
	}
	return append([]scheduledDeparture(nil), departures[:effectiveLimit]...)
}

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
