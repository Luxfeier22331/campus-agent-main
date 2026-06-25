package structuredquery

import (
	"context"
	"errors"
	"fmt"
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
	SnapshotID        string                              `json:"snapshot_id"`
	PublishedAt       string                              `json:"published_at"`
	EffectiveFrom     string                              `json:"effective_from"`
	EffectiveUntil    string                              `json:"effective_until"`
	SourceRef         string                              `json:"source_ref"`
	IsCurrent         bool                                `json:"is_current"`
	ScheduleScope     string                              `json:"schedule_scope"`
	Precedence        int                                 `json:"precedence"`
	ServiceDateRanges []transportSnapshotServiceDateRange `json:"service_date_ranges"`
}

type transportSnapshotServiceDateRange struct {
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
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
	DepartureStatus    string   `json:"departure_status"`
	DepartureKind      string   `json:"departure_kind"`
}

type transportServiceExceptionRecord struct {
	SnapshotID         string   `json:"snapshot_id"`
	RouteID            string   `json:"route_id"`
	ServiceDate        string   `json:"service_date"`
	ServiceStatus      string   `json:"service_status"`
	RelatedNoticeRefs  []string `json:"related_notice_refs"`
	OperationalComment string   `json:"operational_comment"`
}

type transportOperationalNoticeRecord struct {
	NoticeID           string   `json:"notice_id"`
	SourceRef          string   `json:"source_ref"`
	NoticeKind         string   `json:"notice_kind"`
	RouteIDs           []string `json:"route_ids"`
	EffectiveFrom      string   `json:"effective_from"`
	EffectiveUntil     string   `json:"effective_until"`
	OperationalComment string   `json:"operational_comment"`
}

type transportSnapshotSelection struct {
	record  transportScheduleSnapshotRecord
	outcome string
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
	bundle, err := r.loadTransportScheduleBundle(ctx)
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
	if request.Intent == "schedule_snapshot_metadata" {
		snapshot, ok := selectTransportScheduleSnapshot(bundle, request, anchor)
		if !ok {
			return failClosedTransportScheduleWithReason(
				request,
				anchor.Format(time.RFC3339),
				"current_state_unverifiable",
			)
		}
		body := transportScheduleResult{
			QueryText:         request.QueryText,
			Intent:            request.Intent,
			Outcome:           snapshot.outcome,
			QueriedTimeAnchor: anchor.Format(time.RFC3339),
			ScheduleSnapshot:  transportScheduleSnapshotRefFromRecord(snapshot.record),
		}
		return transportScheduleResponse(body)
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
		return transportScheduleResponse(body)
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
		return transportScheduleResponse(body)
	}

	snapshot, ok := selectTransportScheduleSnapshotForServiceDate(
		bundle,
		request,
		anchor,
		routeSelection.record,
		serviceDate,
	)
	if !ok {
		return failClosedTransportScheduleWithReason(
			request,
			anchor.Format(time.RFC3339),
			"current_state_unverifiable",
		)
	}

	base := transportScheduleResult{
		QueryText:            request.QueryText,
		Intent:               request.Intent,
		Outcome:              snapshot.outcome,
		ResolvedRoute:        transportRouteRefFromRecord(routeSelection.record),
		QueriedTimeAnchor:    anchor.Format(time.RFC3339),
		RequestedServiceDate: serviceDateText,
		ServiceStatus:        "running",
		ScheduleSnapshot:     transportScheduleSnapshotRefFromRecord(snapshot.record),
		OperationalNotices: matchingTransportOperationalNotices(
			bundle.TransportOperationalNotices,
			routeSelection.record,
			serviceDateText,
		),
	}
	base.RelatedNoticeRefs = transportOperationalNoticeRefs(base.OperationalNotices)

	exception, hasException, exceptionErr := matchTransportServiceException(
		bundle.TransportServiceExceptions,
		snapshot.record,
		routeSelection.record,
		serviceDateText,
	)
	if exceptionErr != nil {
		return failClosedTransportScheduleWithReason(
			request,
			anchor.Format(time.RFC3339),
			exceptionErr.Error(),
		)
	}
	if hasException {
		base.ServiceStatus = exception.ServiceStatus
		base.RelatedNoticeRefs = appendUniqueTransportRefs(
			exception.RelatedNoticeRefs,
			base.RelatedNoticeRefs,
		)
		return transportScheduleResponse(base)
	}

	departures, departureErr := buildTransportDepartures(
		bundle.ScheduledDepartures,
		snapshot.record,
		routeSelection.record,
		serviceDate,
	)
	if departureErr != nil {
		return failClosedTransportScheduleWithReason(
			request,
			anchor.Format(time.RFC3339),
			departureErr.Error(),
		)
	}
	departures = filterTransportDepartures(departures, request, anchor, serviceDate)
	if len(departures) == 0 {
		base.Outcome = "not_found"
		base.ServiceStatus = "not_running"
		return transportScheduleResponse(base)
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
	return transportScheduleResponse(base)
}
