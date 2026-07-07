package toolreadmodel

import (
	"errors"
	"sort"
	"strings"
	"time"
)

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
) (transportServiceExceptionRecord, bool, error) {
	matches := []transportServiceExceptionRecord{}
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
		matches = append(matches, exception)
	}
	if len(matches) == 0 {
		return transportServiceExceptionRecord{}, false, nil
	}
	selected := matches[0]
	for _, candidate := range matches[1:] {
		if transportServiceExceptionsConflict(selected, candidate) {
			return transportServiceExceptionRecord{}, false, errors.New("source_conflict")
		}
		selected.RelatedNoticeRefs = appendUniqueTransportRefs(
			selected.RelatedNoticeRefs,
			candidate.RelatedNoticeRefs,
		)
	}
	return selected, true, nil
}

func transportServiceExceptionsConflict(
	left transportServiceExceptionRecord,
	right transportServiceExceptionRecord,
) bool {
	return strings.TrimSpace(left.ServiceStatus) != strings.TrimSpace(right.ServiceStatus) ||
		strings.TrimSpace(left.OperationalComment) != strings.TrimSpace(right.OperationalComment)
}

func buildTransportDepartures(
	records []scheduledDepartureRecord,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate time.Time,
) ([]scheduledDeparture, error) {
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
		departure, ok, err := buildTransportDeparture(record, route, serviceDate)
		if err != nil {
			return nil, err
		}
		if ok {
			departures = append(departures, departure)
		}
	}
	sort.SliceStable(departures, func(i, j int) bool {
		return departures[i].DepartureAt < departures[j].DepartureAt
	})
	return departures, nil
}

func buildTransportDeparture(
	record scheduledDepartureRecord,
	route transportRouteRecord,
	serviceDate time.Time,
) (scheduledDeparture, bool, error) {
	departureAt, ok := combineTransportDateAndTime(serviceDate, record.DepartureTime)
	if !ok {
		return scheduledDeparture{}, false, nil
	}
	arrivalAt := ""
	if record.ArrivalTime != "" {
		if parsed, ok := combineTransportDateAndTime(serviceDate, record.ArrivalTime); ok {
			arrivalAt = parsed.Format(time.RFC3339)
		}
	}
	departureStatus, err := normalizeTransportDepartureStatus(record.DepartureStatus)
	if err != nil {
		return scheduledDeparture{}, false, err
	}
	departureKind, err := normalizeTransportDepartureKind(record.DepartureKind)
	if err != nil {
		return scheduledDeparture{}, false, err
	}
	departure := scheduledDeparture{
		DepartureAt:        departureAt.Format(time.RFC3339),
		ArrivalAt:          arrivalAt,
		OriginStopRef:      stopRefByID(route, record.OriginStopID),
		DestinationStopRef: stopRefByID(route, record.DestinationStopID),
		DepartureStatus:    departureStatus,
		DepartureKind:      departureKind,
		OperationalNote:    strings.TrimSpace(record.OperationalComment),
		RelatedNoticeRefs:  appendUniqueTransportRefs(nil, record.RelatedNoticeRefs),
	}
	return departure, true, nil
}

func normalizeTransportDepartureStatus(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	switch normalized {
	case "":
		return "normal", nil
	case "added", "cancelled", "changed", "delayed", "normal":
		return normalized, nil
	default:
		return "", errors.New("source_truth_unavailable")
	}
}

func normalizeTransportDepartureKind(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	switch normalized {
	case "":
		return "other", nil
	case "student", "teacher", "other":
		return normalized, nil
	default:
		return "", errors.New("source_truth_unavailable")
	}
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
