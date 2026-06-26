package structuredquery

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"
)

type TransportStatusProjection struct {
	Release TransportStatusRelease `json:"release"`
	Groups  []TransportStatusGroup `json:"groups"`
}

type TransportStatusRelease struct {
	ReleaseID   string   `json:"releaseId"`
	PublishedAt string   `json:"publishedAt"`
	SourceRefs  []string `json:"sourceRefs"`
}

type TransportStatusGroup struct {
	Kind   string                 `json:"kind"`
	Routes []TransportStatusRoute `json:"routes"`
}

type TransportStatusRoute struct {
	RouteID     string                     `json:"routeId"`
	DisplayName string                     `json:"displayName"`
	Departures  []TransportStatusDeparture `json:"departures"`
}

type TransportStatusDeparture struct {
	DepartureTime string   `json:"departureTime"`
	Kind          string   `json:"kind"`
	Status        string   `json:"status"`
	Note          string   `json:"note,omitempty"`
	SourceRefs    []string `json:"sourceRefs"`
}

func (r *Runtime) TransportStatusProjection(ctx context.Context) Response {
	if r.transportScheduleReadModelStore == nil {
		return transportStatusFailClosed("source_truth_unavailable")
	}
	releaseID, err := r.transportScheduleReadModelStore.CurrentReleaseID(ctx)
	if err != nil || strings.TrimSpace(releaseID) == "" {
		return transportStatusFailClosed("source_truth_unavailable")
	}
	bundle, err := loadProjectionBundleFromStore(
		ctx,
		r.transportScheduleReadModelStore,
		&r.transportScheduleBundleCache,
	)
	if err != nil {
		return transportStatusFailClosed("source_truth_unavailable")
	}
	if r.campusServicesOpsReleaseStore != nil {
		release, err := loadCampusServicesOpsReleaseFromStore(
			ctx,
			r.campusServicesOpsReleaseStore,
			&r.campusServicesOpsReleaseCache,
		)
		if err != nil {
			return transportStatusFailClosed("source_truth_unavailable")
		}
		bundle = applyCampusServicesOpsTransportOverrides(bundle, release, r.timeAnchor())
	}
	projection, err := buildTransportStatusProjection(releaseID, bundle, r.timeAnchor())
	if err != nil {
		return transportStatusFailClosed("source_truth_unavailable")
	}
	return Response{
		StatusCode: 200,
		Outcome:    "resolved_current",
		Body:       projection,
	}
}

func transportStatusFailClosed(reason string) Response {
	return Response{
		StatusCode: 503,
		Outcome:    reason,
		Body: map[string]any{
			"error": map[string]any{
				"code":      reason,
				"message":   "Transport status projection is unavailable.",
				"retryable": true,
			},
		},
	}
}

func buildTransportStatusProjection(
	releaseID string,
	bundle projectionBundle,
	timeAnchor string,
) (TransportStatusProjection, error) {
	anchor, err := time.Parse(time.RFC3339, strings.TrimSpace(timeAnchor))
	if err != nil {
		return TransportStatusProjection{}, err
	}
	snapshot, ok := currentTransportStatusSnapshot(bundle, anchor)
	if !ok {
		return TransportStatusProjection{}, errors.New("current transport status snapshot missing")
	}
	releaseRefs := appendUniqueTransportURLRefs(nil, []string{snapshot.SourceRef})
	if len(releaseRefs) == 0 {
		return TransportStatusProjection{}, errors.New("transport status release source refs missing")
	}
	serviceDate := beginningOfTransportDay(anchor)
	routes := buildTransportStatusRoutes(bundle, snapshot, serviceDate, releaseRefs)
	if len(routes) == 0 {
		return TransportStatusProjection{}, errors.New("transport status routes missing")
	}
	if !transportStatusRoutesHaveSourceRefs(routes) {
		return TransportStatusProjection{}, errors.New("transport status source refs missing")
	}
	return TransportStatusProjection{
		Release: TransportStatusRelease{
			ReleaseID:   strings.TrimSpace(releaseID),
			PublishedAt: strings.TrimSpace(snapshot.PublishedAt),
			SourceRefs:  releaseRefs,
		},
		Groups: []TransportStatusGroup{
			{
				Kind:   transportStatusGroupKind(snapshot),
				Routes: routes,
			},
		},
	}, nil
}

func currentTransportStatusSnapshot(
	bundle projectionBundle,
	anchor time.Time,
) (transportScheduleSnapshotRecord, bool) {
	selection, ok := selectTransportScheduleSnapshot(
		bundle,
		transportScheduleRequest{SnapshotQuery: temporalQuery{Mode: "current"}},
		anchor,
	)
	return selection.record, ok
}

func transportStatusGroupKind(snapshot transportScheduleSnapshotRecord) string {
	switch strings.TrimSpace(snapshot.ScheduleScope) {
	case "temporary_period", "temporary_period_revision", "exception_status":
		return "temporary"
	default:
		return "daily"
	}
}

