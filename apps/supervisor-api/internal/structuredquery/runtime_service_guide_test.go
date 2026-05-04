package structuredquery

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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

func TestLookupServiceGuideDoesNotFilterUnknownAudienceOfficialWebRecord(t *testing.T) {
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
							"content":"校园卡丢失后可通过民大通APP挂失。",
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
		"2026-05-02T12:45:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"中央民族大学学生校园卡服务电话是多少",
		"guide_focus":"contact",
		"temporal_query":{"mode":"current"},
		"audience":"student"
	}`))

	result := response.Body.(serviceGuideResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if len(result.ContactRefs) != 1 || result.ContactRefs[0].Phone != "010-68933381" {
		t.Fatalf("contact_refs = %#v", result.ContactRefs)
	}
}

func TestLookupServiceGuideFailsClosedForPhoneQueryWhenOnlyDepartmentProvided(t *testing.T) {
	runtime := newRuntimeWithServiceGuideReadModel(
		t,
		`{
			"schema_version":"campus_services_service_guide_projection.v1",
			"generated_at":"2026-05-02T12:00:00+08:00",
			"source_families":["official_web_curated_service_guide_v1"],
			"service_guide_records":[
				{
					"service_id":"service:official-web:information-disclosure",
					"display_name":"中央民族大学信息公开依申请公开工作流程",
					"aliases":["信息公开申请流程"],
					"category":"campus_service",
					"campus_scope":"all",
					"audience":["unknown"],
					"effective_from":"2026-05-02T00:00:00+08:00",
					"effective_until":"9999-12-31T23:59:59+08:00",
					"source_refs":["official_web:muc-information-disclosure-application-process:owver"],
					"guide_sections":[
						{
							"section_id":"service:official-web:information-disclosure:section:procedure",
							"section_type":"procedure",
							"title":"信息公开申请流程",
							"content":"学校信息公开办公室负责初步审核。",
							"order":1,
							"source_refs":["official_web:muc-information-disclosure-application-process:owver"]
						},
						{
							"section_id":"service:official-web:information-disclosure:section:contact",
							"section_type":"contact",
							"title":"负责部门",
							"content":"学校信息公开办公室",
							"order":2,
							"source_refs":["official_web:muc-information-disclosure-application-process:owver"]
						}
					],
					"materials":[],
					"entry_refs":[],
					"office_hours":[],
					"contact_refs":[
						{
							"contact_id":"service:official-web:information-disclosure:contact:1",
							"label":"学校信息公开办公室",
							"department":"学校信息公开办公室",
							"phone":"",
							"email":"",
							"location_ref":"",
							"source_refs":["official_web:muc-information-disclosure-application-process:owver"]
						}
					],
					"eligibility_notes":[],
					"field_status":{"phone":"source_not_provided","email":"source_not_provided","location":"source_not_provided"},
					"extraction_status":"ready"
				}
			],
			"conflict_records":[],
			"manual_review_sources":[]
		}`,
		"2026-05-02T20:45:00+08:00",
	)

	response := runtime.LookupServiceGuide(context.Background(), []byte(`{
		"service_query":"信息公开申请联系电话是多少",
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
	if result.FieldStatus["phone"] != "source_not_provided" {
		t.Fatalf("field_status = %#v", result.FieldStatus)
	}
}

func TestLookupServiceGuideFailsClosedForRequestedMissingFields(t *testing.T) {
	fixture := `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-05-02T12:00:00+08:00",
		"source_families":["official_web_curated_service_guide_v1"],
		"service_guide_records":[
			{
				"service_id":"service:official-web:information-disclosure",
				"display_name":"中央民族大学信息公开依申请公开工作流程",
				"aliases":["信息公开申请流程"],
				"category":"campus_service",
				"campus_scope":"all",
				"audience":["unknown"],
				"effective_from":"2026-05-02T00:00:00+08:00",
				"effective_until":"9999-12-31T23:59:59+08:00",
				"source_refs":["official_web:muc-information-disclosure-application-process:owver"],
				"guide_sections":[
					{
						"section_id":"service:official-web:information-disclosure:section:procedure",
						"section_type":"procedure",
						"title":"信息公开申请流程",
						"content":"学校信息公开办公室负责初步审核。",
						"order":1,
						"source_refs":["official_web:muc-information-disclosure-application-process:owver"]
					},
					{
						"section_id":"service:official-web:information-disclosure:section:contact",
						"section_type":"contact",
						"title":"负责部门",
						"content":"学校信息公开办公室",
						"order":2,
						"source_refs":["official_web:muc-information-disclosure-application-process:owver"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[
					{
						"contact_id":"service:official-web:information-disclosure:contact:1",
						"label":"学校信息公开办公室",
						"department":"学校信息公开办公室",
						"phone":"",
						"email":"",
						"location_ref":"",
						"source_refs":["official_web:muc-information-disclosure-application-process:owver"]
					}
				],
				"eligibility_notes":[],
				"field_status":{
					"phone":"source_not_provided",
					"email":"source_not_provided",
					"location":"source_not_provided",
					"office_hours":"source_not_provided",
					"service_entry":"source_not_provided",
					"required_materials":"source_not_provided",
					"service_material":"source_not_provided"
				},
				"extraction_status":"ready"
			}
		],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
	cases := []struct {
		name        string
		query       string
		focus       string
		fieldStatus string
	}{
		{
			name:        "email contact query",
			query:       "信息公开申请邮箱是多少",
			focus:       "contact",
			fieldStatus: "email",
		},
		{
			name:        "location contact query",
			query:       "信息公开申请办公地点在哪里",
			focus:       "contact",
			fieldStatus: "location",
		},
		{
			name:        "office hours focus",
			query:       "信息公开申请办公时间是什么",
			focus:       "office_hours",
			fieldStatus: "office_hours",
		},
		{
			name:        "entry focus",
			query:       "信息公开申请入口在哪里",
			focus:       "entry",
			fieldStatus: "service_entry",
		},
		{
			name:        "required materials focus",
			query:       "信息公开申请需要哪些材料",
			focus:       "required_materials",
			fieldStatus: "required_materials",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runtime := newRuntimeWithServiceGuideReadModel(t, fixture, "2026-05-02T20:45:00+08:00")

			response := runtime.LookupServiceGuide(context.Background(), []byte(`{
				"service_query":`+fmt.Sprintf("%q", tc.query)+`,
				"guide_focus":`+fmt.Sprintf("%q", tc.focus)+`,
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
			if result.FieldStatus[tc.fieldStatus] != "source_not_provided" {
				t.Fatalf("field_status = %#v", result.FieldStatus)
			}
		})
	}
}

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
	releaseID          string
	bundle             projectionBundle
	loadCount          int
	loadedReleaseIDs   []string
	projectionReady    bool
	projectionReadySet bool
	projectionReadyErr error
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

func (s *fakeServiceGuideReadModelStore) ProjectionReady(context.Context) (bool, error) {
	if s.projectionReadyErr != nil {
		return false, s.projectionReadyErr
	}
	if s.projectionReadySet {
		return s.projectionReady, nil
	}
	return len(s.bundle.ServiceGuideRecords) > 0, nil
}

func (s *fakeServiceGuideReadModelStore) LoadBundleForRelease(
	_ context.Context,
	releaseID string,
) (projectionBundle, error) {
	s.loadCount++
	s.loadedReleaseIDs = append(s.loadedReleaseIDs, releaseID)
	return s.bundle, nil
}
