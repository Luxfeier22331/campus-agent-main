package structuredquery

import "testing"

func TestServiceStatusRecordsFromCampusServicesOpsReleaseNormalizesCamelCaseSnapshot(t *testing.T) {
	release := normalizeCampusServicesOpsRelease(campusServicesOpsRelease{
		ReleaseID: "services_release_current",
		CurrentEffective: campusServicesOpsCurrentEffectiveSnapshot{
			StatusOverrides: []campusServicesOpsStatusOverride{
				{
					OverrideID:           "services_status_override_1",
					ServiceID:            "medical_insurance_counter",
					DisplayName:          "医保窗口",
					Status:               "limited",
					Message:              "今天只办理材料收取",
					EffectiveFrom:        "2026-06-11T10:00:00+08:00",
					EffectiveUntil:       "2026-06-11T15:00:00+08:00",
					SourceAttestationIDs: []string{"services_attestation_counselor_1"},
					ReviewState:          "ready_for_publish",
				},
			},
		},
	})

	records := serviceStatusRecordsFromCampusServicesOpsRelease(release)

	if len(records) != 1 {
		t.Fatalf("records len = %d, want 1", len(records))
	}
	record := records[0]
	if record.SubjectID != "medical_insurance_counter" || record.DisplayName != "医保窗口" {
		t.Fatalf("record identity = %#v", record)
	}
	if record.ObservedStatus != "limited_service" {
		t.Fatalf("observed_status = %q, want limited_service", record.ObservedStatus)
	}
}

func TestServiceStatusRecordsFromCampusServicesOpsReleaseNormalizesSnakeCaseSnapshot(t *testing.T) {
	release := normalizeCampusServicesOpsRelease(campusServicesOpsRelease{
		ReleaseID: "services_release_current",
		CurrentEffective: campusServicesOpsCurrentEffectiveSnapshot{
			StatusOverridesSnake: []campusServicesOpsStatusOverride{
				{
					OverrideIDSnake:           "services_status_override_1",
					ServiceIDSnake:            "medical_insurance_counter",
					DisplayNameSnake:          "医保窗口",
					Status:                    "temporarily_unavailable",
					Message:                   "今天暂停线下办理",
					EffectiveFromSnake:        "2026-06-11T10:00:00+08:00",
					EffectiveUntilSnake:       "2026-06-11T15:00:00+08:00",
					SourceAttestationIDsSnake: []string{"services_attestation_counselor_1"},
					ReviewStateSnake:          "ready_for_publish",
				},
			},
		},
	})

	records := serviceStatusRecordsFromCampusServicesOpsRelease(release)

	if len(records) != 1 {
		t.Fatalf("records len = %d, want 1", len(records))
	}
	record := records[0]
	if record.ObservedStatus != "temporarily_closed" {
		t.Fatalf("observed_status = %q, want temporarily_closed", record.ObservedStatus)
	}
	if len(record.OverrideSourceRefs) != 2 ||
		record.OverrideSourceRefs[1] != "campus_services_ops:attestation:services_attestation_counselor_1" {
		t.Fatalf("override_source_refs = %#v", record.OverrideSourceRefs)
	}
}
