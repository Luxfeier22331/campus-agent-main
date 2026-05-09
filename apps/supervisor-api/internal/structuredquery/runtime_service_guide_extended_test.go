package structuredquery

import (
	"context"
	"strings"
	"testing"
)

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

func TestLookupServiceGuideFailsClosedWhenRequestedFocusWasNotProvidedBySource(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		strings.Replace(
			serviceGuidePublicMedicalProjectionFixture(),
			`"extraction_status":"ready"`,
			`"field_status":{"contact":"source_not_provided"},"extraction_status":"ready"`,
			1,
		),
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
	if result.FailCloseReason != "field_not_provided_by_source" {
		t.Fatalf("fail_close_reason = %q, want field_not_provided_by_source", result.FailCloseReason)
	}
	if result.FieldStatus["contact"] != "source_not_provided" {
		t.Fatalf("field_status = %#v", result.FieldStatus)
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

func TestLookupServiceGuideResolvesEnterpriseWechatProcedure(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"企业微信怎么绑定",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:enterprise-wechat" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "关注“中央民族大学企业微信”") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
}

func TestLookupServiceGuideResolvesEnterpriseWechatFaqProcedure(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"企业微信提示需要同事扫码验证怎么办",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:enterprise-wechat-faq" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.ProcedureGroups) != 1 {
		t.Fatalf("procedure_groups = %#v", result.ProcedureGroups)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "重新完成关注和验证") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
}

func TestLookupServiceGuideResolvesEnterpriseWechatPhoneUpdateProcedure(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"企业微信绑定手机号怎么改",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:enterprise-wechat-phone-update" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "个人中心") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
}

func TestLookupServiceGuideResolvesDirectoryLookupProcedure(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"通讯录在哪里找",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:directory-lookup" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "信息门户通讯录") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
}

func TestLookupServiceGuideResolvesAcademicCalendarProcedure(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校历怎么看",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:academic-calendar-guide" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "校历栏目") {
		t.Fatalf("guide_sections = %#v", result.GuideSections)
	}
}

func TestLookupServiceGuideResolvesAcademicCalendarEntryURL(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校历在哪里看",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:academic-calendar-guide" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.EntryRefs) != 1 {
		t.Fatalf("entry_refs = %#v, want 1", result.EntryRefs)
	}
	if result.EntryRefs[0].URL != "https://www.muc.edu.cn/ggfw/mdxl.htm" {
		t.Fatalf("entry_refs = %#v", result.EntryRefs)
	}
}

func TestLookupServiceGuideFailsClosedWhenEntryURLIsRequestedButUnavailable(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"办公电话查询链接是什么",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"audience":"unknown"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "field_not_provided_by_source" {
		t.Fatalf("fail_close_reason = %q, want field_not_provided_by_source", result.FailCloseReason)
	}
	if result.FieldStatus["service_entry"] != "source_not_provided" {
		t.Fatalf("field_status = %#v", result.FieldStatus)
	}
}

func TestLookupServiceGuideResolvesNetworkAccountEntry(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"上网账号申请去哪里办",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"audience":"faculty"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:network-account-management" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.EntryRefs) != 2 {
		t.Fatalf("entry_refs = %#v, want 2", result.EntryRefs)
	}
	if result.EntryRefs[0].Label != "IT服务中心" || result.EntryRefs[0].LocationRef != "中慧楼二层IT服务中心" {
		t.Fatalf("entry_refs = %#v", result.EntryRefs)
	}
	if result.EntryRefs[1].Label != "服务门户" {
		t.Fatalf("entry_refs = %#v", result.EntryRefs)
	}
}

func TestLookupServiceGuideResolvesStaffCampusCardFullGuide(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideITAdditionalTargetsProjectionFixture(),
		"2026-05-04T12:00:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"教职工校园卡丢了怎么办",
		"guide_focus":"full_guide",
		"temporal_query":{"mode":"current"},
		"audience":"faculty"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:staff-campus-card" {
		t.Fatalf("resolved_service = %#v", result.ResolvedService)
	}
	if len(result.ContactRefs) != 2 ||
		result.ContactRefs[0].Phone != "010-68933381" ||
		result.ContactRefs[1].Phone != "010-83878225" {
		t.Fatalf("contact_refs = %#v", result.ContactRefs)
	}
	if len(result.EntryRefs) != 2 {
		t.Fatalf("entry_refs = %#v", result.EntryRefs)
	}
}
