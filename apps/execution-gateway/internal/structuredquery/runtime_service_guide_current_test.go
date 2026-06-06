package structuredquery

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLookupServiceGuideLoadsOnlyCurrentPointerRelease(t *testing.T) {
	store := &fakeServiceGuideReadModelStore{
		bundle:    mustProjectionBundle(t, serviceGuideTransportReservationProjectionFixture()),
		releaseID: "service-guide-current-release",
	}
	runtime := NewRuntime(Options{
		ServiceGuideReadModelStore: store,
		TrustedTimeRFC3339:         "2026-04-27T10:30:00+08:00",
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
	if len(store.loadedReleaseIDs) != 1 || store.loadedReleaseIDs[0] != "service-guide-current-release" {
		t.Fatalf("loadedReleaseIDs = %#v, want current pointer release only", store.loadedReleaseIDs)
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

func TestLookupServiceGuideSelectsFocusedVPNProcedureGroup(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideVPNProjectionFixture(),
		"2026-05-04T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"VPN客户端怎么安装",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.ProcedureGroups) != 1 {
		t.Fatalf("procedure_groups = %#v, want 1 selected group", result.ProcedureGroups)
	}
	if result.ProcedureGroups[0].GroupID != "service:official_web:vpn:procedure_group:client_install" {
		t.Fatalf("group_id = %q, want client_install", result.ProcedureGroups[0].GroupID)
	}
	if len(result.ProcedureGroups[0].Steps) != 2 {
		t.Fatalf("steps = %#v, want 2 install steps", result.ProcedureGroups[0].Steps)
	}
	if !strings.Contains(result.ProcedureGroups[0].Steps[0].Content, "下载客户端") {
		t.Fatalf("steps = %#v, want download client step", result.ProcedureGroups[0].Steps)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "下载客户端") {
		t.Fatalf("guide_sections = %#v, want focused procedure section", result.GuideSections)
	}
	if len(result.SelectedSectionIDs) != 1 ||
		result.SelectedSectionIDs[0] != "service:official_web:vpn:procedure_group:client_install" {
		t.Fatalf("selected_section_ids = %#v", result.SelectedSectionIDs)
	}
	if len(result.OmittedSectionIDs) == 0 {
		t.Fatalf("omitted_section_ids = %#v, want non-selected procedure groups", result.OmittedSectionIDs)
	}
}

func TestLookupServiceGuideDoesNotGuessFirstProcedureGroupWhenQueryDoesNotMatch(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideVPNProjectionFixture(),
		"2026-05-04T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"VPN证书异常怎么处理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.ClarificationReason != "procedure_group_ambiguous" {
		t.Fatalf("clarification_reason = %q, want procedure_group_ambiguous", result.ClarificationReason)
	}
	if len(result.ProcedureGroups) != 0 {
		t.Fatalf("procedure_groups = %#v, want none", result.ProcedureGroups)
	}
	if len(result.GuideSections) != 0 {
		t.Fatalf("guide_sections = %#v, want none", result.GuideSections)
	}
}

func TestLookupServiceGuideMatchesCanonicalVPNGroupedProcedureFixture(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideVPNProjectionFixture(),
		"2026-05-04T10:30:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"VPN客户端怎么安装",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	rawFixture, err := os.ReadFile(
		filepath.Join("..", "..", "..", "..", "tests", "fixtures", "service_guide_vpn_grouped_procedure_result.json"),
	)
	if err != nil {
		t.Fatalf("read canonical fixture: %v", err)
	}
	var fixture serviceGuideResult
	if err := json.Unmarshal(rawFixture, &fixture); err != nil {
		t.Fatalf("parse canonical fixture: %v", err)
	}

	if result.GuideFocus != fixture.GuideFocus {
		t.Fatalf("guide_focus = %q, want %q", result.GuideFocus, fixture.GuideFocus)
	}
	if result.ResolvedService == nil || fixture.ResolvedService == nil {
		t.Fatalf("resolved service missing: %#v %#v", result.ResolvedService, fixture.ResolvedService)
	}
	if result.ResolvedService.DisplayName != fixture.ResolvedService.DisplayName {
		t.Fatalf(
			"resolved_display_name = %q, want %q",
			result.ResolvedService.DisplayName,
			fixture.ResolvedService.DisplayName,
		)
	}
	if len(result.ProcedureGroups) != len(fixture.ProcedureGroups) {
		t.Fatalf("procedure_groups len = %d, want %d", len(result.ProcedureGroups), len(fixture.ProcedureGroups))
	}
	if result.ProcedureGroups[0].GroupID != fixture.ProcedureGroups[0].GroupID {
		t.Fatalf("group_id = %q, want %q", result.ProcedureGroups[0].GroupID, fixture.ProcedureGroups[0].GroupID)
	}
	if len(result.SelectedSectionIDs) != len(fixture.SelectedSectionIDs) ||
		result.SelectedSectionIDs[0] != fixture.SelectedSectionIDs[0] {
		t.Fatalf("selected_section_ids = %#v, want %#v", result.SelectedSectionIDs, fixture.SelectedSectionIDs)
	}
	if len(result.OmittedSectionIDs) != len(fixture.OmittedSectionIDs) {
		t.Fatalf("omitted_section_ids = %#v, want %#v", result.OmittedSectionIDs, fixture.OmittedSectionIDs)
	}
}

func TestLookupServiceGuideResolvesIdentityPasswordResetAliases(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideIdentityAndEmailProjectionFixture(),
		"2026-05-04T10:30:00+08:00",
	)

	tests := []struct {
		name       string
		query      string
		guideFocus string
	}{
		{name: "unified auth password", query: "统一身份认证密码怎么改", guideFocus: "procedure"},
		{name: "portal password", query: "信息门户密码怎么改", guideFocus: "procedure"},
		{name: "smart portal forgot password", query: "智慧门户忘记密码怎么办", guideFocus: "procedure"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := runtime.LookupServiceGuide(context.Background(), []byte(`{
				"service_query":"`+tt.query+`",
				"guide_focus":"`+tt.guideFocus+`",
				"temporal_query":{"mode":"current"},
				"audience":"student"
			}`))

			result := response.Body.(serviceGuideResult)
			if result.Outcome != "resolved_current" {
				t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
			}
			if result.ResolvedService == nil || result.ResolvedService.ServiceID != "service:official_web:identity-password-reset" {
				t.Fatalf("resolved_service = %#v", result.ResolvedService)
			}
			if len(result.EntryRefs) != 1 || result.EntryRefs[0].URL != "https://password.muc.edu.cn" {
				t.Fatalf("entry_refs = %#v", result.EntryRefs)
			}
		})
	}
}

