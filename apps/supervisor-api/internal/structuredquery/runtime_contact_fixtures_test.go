package structuredquery

import "strings"

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
			},
			{
				"contact_id":"contact:official-web:it-service-contacts",
				"display_name":"中央民族大学信息化服务联系方式",
				"aliases":["信息化办","信息化服务","网络服务","一卡通服务","多媒体教室服务"],
				"contact_group":"official_web",
				"department":"信息化建设管理处",
				"contact_points":[
					{"channel_type":"phone","label":"网络服务","value":"010-68932559","source_refs":["https://met.muc.edu.cn/info/1046/1810.htm"]},
					{"channel_type":"phone","label":"一卡通服务","value":"010-68933381","source_refs":["https://met.muc.edu.cn/info/1046/1810.htm"]},
					{"channel_type":"phone","label":"多媒体教室服务","value":"010-68932625","source_refs":["https://met.muc.edu.cn/info/1046/1810.htm"]}
				],
				"source_refs":["https://met.muc.edu.cn/info/1046/1810.htm"],
				"extraction_status":"ready"
			},
			{
				"contact_id":"contact:official-web:logistics-service-center",
				"display_name":"中央民族大学后勤服务联系方式",
				"aliases":["后勤服务热线","学生公寓管理服务中心","会务服务中心"],
				"contact_group":"official_web",
				"department":"后勤保障处",
				"contact_points":[
					{"channel_type":"phone","label":"后勤服务热线","value":"010-68931111","source_refs":["https://hq.muc.edu.cn/info/1010/1001.htm"]},
					{"channel_type":"phone","label":"学生公寓管理服务中心","value":"010-68931234","source_refs":["https://hq.muc.edu.cn/info/1010/1001.htm"]},
					{"channel_type":"phone","label":"会务服务中心","value":"010-68935678","source_refs":["https://hq.muc.edu.cn/info/1010/1001.htm"]}
				],
				"source_refs":["https://hq.muc.edu.cn/info/1010/1001.htm"],
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
