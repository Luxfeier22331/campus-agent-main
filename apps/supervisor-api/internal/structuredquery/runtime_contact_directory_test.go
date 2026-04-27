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

func TestLookupContactDirectoryFailsClosedWhenFocusNotBacked(t *testing.T) {
	runtime := newRuntimeWithContactDirectoryReadModel(
		t,
		contactDirectoryProjectionFixture(),
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
	if result.FailCloseReason != "stable_contact_unavailable" {
		t.Fatalf("fail_close_reason = %q, want stable_contact_unavailable", result.FailCloseReason)
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
	releaseID string
	bundle    projectionBundle
	loadCount int
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

func (s *fakeContactDirectoryReadModelStore) LoadBundleForRelease(
	_ context.Context,
	_ string,
) (projectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}