func TestLookupServiceGuideResolvesNetworkAuthAndEmailAliases(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		serviceGuideIdentityAndEmailProjectionFixture(),
		"2026-05-04T10:30:00+08:00",
	)

	networkResponse := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校园网认证网址是什么",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))
	networkResult := networkResponse.Body.(serviceGuideResult)
	if networkResult.Outcome != "resolved_current" {
		t.Fatalf("network outcome = %q, want resolved_current", networkResult.Outcome)
	}
	if networkResult.ResolvedService == nil || networkResult.ResolvedService.ServiceID != "service:official_web:network-auth" {
		t.Fatalf("network resolved_service = %#v", networkResult.ResolvedService)
	}
	if len(networkResult.EntryRefs) != 1 || networkResult.EntryRefs[0].URL != "https://a.muc.edu.cn" {
		t.Fatalf("network entry_refs = %#v", networkResult.EntryRefs)
	}

	emailResponse := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校园邮箱申请表在哪里下载",
		"guide_focus":"entry",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))
	emailResult := emailResponse.Body.(serviceGuideResult)
	if emailResult.Outcome != "resolved_current" {
		t.Fatalf("email outcome = %q, want resolved_current", emailResult.Outcome)
	}
	if emailResult.ResolvedService == nil || emailResult.ResolvedService.ServiceID != "service:official_web:campus-email" {
		t.Fatalf("email resolved_service = %#v", emailResult.ResolvedService)
	}
	if len(emailResult.EntryRefs) != 1 || !strings.Contains(emailResult.EntryRefs[0].Label, "申请表") {
		t.Fatalf("email entry_refs = %#v", emailResult.EntryRefs)
	}
}
