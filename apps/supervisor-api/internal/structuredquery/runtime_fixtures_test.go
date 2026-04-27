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

func transportProjectionFixtureWithOperationalNotice() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-01-01",
				"published_at":"2026-01-01T08:00:00+08:00",
				"effective_from":"2026-01-01T00:00:00+08:00",
				"source_ref":"notice:muc_internal_portal:baseline",
				"is_current":true,
				"schedule_scope":"baseline_revision"
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
			{"snapshot_id":"snapshot:bus:2026-01-01","route_id":"route:fengtai-to-haidian","service_dates":["2026-01-02"],"departure_time":"07:30","origin_stop_id":"stop:fengtai-main-gate","destination_stop_id":"stop:haidian-east-gate"}
		],
		"transport_service_exceptions":[],
		"transport_operational_notices":[
			{
				"notice_id":"353903",
				"source_ref":"notice:muc_internal_portal:353903",
				"notice_kind":"boarding_point_change",
				"route_ids":["route:fengtai-to-haidian"],
				"effective_from":"2026-01-01T00:00:00+08:00",
				"effective_until":"",
				"operational_comment":"通勤班车丰台校区乘车点调整至南门外停车区"
			}
		]
	}`
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
				"status_note":"工作日开放，节假日另行通知",
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

func serviceGuideTransportReservationProjectionFixture() string {
	return `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-04-27T09:00:00+08:00",
		"source_families":["authenticated_notice_service_guide_projection_v1"],
		"service_guide_records":[
			{
				"service_id":"service:transport-reservation:subway-shuttle",
				"display_name":"地铁接驳车预约说明",
				"aliases":["地铁接驳车预约说明","地铁接驳车预约","接驳车预约","接驳车预约系统"],
				"category":"transport_reservation",
				"campus_scope":"fengtai",
				"audience":["student","faculty","unknown"],
				"effective_from":"2026-02-27T10:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["notice:muc_internal_portal:354777"],
				"guide_sections":[
					{
						"section_id":"service:transport-reservation:subway-shuttle:section:procedure",
						"section_type":"procedure",
						"title":"地铁接驳车预约流程",
						"content":"1. 通过服务门户或企业微信进入接驳车预约系统。\n2. 发车前一天9:00开放预约，约满即止。",
						"order":1,
						"source_refs":["notice:muc_internal_portal:354777"]
					},
					{
						"section_id":"service:transport-reservation:subway-shuttle:section:entry",
						"section_type":"entry",
						"title":"预约入口",
						"content":"服务门户、企业微信、接驳车预约系统。",
						"order":2,
						"source_refs":["notice:muc_internal_portal:354777"]
					}
				],
				"materials":[],
				"entry_refs":[
					{"entry_id":"service:transport-reservation:subway-shuttle:entry:service-portal","label":"服务门户","entry_type":"instructions_only","url":"","location_ref":"","source_refs":["notice:muc_internal_portal:354777"]},
					{"entry_id":"service:transport-reservation:subway-shuttle:entry:enterprise-wechat","label":"企业微信","entry_type":"instructions_only","url":"","location_ref":"","source_refs":["notice:muc_internal_portal:354777"]}
				],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":[],
				"extraction_status":"ready"
			}
		],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
}

