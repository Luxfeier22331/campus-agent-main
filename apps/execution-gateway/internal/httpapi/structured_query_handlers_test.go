package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/MUC-WIKI/campus-agent/apps/execution-gateway/internal/config"
)

func TestStructuredQueryServiceStatusUsesConfiguredProjectionBundle(t *testing.T) {
	projectionFixture := `{
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
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	}, nil)
	useStructuredQueryRuntimeFixture(
		t,
		server,
		projectionFixture,
		"2026-04-24T10:30:00+08:00",
	)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/service-status",
		strings.NewReader(`{
			"subject_query":"图书馆今天开门吗",
			"temporal_query":{"mode":"current"},
			"campus_scope":"haidian"
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	if body["resolved_subject"] != "海淀校区图书馆" {
		t.Fatalf("resolved_subject = %v", body["resolved_subject"])
	}
	if body["observed_status"] != "open" {
		t.Fatalf("observed_status = %v", body["observed_status"])
	}
	if body["status_note"] != "工作日开放，节假日另行通知" {
		t.Fatalf("status_note = %v", body["status_note"])
	}
	if body["queried_time_anchor"] != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %v", body["queried_time_anchor"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_execution_gateway_structured_query_requests_total{tool="service_status_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryTransportScheduleUsesConfiguredProjectionBundle(t *testing.T) {
	projectionFixture := `{
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
		"scheduled_departures":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"route_id":"route:haidian-to-fengtai",
				"service_dates":["2026-04-25"],
				"departure_time":"06:50",
				"arrival_time":"08:05",
				"origin_stop_id":"stop:haidian-east-gate",
				"destination_stop_id":"stop:fengtai-main-gate"
			}
		]
	}`
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T20:30:00+08:00",
	}, nil)
	useStructuredQueryRuntimeFixture(
		t,
		server,
		projectionFixture,
		"2026-04-24T20:30:00+08:00",
	)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/transport-schedule",
		strings.NewReader(`{
			"query_text":"我明天早上要去丰台上课，最早的班车是几点",
			"intent":"first_departure",
			"route_selector":{"destination_campus":"fengtai"},
			"snapshot_query":{"mode":"current"},
			"service_time_query":{"date_mode":"tomorrow","daypart":"morning"}
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	selectedDeparture := expectRecord(t, body["selected_departure"], "selected_departure")
	if selectedDeparture["departure_at"] != "2026-04-25T06:50:00+08:00" {
		t.Fatalf("departure_at = %v", selectedDeparture["departure_at"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_execution_gateway_structured_query_requests_total{tool="transport_schedule_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryServiceGuideUsesConfiguredProjectionBundle(t *testing.T) {
	serviceGuideProjectionFixture := `{
		"schema_version":"campus_services_service_guide_projection.v1",
		"generated_at":"2026-04-25T10:00:00+08:00",
		"source_families":["handbook_service_navigation_projection_v1"],
		"service_guide_records":[
			{
				"service_id":"service:handbook:check-in",
				"display_name":"公寓楼新生办理入住手续流程",
				"aliases":["入住","住宿","宿舍"],
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
				"procedure_groups":[
					{
						"group_id":"service:handbook:check-in:procedure_group:check_in",
						"title":"入住流程",
						"focus_tags":["procedure","入住","宿舍"],
						"order":1,
						"steps":[
							{
								"step_id":"service:handbook:check-in:procedure_group:check_in:step:1",
								"content":"持通知书到院系注册。",
								"order":1,
								"source_refs":["handbook:student_rules:pages:252-255#page=253"]
							},
							{
								"step_id":"service:handbook:check-in:procedure_group:check_in:step:2",
								"content":"到指定公寓楼报到。",
								"order":2,
								"source_refs":["handbook:student_rules:pages:252-255#page=253"]
							}
						],
						"source_refs":["handbook:student_rules:pages:252-255#page=253"]
					}
				],
				"materials":[],
				"entry_refs":[],
				"office_hours":[],
				"contact_refs":[],
				"eligibility_notes":["新生"],
				"field_status":{"service_process":"present"},
				"extraction_status":"ready"
			}
		],
		"conflict_records":[],
		"manual_review_sources":[]
	}`
	emptySharedProjectionFixture := `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[]
	}`
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-25T10:30:00+08:00",
	}, nil)
	useStructuredQueryRuntimeFixtures(
		t,
		server,
		emptySharedProjectionFixture,
		emptySharedProjectionFixture,
		serviceGuideProjectionFixture,
		"2026-04-25T10:30:00+08:00",
	)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/service-guide",
		strings.NewReader(`{
			"service_query":"宿舍入住怎么办理",
			"guide_focus":"procedure",
			"temporal_query":{"mode":"current"},
			"audience":"student"
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	resolvedService := expectRecord(t, body["resolved_service"], "resolved_service")
	if resolvedService["display_name"] != "公寓楼新生办理入住手续流程" {
		t.Fatalf("resolved_service.display_name = %v", resolvedService["display_name"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_execution_gateway_structured_query_requests_total{tool="service_guide_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryContactDirectoryUsesConfiguredProjectionBundle(t *testing.T) {
	contactProjectionFixture := `{
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
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-27T10:30:00+08:00",
	}, nil)
	useStructuredQueryRuntimeFixture(
		t,
		server,
		contactProjectionFixture,
		"2026-04-27T10:30:00+08:00",
	)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/contact-directory",
		strings.NewReader(`{
			"query_text":"研究生院招生办公室电话是多少",
			"contact_focus":"phone",
			"temporal_query":{"mode":"current"},
			"audience":"student"
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	resolvedContact := expectRecord(t, body["resolved_contact"], "resolved_contact")
	if resolvedContact["display_name"] != "研究生院招生办公室" {
		t.Fatalf("resolved_contact.display_name = %v", resolvedContact["display_name"])
	}
	contactPoints, ok := body["contact_points"].([]any)
	if !ok || len(contactPoints) != 1 {
		t.Fatalf("contact_points = %#v", body["contact_points"])
	}
	firstPoint := expectRecord(t, contactPoints[0], "contact_point")
	if firstPoint["value"] != "010-68930001" {
		t.Fatalf("contact point value = %v", firstPoint["value"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_execution_gateway_structured_query_requests_total{tool="contact_directory_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryAcademicCalendarUsesConfiguredProjectionBundle(t *testing.T) {
	academicCalendarProjectionFixture := `{
		"schema_version":"academic_calendar_projection.v1",
		"academic_calendar_records":[
			{
				"academic_year_label":"2025-2026学年",
				"term_label":"春季学期",
				"start_date":"2026-05-04",
				"end_date":"2026-05-10",
				"week_index":10,
				"day_kind":"teaching_day",
				"class_day_pattern":"",
				"is_makeup_class":false,
				"holiday_name":"",
				"source_refs":["official_web:muc-public-academic-calendar:owver"]
			}
		]
	}`
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-05-04T09:00:00+08:00",
	}, nil)
	useStructuredQueryRuntimeFixture(
		t,
		server,
		academicCalendarProjectionFixture,
		"2026-05-04T09:00:00+08:00",
	)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/calendar/academic-calendar",
		strings.NewReader(`{
			"query_text":"今天第几教学周",
			"temporal_query":{"mode":"current"},
			"date_hint":"2026-05-04"
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "resolved_current" {
		t.Fatalf("outcome = %v, want resolved_current", body["outcome"])
	}
	if body["week_index"] != float64(10) {
		t.Fatalf("week_index = %v, want 10", body["week_index"])
	}
	if body["resolved_date"] != "2026-05-04" {
		t.Fatalf("resolved_date = %v, want 2026-05-04", body["resolved_date"])
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_execution_gateway_structured_query_requests_total{tool="academic_calendar_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing structured query counter:\n%s", metricsResponse.Body.String())
	}
}

func TestStructuredQueryTransportScheduleFailsClosedWhenProjectionUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	}, nil)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/transport-schedule",
		strings.NewReader(`{
			"query_text":"最近的校车时刻表是什么",
			"intent":"schedule_snapshot_metadata",
			"snapshot_query":{"mode":"current"}
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "temporarily_unverifiable" {
		t.Fatalf("outcome = %v, want temporarily_unverifiable", body["outcome"])
	}
	if body["fail_close_reason"] != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %v, want source_truth_unavailable", body["fail_close_reason"])
	}
	if body["queried_time_anchor"] != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %v", body["queried_time_anchor"])
	}
}

func TestStructuredQueryNoticeDiscoverRequiresQueryAuth(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers:      8,
		RequestBodyLimitBytes:     1_048_576,
		InternalQuerySharedSecret: "query-secret",
	}, nil)

	response := httptest.NewRecorder()
	server.ServeHTTP(
		response,
		newTestRequest(
			http.MethodPost,
			"/internal/query/notices/discover",
			strings.NewReader(`{"payload":{"query_text":"家具采购"}}`),
		),
	)

	assertError(t, response, http.StatusUnauthorized, "unauthorized")
}

func TestStructuredQueryNoticeDiscoverFailsClosedWhenReadModelUnavailable(t *testing.T) {
	server := NewServer(config.Config{
		MaxConcurrentAnswers:              8,
		RequestBodyLimitBytes:             1_048_576,
		InternalQuerySharedSecret:         "query-secret",
		StructuredQueryTrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	}, nil)

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/notices/discover",
		strings.NewReader(`{
			"payload":{
				"query_text":"家具采购",
				"source_families":["internal_notice_restricted"]
			},
			"access_context":{
				"authorization":{
					"principal_id":"principal-001",
					"entitlement_groups":["students"],
					"retrieval_filter":{
						"entitlement_groups":["students"],
						"visibility_level":"restricted"
					}
				}
			}
		}`),
	)
	request.Header.Set("x-supervisor-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	body := decodeBody(t, response)
	if body["outcome"] != "temporarily_unverifiable" {
		t.Fatalf("outcome = %v, want temporarily_unverifiable", body["outcome"])
	}
	if body["fail_close_reason"] != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %v, want source_truth_unavailable", body["fail_close_reason"])
	}
	if body["queried_time_anchor"] != "2026-04-24T10:30:00+08:00" {
		t.Fatalf("queried_time_anchor = %v", body["queried_time_anchor"])
	}
}
