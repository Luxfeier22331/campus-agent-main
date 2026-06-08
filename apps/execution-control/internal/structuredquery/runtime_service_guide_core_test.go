package structuredquery

import (
	"context"
	"fmt"
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
