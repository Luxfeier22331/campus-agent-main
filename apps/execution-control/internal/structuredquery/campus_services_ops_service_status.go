package structuredquery

import "strings"

func serviceStatusRecordsFromCampusServicesOpsRelease(
	release campusServicesOpsRelease,
) []serviceStatusRecord {
	records := []serviceStatusRecord{}
	for _, override := range release.CurrentEffective.StatusOverrides {
		if strings.TrimSpace(override.ReviewState) != "ready_for_publish" {
			continue
		}
		records = append(records, serviceStatusRecord{
			SubjectID:          strings.TrimSpace(override.ServiceID),
			DisplayName:        strings.TrimSpace(override.DisplayName),
			ServiceFamily:      "service_counter",
			Aliases:            []string{strings.TrimSpace(override.ServiceID)},
			CampusScope:        "all",
			AffectedScope:      "operator_curated_override",
			ObservedStatus:     mapCampusServicesOpsObservedStatus(override.Status),
			StatusReason:       "operator_curated_override",
			StatusNote:         strings.TrimSpace(override.Message),
			Severity:           "operator_curated",
			EffectiveFrom:      strings.TrimSpace(override.EffectiveFrom),
			EffectiveUntil:     strings.TrimSpace(override.EffectiveUntil),
			OverrideSourceRefs: campusServicesOpsOverrideSourceRefs(release, override),
			ExtractionStatus:   "operator_curated",
			SearchText: strings.TrimSpace(
				override.ServiceID + " " + override.DisplayName + " " + override.Message,
			),
		})
	}
	return records
}

func mapCampusServicesOpsObservedStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "open":
		return "open"
	case "limited":
		return "limited_service"
	case "closed", "temporarily_unavailable":
		return "temporarily_closed"
	default:
		return status
	}
}

func campusServicesOpsOverrideSourceRefs(
	release campusServicesOpsRelease,
	override campusServicesOpsStatusOverride,
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
