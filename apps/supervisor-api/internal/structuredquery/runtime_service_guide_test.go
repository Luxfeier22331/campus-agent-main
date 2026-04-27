package structuredquery

import (
	"context"
	"strings"
	"testing"
)

func TestLookupServiceGuideResolvesReadyProcedure(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(serviceGuideResult)
	if !ok {
		t.Fatalf("body = %T, want serviceGuideResult", response.Body)
	}
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.DisplayName != "公寓楼新生办理入住手续流程" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "到指定公寓楼报到") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
	if len(result.SourceRefs) != 1 || result.SourceRefs[0] != "handbook:student_rules:pages:252-255#page=253" {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupServiceGuideClarifiesAmbiguousService(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"退宿怎么办",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.ClarificationReason != "service_ambiguous" {
		t.Fatalf("clarification_reason = %q", result.ClarificationReason)
	}
	if len(result.CandidateServices) != 2 {
		t.Fatalf("candidate_services length = %d, want 2", len(result.CandidateServices))
	}
}

func TestLookupServiceGuideFailsClosedForLegacyManualReviewRecordAsSourceUnavailable(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideManualReviewFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceGuideReturnsPublicMedicalRequiredMaterials(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuidePublicMedicalProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销需要什么材料",
		"guide_focus":"required_materials",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.DisplayName != "公费医疗报销办理指南" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	materialNames := map[string]bool{}
	for _, material := range result.RequiredMaterials {
		materialNames[material.Name] = true
	}
	for _, name := range []string{"急诊证明", "住院收据", "住院费明细单", "出院手续"} {
		if !materialNames[name] {
			t.Fatalf("required_materials missing %q: %#v", name, result.RequiredMaterials)
		}
	}
	if len(result.SourceRefs) == 0 || result.SourceRefs[0] != "handbook:student_rules:pages:259-260#page=259" {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupServiceGuideUsesDedicatedReadModelStore(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuidePublicMedicalProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销需要什么材料",
		"guide_focus":"required_materials",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.DisplayName != "公费医疗报销办理指南" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
}

func TestLookupServiceGuideResolvesTransportReservationEntry(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideTransportReservationProjectionFixture(),
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"地铁接驳车预约入口在哪里",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"campus_scope":"fengtai",
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:transport-reservation:subway-shuttle" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.EntryRefs) != 2 || result.EntryRefs[0].Label != "服务门户" {
		t.Fatalf("entry_refs = %#v", result.EntryRefs)
	}
	if !testStringSliceContains(result.SourceRefs, "notice:muc_internal_portal:354777") {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupServiceGuideResolvesTransportReservationNaturalProcedureQuery(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideTransportReservationProjectionFixture(),
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"地铁接驳车怎么预约",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil ||
		result.ResolvedService.ServiceID != "service:transport-reservation:subway-shuttle" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "9:00开放预约") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
}

func TestLookupServiceGuideReadsPostgresReadModelWithoutProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		ServiceGuideReadModelStore: &fakeServiceGuideReadModelStore{
			bundle: mustProjectionBundle(t, serviceGuideTransportReservationProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-27T10:30:00+08:00",
	})

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"地铁接驳车预约入口在哪里",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"campus_scope":"fengtai",
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil ||
		result.ResolvedService.ServiceID != "service:transport-reservation:subway-shuttle" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	status := runtime.Status(context.Background())
	if status.ProjectionSource != "postgres" || !status.ServiceGuideReadModelConfigured {
		t.Fatalf("status = %#v", status)
	}
}

func TestLookupServiceGuideResolvesCampusCardLostFullGuide(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideCampusCardProjectionFixture(),
		"2026-04-27T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校园卡丢了怎么办",
		"guide_focus":"full_guide",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil ||
		result.ResolvedService.ServiceID != "service:campus-card:lost-reissue" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 4 {
		t.Fatalf("guide_sections length = %d, want 4", len(result.GuideSections))
	}
	if len(result.EntryRefs) != 3 {
		t.Fatalf("entry_refs = %#v", result.EntryRefs)
	}
	if len(result.ContactRefs) != 2 ||
		result.ContactRefs[0].Phone != "010-68933381" ||
		result.ContactRefs[1].Phone != "010-83878225" {
		t.Fatalf("contact_refs = %#v", result.ContactRefs)
	}
	if !testStringSliceContains(result.SourceRefs, "https://met.muc.edu.cn/info/1027/1127.htm") ||
		!testStringSliceContains(result.SourceRefs, "https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/") {
		t.Fatalf("source_refs = %#v", result.SourceRefs)
	}
}

func TestLookupServiceGuideResolvesCampusCardEntryAndContactFocus(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideCampusCardProjectionFixture(),
		"2026-04-27T10:30:00+08:00",
	)

	entryResponse := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校园卡在哪里补办",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	entryResult := entryResponse.Body.(serviceGuideResult)
	if entryResult.Outcome != "resolved_current" {
		t.Fatalf("entry outcome = %q, want resolved_current", entryResult.Outcome)
	}
	if len(entryResult.EntryRefs) != 3 ||
		entryResult.EntryRefs[1].LocationRef != "中慧楼二层" ||
		entryResult.EntryRefs[2].LocationRef != "智慧中心一层大厅" {
		t.Fatalf("entry_refs = %#v", entryResult.EntryRefs)
	}

	contactResponse := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"一卡通挂失电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	contactResult := contactResponse.Body.(serviceGuideResult)
	if contactResult.Outcome != "resolved_current" {
		t.Fatalf("contact outcome = %q, want resolved_current", contactResult.Outcome)
	}
	if len(contactResult.ContactRefs) != 2 ||
		contactResult.ContactRefs[0].Phone != "010-68933381" ||
		contactResult.ContactRefs[1].Phone != "010-83878225" {
		t.Fatalf("contact_refs = %#v", contactResult.ContactRefs)
	}
}

func TestLookupServiceGuideFailsClosedForLegacyManualReviewSourceAsSourceUnavailable(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideManualReviewSourceFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceGuideRejectsInvalidTemporalQuery(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current_year"},
		"audience":"student"
	}`))

	if response.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
	if response.Outcome != "invalid_request" {
		t.Fatalf("outcome = %q, want invalid_request", response.Outcome)
	}
}

func TestLookupServiceGuideFailsClosedWhenRequestedFocusIsNotBackedBySource(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuidePublicMedicalProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销联系电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceGuideIncludesContactSourceRefs(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideContactProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"公费医疗报销联系电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.ContactRefs) != 1 || result.ContactRefs[0].Phone != "68930000" {
		t.Fatalf("contact_refs = %#v", result.ContactRefs)
	}
	if !testStringSliceContains(result.SourceRefs, "handbook:student_rules:pages:261-261#page=261") {
		t.Fatalf("source_refs = %#v, want contact source ref", result.SourceRefs)
	}
}

func newRuntimeWithServiceGuideReadModel(
	t *testing.T,
	payload string,
	trustedTime string,
) *Runtime {
	t.Helper()
	return NewRuntime(Options{
		ServiceGuideReadModelStore: &fakeServiceGuideReadModelStore{
			bundle: mustProjectionBundle(t, payload),
		},
		TrustedTimeRFC3339: trustedTime,
	})
}

type fakeServiceGuideReadModelStore struct {
	releaseID string
	bundle    projectionBundle
	loadCount int
}

func (s fakeServiceGuideReadModelStore) HealthCheck(context.Context) error {
	return nil
}

func (s *fakeServiceGuideReadModelStore) CurrentReleaseID(context.Context) (string, error) {
	if s.releaseID == "" {
		return "service-guide-release-1", nil
	}
	return s.releaseID, nil
}

func (s *fakeServiceGuideReadModelStore) LoadBundleForRelease(
	_ context.Context,
	_ string,
) (projectionBundle, error) {
	s.loadCount++
	return s.bundle, nil
}
