package structuredquery

import (
	"context"
	"testing"
)

func TestLookupContactDirectoryResolvesPhone(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		contactDirectoryProjectionFixture(),
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"研究生院招生办公室电话是多少",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(contactDirectoryResult)
	if !ok {
		t.Fatalf("body = %T, want contactDirectoryResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedContact == nil || result.ResolvedContact.DisplayName != "研究生院招生办公室" {
		t.Fatalf("resolved_contact = %#v", result.ResolvedContact)
	}
	if len(result.ContactPoints) != 1 || result.ContactPoints[0].Value != "010-68930001" {
		t.Fatalf("contact_points = %#v", result.ContactPoints)
	}
}

func TestLookupContactDirectoryMatchesTargetAliasWithQuestionSuffix(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		`{
			"schema_version":"campus_services_contact_directory_projection.v1",
			"contact_records":[
				{
					"contact_id":"contact:official-web:information-disclosure",
					"display_name":"联系方式",
					"aliases":["联系方式","中央民族大学信息公开联系方式"],
					"contact_group":"official_web",
					"department":"联系方式",
					"phones":[
						{
							"phone_id":"contact:official-web:information-disclosure:phone:1",
							"label":"电话号码",
							"number":"010-68932551",
							"source_refs":["official_web:muc-information-disclosure-contact:owver"]
						}
					],
					"source_refs":["official_web:muc-information-disclosure-contact:owver"],
					"extraction_status":"ready"
				}
			],
			"conflict_records":[],
			"manual_review_sources":[]
		}`,
		"2026-05-02T12:50:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"信息公开联系电话是多少",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.ContactPoints) != 1 || result.ContactPoints[0].Value != "010-68932551" {
		t.Fatalf("contact_points = %#v", result.ContactPoints)
	}
}

func TestLookupContactDirectoryPrefersExactDepartmentOverLongAlias(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		`{
			"schema_version":"campus_services_contact_directory_projection.v1",
			"contact_records":[
				{
					"contact_id":"contact:official-web:muc-homepage",
					"display_name":"中央民族大学",
					"aliases":["中央民族大学","中央民族大学主页页脚联系方式"],
					"contact_group":"official_web",
					"department":"中央民族大学",
					"phones":[
						{
							"phone_id":"contact:official-web:muc-homepage:phone:1",
							"label":"电话号码",
							"number":"010-68932442",
							"source_refs":["official_web:muc-main-homepage-contact:owver"]
						}
					],
					"location_refs":[
						{
							"label":"办公地点",
							"location_ref":"海淀校区：北京市海淀区中关村南大街27号",
							"address_text":"海淀校区：北京市海淀区中关村南大街27号",
							"source_refs":["official_web:muc-main-homepage-contact:owver"]
						}
					],
					"source_refs":["official_web:muc-main-homepage-contact:owver"],
					"extraction_status":"ready"
				},
				{
					"contact_id":"contact:official-web:information-disclosure",
					"display_name":"联系方式",
					"aliases":["联系方式","中央民族大学信息公开联系方式"],
					"contact_group":"official_web",
					"department":"联系方式",
					"phones":[
						{
							"phone_id":"contact:official-web:information-disclosure:phone:1",
							"label":"电话号码",
							"number":"010-68932551",
							"source_refs":["official_web:muc-information-disclosure-contact:owver"]
						}
					],
					"source_refs":["official_web:muc-information-disclosure-contact:owver"],
					"extraction_status":"ready"
				}
			],
			"conflict_records":[],
			"manual_review_sources":[]
		}`,
		"2026-05-02T12:50:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"中央民族大学电话地址",
		"contact_focus":"phone",
		"entity_selector":{"department_query":"中央民族大学"},
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current; candidates = %#v", result.Outcome, result.CandidateContacts)
	}
	if result.ResolvedContact == nil || result.ResolvedContact.DisplayName != "中央民族大学" {
		t.Fatalf("resolved_contact = %#v", result.ResolvedContact)
	}
	if len(result.ContactPoints) != 1 || result.ContactPoints[0].Value != "010-68932442" {
		t.Fatalf("contact_points = %#v", result.ContactPoints)
	}
}

