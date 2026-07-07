package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestToolReadModelTransportScheduleUsesConfiguredProjectionBundle(t *testing.T) {
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
	server := newToolReadModelAuthServerForTest()
	useToolReadModelRuntimeFixture(
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
	request.Header.Set("x-execution-query-auth", "query-secret")
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
	envelope := expectRecord(t, body["result_envelope"], "result_envelope")
	if envelope["schema_version"] != "campus_services_tool_result.v1" ||
		envelope["tool"] != "transport_schedule_lookup" ||
		envelope["tool_name"] != "transport_schedule_lookup" ||
		envelope["query_kind"] != "transport_schedule" ||
		envelope["outcome"] != "resolved_current" {
		t.Fatalf("result_envelope = %#v", envelope)
	}
	facts := expectRecord(t, envelope["facts"], "result_envelope.facts")
	if facts["kind"] != "schedule_facts" {
		t.Fatalf("facts.kind = %v, want schedule_facts", facts["kind"])
	}
	factResult := expectRecord(t, facts["result"], "result_envelope.facts.result")
	if factResult["outcome"] != body["outcome"] {
		t.Fatalf("facts.result.outcome = %v, want top-level outcome", factResult["outcome"])
	}
	sourceRefs, ok := envelope["source_refs"].([]any)
	if !ok || len(sourceRefs) != 1 || sourceRefs[0] != "notice:bus-schedule-2026-04-20" {
		t.Fatalf("source_refs = %#v, want schedule source", envelope["source_refs"])
	}
	if envelope["projection_ref"] == "" || envelope["content_hash"] == "" {
		t.Fatalf("result_envelope missing projection_ref/content_hash: %#v", envelope)
	}

	metricsResponse := httptest.NewRecorder()
	server.ServeHTTP(metricsResponse, newTestRequest(http.MethodGet, "/metrics", nil))
	if !strings.Contains(
		metricsResponse.Body.String(),
		`campus_execution_control_tool_read_model_requests_total{tool="transport_schedule_lookup",outcome="resolved_current",status_class="2xx"} 1`,
	) {
		t.Fatalf("metrics missing tool read model counter:\n%s", metricsResponse.Body.String())
	}
}

func TestToolReadModelTransportScheduleFailsClosedWhenProjectionUnavailable(t *testing.T) {
	server := newToolReadModelAuthServerForTest()

	request := newTestRequest(
		http.MethodPost,
		"/internal/query/campus-services/transport-schedule",
		strings.NewReader(`{
			"query_text":"最近的校车时刻表是什么",
			"intent":"schedule_snapshot_metadata",
			"snapshot_query":{"mode":"current"}
		}`),
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
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

func TestToolReadModelNoticeDiscoverRequiresQueryAuth(t *testing.T) {
	server := newToolReadModelAuthServerForTest()

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

func TestToolReadModelNoticeDiscoverFailsClosedWhenReadModelUnavailable(t *testing.T) {
	server := newToolReadModelAuthServerForTest()

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
	request.Header.Set("x-execution-query-auth", "query-secret")
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
