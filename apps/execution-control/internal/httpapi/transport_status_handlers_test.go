package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInternalTransportStatusProjectionEndpoint(t *testing.T) {
	server := newToolReadModelAuthServerForTest()
	useToolReadModelRuntimeFixture(
		t,
		server,
		transportProjectionFixtureForHTTPStatusTest(),
		"2026-04-24T10:30:00+08:00",
	)

	request := newTestRequest(
		http.MethodGet,
		"/internal/projections/campus-services/transport-schedule/status",
		nil,
	)
	request.Header.Set("x-execution-query-auth", "query-secret")
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", response.Code, response.Body.String())
	}
	if response.Header().Get("etag") == "" {
		t.Fatal("missing etag header")
	}
	body := decodeBody(t, response)
	release := expectRecord(t, body["release"], "release")
	if release["releaseId"] == "" ||
		release["publishedAt"] != "2026-04-20T18:00:00+08:00" {
		t.Fatalf("release = %#v", release)
	}
	groups, ok := body["groups"].([]any)
	if !ok || len(groups) != 1 {
		t.Fatalf("groups = %#v", body["groups"])
	}
}

func TestInternalTransportStatusProjectionEndpointRequiresAuth(t *testing.T) {
	server := newToolReadModelAuthServerForTest()
	request := newTestRequest(
		http.MethodGet,
		"/internal/projections/campus-services/transport-schedule/status",
		nil,
	)
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
}

func transportProjectionFixtureForHTTPStatusTest() string {
	return `{
		"schema_version":"campus_services_projection_bundle.v1",
		"transport_schedule_snapshots":[
			{
				"snapshot_id":"snapshot:bus:2026-04-20",
				"published_at":"2026-04-20T18:00:00+08:00",
				"effective_from":"2026-04-21T00:00:00+08:00",
				"source_ref":"https://portal.muc.edu.cn/notice/123",
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
				"service_dates":["2026-04-24"],
				"departure_time":"16:40",
				"origin_stop_id":"stop:haidian-east-gate",
				"destination_stop_id":"stop:fengtai-main-gate",
				"related_notice_refs":["https://portal.muc.edu.cn/notice/123"]
			}
		]
	}`
}