func TestLookupContactDirectoryMatchesContactPointAndHoursLabels(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		`{
			"schema_version":"campus_services_contact_directory_projection.v1",
			"contact_records":[
				{
					"contact_id":"contact:security-duty-office",
					"display_name":"校园安全值班室",
					"department":"保卫处",
					"entity_type":"office",
					"contact_points":[
						{
							"channel_type":"phone",
							"label":"夜间值班电话",
							"value":"010-68931110",
							"contact_type":"duty_hotline",
							"area_served":"校园安全",
							"source_refs":["official_web:security-office:contact"]
						}
					],
					"office_hours":[
						{
							"hours_id":"hours:security-duty-office:night",
							"label":"夜间值班",
							"day_pattern":"每日",
							"time_range":"18:00-08:00",
							"source_refs":["official_web:security-office:contact"]
						}
					],
					"source_refs":["official_web:security-office:contact"],
					"extraction_status":"ready"
				}
			],
			"contact_conflict_records":[],
			"contact_manual_review_sources":[]
		}`,
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"校园安全夜间值班电话",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.ContactPoints) != 1 || result.ContactPoints[0].Value != "010-68931110" {
		t.Fatalf("contact_points = %#v", result.ContactPoints)
	}

	hoursResponse := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"校园安全夜间值班时间",
		"contact_focus":"office_hours",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))
	hoursResult := hoursResponse.Body.(contactDirectoryResult)
	if hoursResult.Outcome != "resolved_current" {
		t.Fatalf("hours outcome = %q, want resolved_current", hoursResult.Outcome)
	}
	if len(hoursResult.OfficeHours) != 1 || hoursResult.OfficeHours[0].TimeRange != "18:00-08:00" {
		t.Fatalf("office_hours = %#v", hoursResult.OfficeHours)
	}
}

func TestLookupContactDirectoryClarifiesAmbiguousEntity(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		`{
			"schema_version":"campus_services_contact_directory_projection.v1",
			"contact_records":[
				{
					"contact_id":"contact:undergrad-admission-office",
					"display_name":"本科招生办公室",
					"aliases":["招生办公室"],
					"contact_group":"招生咨询",
					"department":"本科招生",
					"phones":[
						{"phone_id":"phone:1","label":"咨询","number":"010-68931111","source_refs":["handbook:contact-directory"]}
					],
					"source_refs":["handbook:contact-directory"],
					"extraction_status":"ready"
				},
				{
					"contact_id":"contact:grad-admission-office",
					"display_name":"研究生院招生办公室",
					"aliases":["招生办公室"],
					"contact_group":"招生咨询",
					"department":"研究生院",
					"phones":[
						{"phone_id":"phone:2","label":"咨询","number":"010-68932222","source_refs":["handbook:contact-directory"]}
					],
					"source_refs":["handbook:contact-directory"],
					"extraction_status":"ready"
				}
			],
			"contact_conflict_records":[],
			"contact_manual_review_sources":[]
		}`,
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"招生办公室电话是多少",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.ClarificationReason != "contact_entity_ambiguous" {
		t.Fatalf("clarification_reason = %q, want contact_entity_ambiguous", result.ClarificationReason)
	}
	if len(result.CandidateContacts) != 2 {
		t.Fatalf("candidate_contacts length = %d, want 2", len(result.CandidateContacts))
	}
}

