package structuredquery

import (
	"context"
	"strings"
	"testing"
)

func TestLookupServiceGuideMatchesOfficialWebProcedureLanguage(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		`{
			"schema_version":"campus_services_service_guide_projection.v1",
			"generated_at":"2026-05-02T12:00:00+08:00",
			"source_families":["official_web_curated_service_guide_v1"],
			"service_guide_records":[
				{
					"service_id":"service:official-web:campus-card",
					"display_name":"学生校园卡服务",
					"aliases":["中央民族大学学生校园卡服务"],
					"category":"campus_service",
					"campus_scope":"all",
					"audience":["unknown"],
					"effective_from":"2026-05-02T00:00:00+08:00",
					"effective_until":"9999-12-31T23:59:59+08:00",
					"source_refs":["official_web:muc-it-student-campus-card-service-guide:owver"],
					"guide_sections":[
						{
							"section_id":"service:official-web:campus-card:section:procedure",
							"section_type":"procedure",
							"title":"学生校园卡服务",
							"content":"校园卡丢失后，为避免损失，请立即通过圈存机或民大通APP我的一卡通模块进行挂失。",
							"order":1,
							"source_refs":["official_web:muc-it-student-campus-card-service-guide:owver"]
						}
					],
					"materials":[],
					"entry_refs":[],
					"office_hours":[],
					"contact_refs":[
						{
							"contact_id":"service:official-web:campus-card:contact:1",
							"label":"学生校园卡服务",
							"department":"学生校园卡服务",
							"phone":"010-68933381",
							"email":"",
							"location_ref":"",
							"source_refs":["official_web:muc-it-student-campus-card-service-guide:owver"]
						}
					],
					"eligibility_notes":[],
					"extraction_status":"ready"
				}
			],
			"conflict_records":[],
			"manual_review_sources":[]
		}`,
		"2026-05-02T12:50:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"校园卡丢了怎么挂失，电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
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

func TestLookupServiceGuideReadsGroupedProcedureFromPostgresReadModel(t *testing.T) {
	store := &fakeServiceGuideReadModelStore{
		bundle:    mustProjectionBundle(t, serviceGuideVPNProjectionFixture()),
		releaseID: "service-guide-vpn-current-release",
	}
	runtime := NewRuntime(Options{
		ServiceGuideReadModelStore: store,
		TrustedTimeRFC3339:         "2026-05-04T10:30:00+08:00",
	})

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
	if len(store.loadedReleaseIDs) != 1 || store.loadedReleaseIDs[0] != "service-guide-vpn-current-release" {
		t.Fatalf("loadedReleaseIDs = %#v, want current pointer release only", store.loadedReleaseIDs)
	}
	if len(result.ProcedureGroups) != 1 {
		t.Fatalf("procedure_groups = %#v, want 1 selected group", result.ProcedureGroups)
	}
	if result.ProcedureGroups[0].GroupID != "service:official_web:vpn:procedure_group:client_install" {
		t.Fatalf("group_id = %q, want client_install", result.ProcedureGroups[0].GroupID)
	}
	if len(result.GuideSections) != 1 || !strings.Contains(result.GuideSections[0].Content, "下载客户端") {
		t.Fatalf("guide_sections = %#v, want focused grouped procedure section", result.GuideSections)
	}
}

func TestLookupServiceGuideMixedBundleKeepsLegacyFlatProcedureCompatibility(t *testing.T) {
	store := &fakeServiceGuideReadModelStore{
		bundle: mustProjectionBundle(
			t,
			`{
				"schema_version":"campus_services_service_guide_projection.v1",
				"generated_at":"2026-05-04T10:00:00+08:00",
				"source_families":["mixed_projection"],
				"service_guide_records":[
					{
						"service_id":"service:handbook:legacy-check-in",
						"display_name":"宿舍入住办理",
						"aliases":["宿舍入住","入住"],
						"category":"student_housing",
						"campus_scope":"all",
						"audience":["student"],
						"effective_from":"2018-09-01T00:00:00+08:00",
						"effective_until":"2099-12-31T23:59:59+08:00",
						"source_refs":["handbook:student_rules:pages:252-255#page=253"],
						"guide_sections":[
							{
								"section_id":"service:handbook:legacy-check-in:section:procedure",
								"section_type":"procedure",
								"title":"宿舍入住办理",
								"content":"1. 持通知书到院系注册。\n2. 到指定公寓楼报到。",
								"order":1,
								"source_refs":["handbook:student_rules:pages:252-255#page=253"]
							}
						],
						"materials":[],
						"entry_refs":[],
						"office_hours":[],
						"contact_refs":[],
						"eligibility_notes":["新生"],
						"extraction_status":"ready"
					},
					{
						"service_id":"service:official_web:vpn",
						"display_name":"中央民族大学 VPN 使用说明",
						"aliases":["VPN","vpn","中央民族大学VPN系统使用说明"],
						"category":"campus_service",
						"campus_scope":"all",
						"audience":["student","faculty","unknown"],
						"effective_from":"2026-05-01T00:00:00+08:00",
						"effective_until":"2099-12-31T23:59:59+08:00",
						"source_refs":["https://met.muc.edu.cn/info/1046/1674.htm"],
						"guide_sections":[
							{
								"section_id":"service:official_web:vpn:section:procedure",
								"section_type":"procedure",
								"title":"中央民族大学 VPN 使用说明",
								"content":"1. 访问 https://vpn.muc.edu.cn。\n2. 输入统一身份认证账号和密码登录。\n3. 首次使用请根据系统提示下载客户端。",
								"order":1,
								"source_refs":["https://met.muc.edu.cn/info/1046/1674.htm"]
							}
						],
						"procedure_groups":[
							{
								"group_id":"service:official_web:vpn:procedure_group:client_install",
								"title":"客户端安装",
								"focus_tags":["procedure","install","client","客户端"],
								"order":1,
								"steps":[
									{
										"step_id":"service:official_web:vpn:procedure_group:client_install:step:1",
										"content":"首次使用请根据系统提示下载客户端。",
										"order":1,
										"source_refs":["https://met.muc.edu.cn/info/1046/1674.htm"]
									}
								],
								"source_refs":["https://met.muc.edu.cn/info/1046/1674.htm"]
							}
						],
						"materials":[],
						"entry_refs":[],
						"office_hours":[],
						"contact_refs":[],
						"eligibility_notes":[],
						"field_status":{"service_process":"present"},
						"extraction_status":"ready"
					}
				],
				"conflict_records":[],
				"manual_review_sources":[]
			}`,
		),
		releaseID: "service-guide-mixed-current-release",
	}
	runtime := NewRuntime(Options{
		ServiceGuideReadModelStore: store,
		TrustedTimeRFC3339:         "2026-05-04T10:30:00+08:00",
	})

	legacyResponse := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"宿舍入住怎么办理",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))
	legacyResult := legacyResponse.Body.(serviceGuideResult)
	if legacyResult.Outcome != "resolved_current" {
		t.Fatalf("legacy outcome = %q, want resolved_current", legacyResult.Outcome)
	}
	if len(legacyResult.ProcedureGroups) != 0 {
		t.Fatalf("legacy procedure_groups = %#v, want none for flat legacy record", legacyResult.ProcedureGroups)
	}
	if len(legacyResult.GuideSections) != 1 || !strings.Contains(legacyResult.GuideSections[0].Content, "到指定公寓楼报到") {
		t.Fatalf("legacy guide_sections = %#v, want flat procedure section fallback", legacyResult.GuideSections)
	}

	groupedResponse := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"VPN客户端怎么安装",
		"guide_focus":"procedure",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))
	groupedResult := groupedResponse.Body.(serviceGuideResult)
	if groupedResult.Outcome != "resolved_current" {
		t.Fatalf("grouped outcome = %q, want resolved_current", groupedResult.Outcome)
	}
	if len(groupedResult.ProcedureGroups) != 1 ||
		groupedResult.ProcedureGroups[0].GroupID != "service:official_web:vpn:procedure_group:client_install" {
		t.Fatalf("grouped procedure_groups = %#v, want grouped procedure path", groupedResult.ProcedureGroups)
	}
}
