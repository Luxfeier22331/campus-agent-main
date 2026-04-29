package structuredquery

import (
	"sort"
	"strings"
	"time"
)

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

func selectTransportScheduleSnapshotForServiceDate(
	bundle projectionBundle,
	request transportScheduleRequest,
	anchor time.Time,
	route transportRouteRecord,
	serviceDate time.Time,
) (transportSnapshotSelection, bool) {
	switch request.SnapshotQuery.Mode {
	case "current", "effective", "":
		candidates := make([]transportScheduleSnapshotRecord, 0, len(bundle.TransportScheduleSnapshots))
		for _, snapshot := range bundle.TransportScheduleSnapshots {
			if !snapshotCoversRouteServiceDate(bundle, snapshot, route, serviceDate) {
				continue
			}
			candidates = append(candidates, snapshot)
		}
		if len(candidates) == 0 {
			return transportSnapshotSelection{}, false
		}
		sort.SliceStable(candidates, func(i, j int) bool {
			leftPrecedence := snapshotPrecedence(candidates[i])
			rightPrecedence := snapshotPrecedence(candidates[j])
			if leftPrecedence != rightPrecedence {
				return leftPrecedence > rightPrecedence
			}
			return candidates[i].PublishedAt > candidates[j].PublishedAt
		})
		return transportSnapshotSelection{
			record:  candidates[0],
			outcome: "resolved_current",
		}, true
	default:
		return selectTransportScheduleSnapshot(bundle, request, anchor)
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

func snapshotAppliesToServiceDate(
	snapshot transportScheduleSnapshotRecord,
	serviceDate time.Time,
) bool {
	if len(snapshot.ServiceDateRanges) > 0 {
		for _, dateRange := range snapshot.ServiceDateRanges {
			if transportServiceDateInRange(serviceDate, dateRange) {
				return true
			}
		}
		return false
	}
	serviceDay := beginningOfTransportDay(serviceDate)
	if snapshot.EffectiveFrom != "" {
		effectiveFrom, err := time.Parse(time.RFC3339, snapshot.EffectiveFrom)
		if err != nil {
			return false
		}
		if serviceDay.Before(beginningOfTransportDay(effectiveFrom)) {
			return false
		}
	}
	if snapshot.EffectiveUntil != "" {
		effectiveUntil, err := time.Parse(time.RFC3339, snapshot.EffectiveUntil)
		if err != nil {
			return false
		}
		if !serviceDay.Before(beginningOfTransportDay(effectiveUntil)) {
			return false
		}
	}
	return snapshot.IsCurrent || snapshot.EffectiveFrom != "" || snapshot.PublishedAt != ""
}

func snapshotCoversRouteServiceDate(
	bundle projectionBundle,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate time.Time,
) bool {
	if len(snapshot.ServiceDateRanges) > 0 {
		return snapshotAppliesToServiceDate(snapshot, serviceDate) &&
			snapshotHasAnyRouteServiceData(bundle, snapshot, route)
	}
	return snapshotInferredRouteServiceDateSpanCovers(bundle, snapshot, route, serviceDate)
}

func snapshotHasAnyRouteServiceData(
	bundle projectionBundle,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
) bool {
	for _, departure := range bundle.ScheduledDepartures {
		if departure.RouteID == route.RouteID && departureMatchesSnapshot(departure, snapshot) {
			return true
		}
	}
	for _, exception := range bundle.TransportServiceExceptions {
		if exception.RouteID == route.RouteID && exceptionMatchesSnapshot(exception, snapshot) {
			return true
		}
	}
	return false
}

func snapshotInferredRouteServiceDateSpanCovers(
	bundle projectionBundle,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate time.Time,
) bool {
	serviceDay := beginningOfTransportDay(serviceDate)
	var earliest time.Time
	var latest time.Time
	hasDatedService := false
	for _, departure := range bundle.ScheduledDepartures {
		if departure.RouteID != route.RouteID || !departureMatchesSnapshot(departure, snapshot) {
			continue
		}
		if len(departure.ServiceDates) == 0 {
			return snapshotAppliesToServiceDate(snapshot, serviceDate)
		}
		for _, serviceDateText := range departure.ServiceDates {
			parsed, err := time.ParseInLocation(
				transportLocalDateLayout,
				serviceDateText,
				transportLocation,
			)
			if err != nil {
				continue
			}
			earliest, latest = expandTransportServiceDateSpan(earliest, latest, parsed)
			hasDatedService = true
		}
	}
	for _, exception := range bundle.TransportServiceExceptions {
		if exception.RouteID != route.RouteID || !exceptionMatchesSnapshot(exception, snapshot) {
			continue
		}
		parsed, err := time.ParseInLocation(
			transportLocalDateLayout,
			exception.ServiceDate,
			transportLocation,
		)
		if err != nil {
			continue
		}
		earliest, latest = expandTransportServiceDateSpan(earliest, latest, parsed)
		hasDatedService = true
	}
	return hasDatedService &&
		!serviceDay.Before(beginningOfTransportDay(earliest)) &&
		!serviceDay.After(beginningOfTransportDay(latest))
}

func expandTransportServiceDateSpan(
	earliest time.Time,
	latest time.Time,
	candidate time.Time,
) (time.Time, time.Time) {
	candidate = beginningOfTransportDay(candidate)
	if earliest.IsZero() || candidate.Before(earliest) {
		earliest = candidate
	}
	if latest.IsZero() || candidate.After(latest) {
		latest = candidate
	}
	return earliest, latest
}

func departureMatchesSnapshot(
	departure scheduledDepartureRecord,
	snapshot transportScheduleSnapshotRecord,
) bool {
	return departure.SnapshotID == "" || departure.SnapshotID == snapshot.SnapshotID
}

func exceptionMatchesSnapshot(
	exception transportServiceExceptionRecord,
	snapshot transportScheduleSnapshotRecord,
) bool {
	return exception.SnapshotID == "" || exception.SnapshotID == snapshot.SnapshotID
}

func transportServiceDateInRange(
	serviceDate time.Time,
	dateRange transportSnapshotServiceDateRange,
) bool {
	startDate, err := time.ParseInLocation(
		transportLocalDateLayout,
		dateRange.StartDate,
		transportLocation,
	)
	if err != nil {
		return false
	}
	endDate, err := time.ParseInLocation(
		transportLocalDateLayout,
		dateRange.EndDate,
		transportLocation,
	)
	if err != nil {
		return false
	}
	serviceDay := beginningOfTransportDay(serviceDate)
	return !serviceDay.Before(startDate) && !serviceDay.After(endDate)
}

func snapshotHasRouteServiceData(
	bundle projectionBundle,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate string,
) bool {
	for _, departure := range bundle.ScheduledDepartures {
		if !departureMatchesSnapshot(departure, snapshot) {
			continue
		}
		if departure.RouteID != route.RouteID {
			continue
		}
		if len(departure.ServiceDates) == 0 || stringSliceContains(departure.ServiceDates, serviceDate) {
			return true
		}
	}
	for _, exception := range bundle.TransportServiceExceptions {
		if !exceptionMatchesSnapshot(exception, snapshot) {
			continue
		}
		if exception.RouteID == route.RouteID && exception.ServiceDate == serviceDate {
			return true
		}
	}
	return false
}

func snapshotPrecedence(snapshot transportScheduleSnapshotRecord) int {
	if snapshot.Precedence > 0 {
		return snapshot.Precedence
	}
	switch snapshot.ScheduleScope {
	case "exception_status":
		return 400
	case "temporary_period_revision":
		return 300
	case "temporary_period":
		return 250
	case "baseline_revision":
		return 100
	}
	if snapshot.IsCurrent {
		return 100
	}
	return 0
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