func serviceGuideCampusCardProjectionFixture() string {
	return `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-04-27T10:00:00+08:00",
		"source_families":["official_web_curated_service_guide_v1"],
		"service_guide_records":[
			{
				"service_id":"service:campus-card:lost-reissue",
				"display_name":"校园卡挂失与补卡",
				"aliases":["校园卡挂失与补卡","校园卡丢了","校园卡遗失","校园卡挂失","校园卡补办","一卡通丢了","一卡通遗失","一卡通挂失","一卡通补卡"],
				"category":"campus_card",
				"campus_scope":"all",
				"audience":["student","faculty"],
				"effective_from":"2026-04-27T00:00:00+08:00",
				"effective_until":"2099-12-31T23:59:59+08:00",
				"source_refs":["https://met.muc.edu.cn/info/1027/1127.htm","https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/"],
				"guide_sections":[
					{
						"section_id":"service:campus-card:lost-reissue:section:overview",
						"section_type":"overview",
						"title":"丢失后的处理范围",
						"content":"校园卡丢失后应先办理挂失，再补办新卡；正式卡可挂失，临时卡不挂失。补卡后原余额可在30分钟后通过POS机刷卡领取或圈存机领取到新卡。",
						"order":1,
						"source_refs":["https://met.muc.edu.cn/info/1027/1127.htm","https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/"]
					},
					{
						"section_id":"service:campus-card:lost-reissue:section:procedure",
						"section_type":"procedure",
						"title":"挂失与补卡流程",
						"content":"1. 通过圈存机、企业微信或民大通APP办理挂失。\n2. 挂失后可在学生自助补卡机补办校园卡。\n3. 补卡后原余额可在30分钟后通过POS机刷卡领取或圈存机领取到新卡。",
						"order":2,
						"source_refs":["https://met.muc.edu.cn/info/1027/1127.htm","https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/"]
					},
					{
						"section_id":"service:campus-card:lost-reissue:section:entry",
						"section_type":"entry",
						"title":"补卡入口与线下地点",
						"content":"学生自助补卡机可办理补卡；自助补卡机位置包括丰台校区聚雅餐厅、荟贤餐厅、智慧中心校园卡前台，以及海淀校区文化楼西区一层、图书馆一层门厅、理工楼一层、中慧楼二层校园卡管理中心；海淀校区线下地点为中慧楼二层校园卡管理中心，丰台校区线下地点为智慧中心一层大厅卡务中心。",
						"order":3,
						"source_refs":["https://met.muc.edu.cn/info/1027/1127.htm","https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/"]
					},
					{
						"section_id":"service:campus-card:lost-reissue:section:contact",
						"section_type":"contact",
						"title":"咨询电话",
						"content":"海淀校区校园卡管理中心咨询电话010-68933381；丰台校区卡务中心咨询电话010-83878225。",
						"order":4,
						"source_refs":["https://met.muc.edu.cn/info/1027/1127.htm"]
					}
				],
				"materials":[],
				"entry_refs":[
					{"entry_id":"service:campus-card:lost-reissue:entry:self-service-machine","label":"学生自助补卡机","entry_type":"instructions_only","url":"","location_ref":"丰台校区聚雅餐厅、荟贤餐厅、智慧中心校园卡前台；海淀校区文化楼西区一层、图书馆一层门厅、理工楼一层、中慧楼二层校园卡管理中心","source_refs":["https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/"]},
					{"entry_id":"service:campus-card:lost-reissue:entry:haidian-card-center","label":"海淀校区校园卡管理中心","entry_type":"offline_location","url":"","location_ref":"中慧楼二层","source_refs":["https://met.muc.edu.cn/info/1027/1127.htm"]},
					{"entry_id":"service:campus-card:lost-reissue:entry:fengtai-card-center","label":"丰台校区卡务中心","entry_type":"offline_location","url":"","location_ref":"智慧中心一层大厅","source_refs":["https://met.muc.edu.cn/info/1027/1127.htm"]}
				],
				"office_hours":[],
				"contact_refs":[
					{"contact_id":"service:campus-card:lost-reissue:contact:haidian","label":"海淀校区校园卡管理中心","department":"校园卡管理中心","phone":"010-68933381","email":"","location_ref":"中慧楼二层","source_refs":["https://met.muc.edu.cn/info/1027/1127.htm"]},
					{"contact_id":"service:campus-card:lost-reissue:contact:fengtai","label":"丰台校区卡务中心","department":"卡务中心","phone":"010-83878225","email":"","location_ref":"智慧中心一层大厅","source_refs":["https://met.muc.edu.cn/info/1027/1127.htm"]}
				],
				"eligibility_notes":["正式卡可办理挂失；临时卡不挂失。"],
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

func contactDirectoryProjectionFixture() string {
	return `{
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
				"emails":[
					{
						"email_id":"email:grad-admission-office:admission@muc.edu.cn",
						"label":"招生邮箱",
						"address":"admission@muc.edu.cn",
						"source_refs":["handbook:contact-directory:2026#page=261"]
					}
				],
				"location_refs":["海淀校区行政楼201"],
				"source_refs":["handbook:contact-directory:2026#page=261"],
				"extraction_status":"ready"
			}
		],
		"contact_conflict_records":[],
		"contact_manual_review_sources":[]
	}`
}

func testStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
