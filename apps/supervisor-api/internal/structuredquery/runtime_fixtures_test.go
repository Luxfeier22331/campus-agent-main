package structuredquery

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTransportProjectionFixture(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "campus-services-projection.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write projection fixture: %v", err)
	}
	return path
}

func transportProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		],
		"transport_routes":[
			{
				"route_id":"route:haidian-to-fengtai",
				"display_name":"海淀到丰台通勤车",
				"service_family":"intercampus_commute",
				"aliases":["去丰台","丰台线"],
				"origin_campus":"haidian",
				"destination_campus":"fengtai",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门","aliases":["海淀东门"]},
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门","aliases":["丰台南门"]}
				]
			},
			{
				"route_id":"route:fengtai-to-haidian",
				"display_name":"丰台到海淀通勤车",
				"service_family":"intercampus_commute",
				"aliases":["回海淀","海淀线"],
				"origin_campus":"fengtai",
				"destination_campus":"haidian",
				"stops":[
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门","aliases":["丰台南门"]},
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门","aliases":["海淀东门"]}
				]
			},
			{
				"route_id":"route:subway-shuttle",
				"display_name":"地铁接驳车",
				"service_family":"subway_shuttle",
				"aliases":["地铁接驳车","metro_shuttle"],
				"origin_campus":"haidian",
				"destination_campus":"subway",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门","aliases":["海淀东门"]},
					{"stop_id":"stop:subway-station","display_name":"地铁站","aliases":["地铁站"]}
				]
			}
		],
		"scheduled_departures":[
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":"16:40","arrival_time":"17:40","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":"17:10","arrival_time":"18:10","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":"18:00","arrival_time":"19:00","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-25"],"departure_time":"06:50","arrival_time":"08:05","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-25"],"departure_time":"07:20","arrival_time":"08:35","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-25"],"departure_time":"13:20","arrival_time":"14:35","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"},
			{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:subway-shuttle","service_dates":["2026-04-24"],"departure_time":"08:00","origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:subway-station"}
		],
		"transport_service_exceptions":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"route_id":"route:subway-shuttle",
				"service_date":"2026-04-24",
				"service_status":"temporarily_suspended",
				"related_notice_refs":["notice:metro-shuttle-suspended"]
			}
		]
	}`
}

func transportProjectionFixtureWithDepartures(count int) string {
	var departures strings.Builder
	for index := 0; index < count; index++ {
		if index > 0 {
			departures.WriteString(",")
		}
		departureTime := fmt.Sprintf("%02d:%02d", 6+index/4, (index%4)*15)
		fmt.Fprintf(
			&departures,
			`{"snapshot_id":"snapshot:bus:2026-04-20","route_id":"route:haidian-to-fengtai","service_dates":["2026-04-24"],"departure_time":%q,"origin_stop_id":"stop:haidian-east-gate","destination_stop_id":"stop:fengtai-main-gate"}`,
			departureTime,
		)
	}
	return fmt.Sprintf(`{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"notice:bus-schedule-2026-04-20",
				"is_current":true
			}
		],
		"transport_routes":[
			{
				"route_id":"route:haidian-to-fengtai",
				"display_name":"海淀到丰台通勤车",
				"service_family":"intercampus_commute",
				"origin_campus":"haidian",
				"destination_campus":"fengtai",
				"stops":[
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门"},
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门"}
				]
			}
		],
		"scheduled_departures":[%s]
	}`, departures.String())
}

func transportProjectionFixtureWithTemporaryOverlay() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:transport-schedule:2026-03-02:baseline",
				"published_at":"2026-03-02T08:00:00+08:00",
				"effective_from":"2026-03-02T00:00:00+08:00",
				"source_ref":"notice:muc_internal_portal:baseline",
				"is_current":true,
				"schedule_scope":"baseline_revision",
				"service_date_ranges":[],
				"precedence":100
			},
			{
				"snapshot_id":"snapshot:transport-schedule:2026-01-21:354578",
				"published_at":"2026-01-21T17:00:00+08:00",
				"effective_from":"2026-01-23T00:00:00+08:00",
				"effective_until":"2026-03-02T00:00:00+08:00",
				"source_ref":"notice:muc_internal_portal:354578",
				"is_current":false,
				"schedule_scope":"temporary_period_revision",
				"service_date_ranges":[
					{"start_date":"2026-01-23","end_date":"2026-02-12"},
					{"start_date":"2026-02-23","end_date":"2026-03-01"}
				],
				"precedence":300
			}
		],
		"transport_routes":[
			{
				"route_id":"route:fengtai-to-haidian",
				"display_name":"丰台到海淀通勤车",
				"service_family":"intercampus_commute",
				"origin_campus":"fengtai",
				"destination_campus":"haidian",
				"stops":[
					{"stop_id":"stop:fengtai-main-gate","display_name":"丰台南门"},
					{"stop_id":"stop:haidian-east-gate","display_name":"海淀东门"}
				]
			}
		],
		"scheduled_departures":[
			{"snapshot_id":"snapshot:transport-schedule:2026-01-21:354578","route_id":"route:fengtai-to-haidian","service_dates":["2026-02-24"],"departure_time":"07:30","origin_stop_id":"stop:fengtai-main-gate","destination_stop_id":"stop:haidian-east-gate"},
			{"snapshot_id":"snapshot:transport-schedule:2026-03-02:baseline","route_id":"route:fengtai-to-haidian","service_dates":["2026-03-02"],"departure_time":"06:50","origin_stop_id":"stop:fengtai-main-gate","destination_stop_id":"stop:haidian-east-gate"}
		],
		"transport_service_exceptions":[]
	}`
}

func serviceStatusProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆","海淀校区图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"override_source_refs":["notice:library-hours"],
				"related_notice_refs":["notice:library-hours"]
			}
		]
	}`
}

func incompleteServiceStatusProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00"
			}
		]
	}`
}

func serviceGuideProjectionFixture() string {
	return `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-04-25T10:00:00+08:00",
		"source_families":["handbook_service_navigation_projection_v1"],
		"service_guide_records":[
			{
				"service_id":"service:handbook:check-in",
				"display_name":"公寓楼新生办理入住手续流程",
				"aliases":["公寓楼新生办理入住手续流程","入住","住宿","宿舍"],
				"category":"student_housing",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:252-255#page=253"],
				"guide_sections":[
					{
						"section_id":"service:handbook:check-in:section:procedure",
						"section_type":"procedure",
						"title":"公寓楼新生办理入住手续流程",
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
				"service_id":"service:handbook:undergrad-check-out",
				"display_name":"本科生特殊情况申请办理退宿手续",
				"aliases":["本科生特殊情况申请办理退宿手续","本科生退宿","退宿"],
				"category":"student_housing",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:252-255#page=255"],
				"guide_sections":[
					{
						"section_id":"service:handbook:undergrad-check-out:section:procedure",
						"section_type":"procedure",
						"title":"本科生特殊情况申请办理退宿手续",
						"content":"1. 写好退宿申请。",
						"order":1,
						"source_refs":["handbook:student_rules:pages:252-255#page=255"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["本科生"],
				"extraction_status":"ready"
			},
			{
				"service_id":"service:handbook:grad-check-out",
				"display_name":"研究生申请办理退宿手续",
				"aliases":["研究生申请办理退宿手续","研究生退宿","退宿"],
				"category":"student_housing",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:252-255#page=255"],
				"guide_sections":[
					{
						"section_id":"service:handbook:grad-check-out:section:procedure",
						"section_type":"procedure",
						"title":"研究生申请办理退宿手续",
						"content":"1. 写好退宿申请。",
						"order":1,
						"source_refs":["handbook:student_rules:pages:252-255#page=255"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["研究生"],
				"extraction_status":"ready"
			}
		],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
}

func serviceGuideManualReviewFixture() string {
	return strings.Replace(
		serviceGuideProjectionFixture(),
		`"extraction_status":"ready"`,
		`"extraction_status":"needs_manual_review"`,
		1,
	)
}

func serviceGuideManualReviewSourceFixture() string {
	return strings.Replace(
		serviceGuideProjectionFixture(),
		`"manual_review_sources":[]`,
		`"manual_review_sources":[{"service_id":"service:handbook:check-in","source_ref":"handbook:student_rules:pages:252-255#page=253","reason":"test_manual_review","notes":["人工确认"]}]`,
		1,
	)
}

func serviceGuidePublicMedicalProjectionFixture() string {
	return `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-04-25T10:00:00+08:00",
		"source_families":["handbook_curated_service_guide_v1"],
		"service_guide_records":[
			{
				"service_id":"service:handbook:student-public-medical-reimbursement",
				"display_name":"公费医疗报销办理指南",
				"aliases":["公费医疗报销办理指南","公费医疗报销","医疗报销","医药费报销","假期急病报销","住院报销"],
				"category":"student_public_medical",
				"campus_scope":"all",
				"audience":["student"],
				"effective_from":"2018-09-01T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["handbook:student_rules:pages:259-260#page=259","handbook:student_rules:pages:259-260#page=260"],
				"guide_sections":[
					{
						"section_id":"service:handbook:student-public-medical-reimbursement:section:required-materials",
						"section_type":"required_materials",
						"title":"公费医疗报销材料",
						"content":"假期急病门诊凭急诊证明、检查报告和处方报销；急病住院凭急诊证明、住院收据、住院费明细单报销；住院者出院结算后二周内持出院手续到校医院报销。",
						"order":1,
						"source_refs":["handbook:student_rules:pages:259-260#page=259","handbook:student_rules:pages:259-260#page=260"]
					}
				],
				"materials":[
					{"material_id":"service:handbook:student-public-medical-reimbursement:material:emergency-certificate","name":"急诊证明","required":true,"note":"假期急病门诊报销和急病住院报销均需提供。","source_refs":["handbook:student_rules:pages:259-260#page=259"]},
					{"material_id":"service:handbook:student-public-medical-reimbursement:material:hospital-receipt","name":"住院收据","required":true,"note":"急病住院报销需提供。","source_refs":["handbook:student_rules:pages:259-260#page=259"]},
					{"material_id":"service:handbook:student-public-medical-reimbursement:material:hospital-detail","name":"住院费明细单","required":true,"note":"急病住院报销需提供。","source_refs":["handbook:student_rules:pages:259-260#page=259"]},
					{"material_id":"service:handbook:student-public-medical-reimbursement:material:discharge-documents","name":"出院手续","required":true,"note":"凡住院者必须在出院结算后二周内持出院手续到校医院报销。","source_refs":["handbook:student_rules:pages:259-260#page=260"]}
				],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["国家计划内招生的本科生、硕士生、博士生、预科部学生享受公费医疗。"],
				"extraction_status":"ready"
			}
		],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
}

func serviceGuideContactProjectionFixture() string {
	return strings.Replace(
		serviceGuidePublicMedicalProjectionFixture(),
		`"contact_refs":[]`,
		`"contact_refs":[{"contact_id":"contact:handbook:school-hospital","label":"校医院","department":"校医院","phone":"68930000","email":"","location_ref":"","source_refs":["handbook:student_rules:pages:261-261#page=261"]}]`,
		1,
	)
}

func testStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
