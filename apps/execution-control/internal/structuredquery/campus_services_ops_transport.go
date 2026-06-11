package structuredquery

import (
	"strings"
	"time"
)

func applyCampusServicesOpsTransportOverrides(
	bundle projectionBundle,
	release campusServicesOpsRelease,
	timeAnchor string,
) projectionBundle {
	anchor, anchorOK := parseCampusServicesOpsTimeAnchor(timeAnchor)
	for _, override := range release.CurrentEffective.TransportOverrides {
		if strings.TrimSpace(override.ReviewState) != "ready_for_publish" {
			continue
		}
		if !anchorOK || !campusServicesOpsTransportOverrideCurrentAt(override, anchor) {
			continue
		}
		routeID := strings.TrimSpace(override.RouteID)
		if routeID == "" {
			continue
		}
		serviceDate, ok := campusServicesOpsTransportOverrideServiceDate(override)
		if !ok {
			bundle.TransportOperationalNotices = append(
				bundle.TransportOperationalNotices,
				campusServicesOpsTransportOperationalNotice(release, override, routeID),
			)
			continue
		}
		for _, snapshot := range bundle.TransportScheduleSnapshots {
			if strings.TrimSpace(snapshot.SnapshotID) == "" ||
				!snapshotAppliesToServiceDate(snapshot, serviceDate) {
				continue
			}
			bundle.TransportServiceExceptions = append(
				bundle.TransportServiceExceptions,
				transportServiceExceptionRecord{
					SnapshotID:         snapshot.SnapshotID,
					RouteID:            routeID,
					ServiceDate:        serviceDate.Format(transportLocalDateLayout),
					ServiceStatus:      mapCampusServicesOpsTransportStatus(override.ServiceStatus),
					RelatedNoticeRefs:  campusServicesOpsTransportSourceRefs(release, override),
					OperationalComment: strings.TrimSpace(override.Message),
				},
			)
		}
		bundle.TransportOperationalNotices = append(
			bundle.TransportOperationalNotices,
			campusServicesOpsTransportOperationalNotice(release, override, routeID),
		)
	}
	return bundle
}

func parseCampusServicesOpsTimeAnchor(timeAnchor string) (time.Time, bool) {
	anchor, err := time.Parse(time.RFC3339, strings.TrimSpace(timeAnchor))
	if err != nil {
		return time.Time{}, false
	}
	return anchor, true
}

func campusServicesOpsTransportOverrideCurrentAt(
	override campusServicesOpsTransportOverride,
	anchor time.Time,
) bool {
	effectiveFrom, err := time.Parse(time.RFC3339, strings.TrimSpace(override.EffectiveFrom))
	if err != nil || anchor.Before(effectiveFrom) {
		return false
	}
	effectiveUntil, err := time.Parse(time.RFC3339, strings.TrimSpace(override.EffectiveUntil))
	return err == nil && anchor.Before(effectiveUntil)
}

func campusServicesOpsTransportOverrideServiceDate(
	override campusServicesOpsTransportOverride,
) (time.Time, bool) {
	effectiveFrom, err := time.Parse(time.RFC3339, strings.TrimSpace(override.EffectiveFrom))
	if err != nil {
		return time.Time{}, false
	}
	effectiveUntil, err := time.Parse(time.RFC3339, strings.TrimSpace(override.EffectiveUntil))
	if err != nil || !effectiveUntil.After(effectiveFrom) {
		return time.Time{}, false
	}
	fromDay := beginningOfTransportDay(effectiveFrom)
	untilDay := beginningOfTransportDay(effectiveUntil)
	if !untilDay.Equal(fromDay) && !untilDay.Equal(fromDay.AddDate(0, 0, 1)) {
		return time.Time{}, false
	}
	return fromDay, true
}

func campusServicesOpsTransportOperationalNotice(
	release campusServicesOpsRelease,
	override campusServicesOpsTransportOverride,
	routeID string,
) transportOperationalNoticeRecord {
	return transportOperationalNoticeRecord{
		NoticeID:           "campus_services_ops:override:" + strings.TrimSpace(override.OverrideID),
		SourceRef:          campusServicesOpsTransportPrimarySourceRef(release, override),
		NoticeKind:         "operator_curated_transport_override",
		RouteIDs:           []string{routeID},
		EffectiveFrom:      strings.TrimSpace(override.EffectiveFrom),
		EffectiveUntil:     strings.TrimSpace(override.EffectiveUntil),
		OperationalComment: strings.TrimSpace(override.Message),
	}
}

func mapCampusServicesOpsTransportStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "normal", "extra_service":
		return "running"
	case "delayed", "rerouted":
		return "limited_service"
	case "suspended", "temporarily_unavailable":
		return "temporarily_suspended"
	default:
		return status
	}
}

func campusServicesOpsTransportPrimarySourceRef(
	release campusServicesOpsRelease,
	override campusServicesOpsTransportOverride,
) string {
	refs := campusServicesOpsTransportSourceRefs(release, override)
	if len(refs) == 0 {
		return ""
	}
	return refs[0]
}

func campusServicesOpsTransportSourceRefs(
	release campusServicesOpsRelease,
	override campusServicesOpsTransportOverride,
) []string {
	refs := []string{}
	releaseID := strings.TrimSpace(release.ReleaseID)
	if releaseID != "" {
		refs = append(refs, "campus_services_ops:release:"+releaseID)
	}
	for _, attestationID := range override.SourceAttestationIDs {
		attestationID = strings.TrimSpace(attestationID)
		if attestationID == "" {
			continue
		}
		refs = append(refs, "campus_services_ops:attestation:"+attestationID)
	}
	return refs
}
