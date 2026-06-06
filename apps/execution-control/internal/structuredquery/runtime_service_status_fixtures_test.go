package structuredquery

func serviceStatusProjectionFixture() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"service_family":"library",
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

func serviceStatusProjectionFixtureWithTemporaryOverride() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian-baseline",
				"display_name":"海淀校区图书馆",
				"service_family":"library",
				"aliases":["图书馆","海淀校区图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"status_note":"工作日开放，节假日另行通知",
				"effective_from":"2026-01-01T08:00:00+08:00",
				"effective_until":"2026-12-31T22:00:00+08:00",
				"related_notice_refs":["notice:library-baseline-hours"]
			},
			{
				"subject_id":"library-haidian-temporary-close",
				"display_name":"海淀校区图书馆",
				"service_family":"library",
				"aliases":["图书馆","海淀校区图书馆"],
				"campus_scope":"haidian",
				"observed_status":"temporarily_closed",
				"status_note":"13:00-18:00 因活动临时闭馆",
				"effective_from":"2026-04-24T13:00:00+08:00",
				"effective_until":"2026-04-24T18:00:00+08:00",
				"override_source_refs":["notice:library-temporary-close"],
				"related_notice_refs":["notice:library-temporary-close"]
			}
		]
	}`
}

func serviceStatusProjectionFixtureWithConflictingCurrentRecords() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"service_family":"library",
				"aliases":["图书馆","海淀校区图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"status_note":"工作日开放",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"related_notice_refs":["notice:library-open"]
			},
			{
				"subject_id":"library-haidian",
				"display_name":"图书馆开放安排",
				"service_family":"library",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"observed_status":"temporarily_closed",
				"status_note":"全天临时闭馆",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"related_notice_refs":["notice:library-closed"]
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

func serviceStatusProjectionFixtureWithUnknownSourceStatus() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library-haidian",
				"display_name":"海淀校区图书馆",
				"service_family":"library",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"observed_status":"unknown",
				"status_note":"状态待确认",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"related_notice_refs":["notice:library-unknown"]
			}
		]
	}`
}

func serviceStatusProjectionFixtureWithPlatformRefs() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"it-platform:unified-auth",
				"display_name":"统一身份认证平台",
				"service_family":"it_platform",
				"aliases":["统一认证"],
				"campus_scope":"all",
				"platform_refs":[{"label":"信息门户"},{"display_name":"网上办事大厅"}],
				"affected_scope":"全校线上服务",
				"observed_status":"temporarily_closed",
				"status_reason":"系统维护",
				"status_note":"维护期间信息门户暂停访问。",
				"effective_from":"2026-04-28T00:00:00+08:00",
				"effective_until":"2026-04-28T06:00:00+08:00",
				"override_source_refs":["notice:it-platform-maintenance"],
				"related_notice_refs":["notice:it-platform-maintenance"],
				"extraction_status":"ready"
			}
		]
	}`
}

func serviceStatusProjectionFixtureWithAmbiguousCampusSubjects() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"service_status_records":[
			{
				"subject_id":"library:haidian",
				"display_name":"海淀校区图书馆",
				"service_family":"library",
				"aliases":["图书馆"],
				"campus_scope":"haidian",
				"observed_status":"open",
				"status_note":"海淀校区正常开放。",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"related_notice_refs":["notice:library-haidian"]
			},
			{
				"subject_id":"library:fengtai",
				"display_name":"丰台校区图书馆",
				"service_family":"library",
				"aliases":["图书馆"],
				"campus_scope":"fengtai",
				"observed_status":"open",
				"status_note":"丰台校区正常开放。",
				"effective_from":"2026-04-24T08:00:00+08:00",
				"effective_until":"2026-04-24T22:00:00+08:00",
				"related_notice_refs":["notice:library-fengtai"]
			}
		]
	}`
}