func buildTransportStatusRoutes(
	bundle projectionBundle,
	snapshot transportScheduleSnapshotRecord,
	serviceDate time.Time,
	releaseRefs []string,
) []TransportStatusRoute {
	routes := append([]transportRouteRecord(nil), bundle.TransportRoutes...)
	statusRoutes := []TransportStatusRoute{}
	for _, route := range routes {
		departures := buildTransportStatusDepartures(bundle, snapshot, route, serviceDate, releaseRefs)
		if len(departures) == 0 {
			continue
		}
		statusRoutes = append(statusRoutes, TransportStatusRoute{
			RouteID:     strings.TrimSpace(route.RouteID),
			DisplayName: strings.TrimSpace(route.DisplayName),
			Departures:  departures,
		})
	}
	return statusRoutes
}

func buildTransportStatusDepartures(
	bundle projectionBundle,
	snapshot transportScheduleSnapshotRecord,
	route transportRouteRecord,
	serviceDate time.Time,
	releaseRefs []string,
) []TransportStatusDeparture {
	serviceDateText := serviceDate.Format(transportLocalDateLayout)
	departures := []TransportStatusDeparture{}
	for _, record := range bundle.ScheduledDepartures {
		if record.RouteID != route.RouteID {
			continue
		}
		if record.SnapshotID != "" && record.SnapshotID != snapshot.SnapshotID {
			continue
		}
		if len(record.ServiceDates) > 0 && !stringSliceContains(record.ServiceDates, serviceDateText) {
			continue
		}
		departure, ok := transportStatusDepartureFromRecord(record, releaseRefs)
		if ok {
			departures = append(departures, departure)
		}
	}
	if exception, ok, err := matchTransportServiceException(
		bundle.TransportServiceExceptions,
		snapshot,
		route,
		serviceDateText,
	); err == nil && ok {
		for index := range departures {
			departures[index] = applyTransportStatusException(departures[index], exception)
		}
	}
	sort.SliceStable(departures, func(i, j int) bool {
		return departures[i].DepartureTime < departures[j].DepartureTime
	})
	return departures
}

func transportStatusDepartureFromRecord(
	record scheduledDepartureRecord,
	releaseRefs []string,
) (TransportStatusDeparture, bool) {
	departureTime := strings.TrimSpace(record.DepartureTime)
	if _, err := time.Parse(transportWallTimeLayout, departureTime); err != nil {
		return TransportStatusDeparture{}, false
	}
	status, err := normalizeTransportDepartureStatus(record.DepartureStatus)
	if err != nil {
		return TransportStatusDeparture{}, false
	}
	kind, err := normalizeTransportDepartureKind(record.DepartureKind)
	if err != nil {
		return TransportStatusDeparture{}, false
	}
	sourceRefs := appendUniqueTransportURLRefs(nil, record.RelatedNoticeRefs)
	if len(sourceRefs) == 0 {
		sourceRefs = appendUniqueTransportURLRefs(nil, releaseRefs)
	}
	return TransportStatusDeparture{
		DepartureTime: departureTime,
		Kind:          kind,
		Status:        status,
		Note:          strings.TrimSpace(record.OperationalComment),
		SourceRefs:    sourceRefs,
	}, true
}

func applyTransportStatusException(
	departure TransportStatusDeparture,
	exception transportServiceExceptionRecord,
) TransportStatusDeparture {
	status := transportStatusFromServiceStatus(exception.ServiceStatus)
	if status != "" {
		departure.Status = status
	}
	note := strings.TrimSpace(exception.OperationalComment)
	if note != "" {
		departure.Note = note
	}
	departure.SourceRefs = appendUniqueTransportRefs(
		appendUniqueTransportURLRefs(nil, exception.RelatedNoticeRefs),
		departure.SourceRefs,
	)
	return departure
}

func transportStatusRoutesHaveSourceRefs(routes []TransportStatusRoute) bool {
	for _, route := range routes {
		for _, departure := range route.Departures {
			if len(departure.SourceRefs) == 0 {
				return false
			}
			for _, ref := range departure.SourceRefs {
				if !isTransportStatusURLRef(ref) {
					return false
				}
			}
		}
	}
	return true
}

func appendUniqueTransportURLRefs(existing []string, refs []string) []string {
	return appendUniqueTransportRefs(existing, filterTransportStatusURLRefs(refs))
}

func filterTransportStatusURLRefs(refs []string) []string {
	urls := []string{}
	for _, ref := range refs {
		ref = strings.TrimSpace(ref)
		if isTransportStatusURLRef(ref) {
			urls = append(urls, ref)
		}
	}
	return urls
}

func isTransportStatusURLRef(ref string) bool {
	ref = strings.TrimSpace(ref)
	return strings.HasPrefix(ref, "https://") || strings.HasPrefix(ref, "http://")
}

func transportStatusFromServiceStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "running":
		return "normal"
	case "limited_service":
		return "changed"
	case "temporarily_suspended":
		return "cancelled"
	default:
		return ""
	}
}