func TestLookupContactDirectoryFailsClosedForManualReviewSource(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		`{
			"schema_version":"campus_services_contact_directory_projection.v1",
			"contact_records":[
				{
					"contact_id":"contact:grad-admission-office",
					"display_name":"研究生院招生办公室",
					"aliases":["研究生招生办","招生办公室"],
					"contact_group":"招生咨询",
					"department":"研究生院",
					"phones":[
						{
							"phone_id":"phone:grad-admission-office:01068930001",
							"label":"招生咨询",
							"number":"010-68930001",
							"source_refs":["handbook:contact-directory:2026#page=261"]
						}
					],
					"source_refs":["handbook:contact-directory:2026#page=261"],
					"extraction_status":"ready"
				}
			],
			"contact_conflict_records":[],
			"contact_manual_review_sources":[
				{
					"source_ref":"handbook:contact-directory:2026#page=261",
					"reason":"unparsed_handbook_phone_line",
					"line":"未知联系方式行"
				}
			]
		}`,
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"研究生院招生办公室电话是多少",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupContactDirectoryFailsClosedWhenFocusWasNotProvidedBySource(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		`{
			"schema_version":"campus_services_contact_directory_projection.v1",
			"contact_records":[
				{
					"contact_id":"contact:grad-admission-office",
					"display_name":"研究生院招生办公室",
					"aliases":["研究生招生办","招生办公室"],
					"contact_group":"招生咨询",
					"department":"研究生院",
					"phones":[
						{
							"phone_id":"phone:grad-admission-office:01068930001",
							"label":"招生咨询",
							"number":"010-68930001",
							"source_refs":["handbook:contact-directory:2026#page=261"]
						}
					],
					"field_status":{"office_hours":"source_not_provided"},
					"source_refs":["handbook:contact-directory:2026#page=261"],
					"extraction_status":"ready"
				}
			],
			"contact_conflict_records":[],
			"contact_manual_review_sources":[]
		}`,
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"研究生院招生办公室办公时间",
		"contact_focus":"office_hours",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "field_not_provided_by_source" {
		t.Fatalf("fail_close_reason = %q, want field_not_provided_by_source", result.FailCloseReason)
	}
	if result.FieldStatus["office_hours"] != "source_not_provided" {
		t.Fatalf("field_status = %#v", result.FieldStatus)
	}
}

func TestLookupContactDirectoryReadsPostgresReadModelWithoutProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		ContactDirectoryReadModelStore: &fakeContactDirectoryReadModelStore{
			bundle: mustProjectionBundle(t, contactDirectoryProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-27T10:30:00+08:00",
	})

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"研究生院招生办公室电话是多少",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	status := runtime.Status(context.Background())
	if status.ProjectionSource != "postgres" || !status.ContactDirectoryReadModelConfigured {
		t.Fatalf("status = %#v", status)
	}
}

func TestLookupContactDirectoryLoadsOnlyCurrentPointerRelease(t *testing.T) {
	store := &fakeContactDirectoryReadModelStore{
		bundle:    mustProjectionBundle(t, contactDirectoryProjectionFixture()),
		releaseID: "contact-directory-current-release",
	}
	runtime := NewRuntime(Options{
		ContactDirectoryReadModelStore: store,
		TrustedTimeRFC3339:             "2026-04-27T10:30:00+08:00",
	})

	response := runtime.LookupContactDirectory(context.Background(), []byte(`{
		"query_text":"研究生院招生办公室电话是多少",
		"contact_focus":"phone",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(contactDirectoryResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(store.loadedReleaseIDs) != 1 || store.loadedReleaseIDs[0] != "contact-directory-current-release" {
		t.Fatalf("loadedReleaseIDs = %#v, want current pointer release only", store.loadedReleaseIDs)
	}
}

func newRuntimeWithContactDirectoryReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		ContactDirectoryReadModelStore: &fakeContactDirectoryReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

type fakeContactDirectoryReadModelStore struct {
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	loadedReleaseIDs   []string
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
}

func (s fakeContactDirectoryReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeContactDirectoryReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "contact-directory-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeContactDirectoryReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.ContactDirectoryRecords) > 0, nil
}

func (s *fakeContactDirectoryReadModelStore) LoadBundleForRelease(
	_ context.Context,
	releaseID string,
) (projectionBundle, error) {
	s.loadCount++
	s.loadedReleaseIDs = append(s.loadedReleaseIDs, releaseID)
	return s.bundle, nil
}
