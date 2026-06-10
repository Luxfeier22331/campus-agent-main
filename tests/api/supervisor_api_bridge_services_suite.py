from .supervisor_api_bridge_support import *


class SupervisorApiBridgeServicesTest(SupervisorApiBridgeBaseTest):
    def test_bridge_cancel_route_marks_active_execution_cancel_requested(self) -> None:
        started = threading.Event()
        release = threading.Event()
        answer_responses = []

        def fake_agent(request):
            started.set()
            release.wait(timeout=1.0)
            return CapabilityResponse(
                capability=request.capability,
                status="completed",
                answer_text="completed after cancel signal",
                confidence="medium",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            capability_handler=fake_agent,
        )

        thread = threading.Thread(
            target=lambda: answer_responses.append(
                app.handle(
                    "POST",
                    "/internal/bridge/supervisor/answer",
                    headers={"x-supervisor-bridge-auth": "bridge-secret"},
                    json_body=_capability_execution_payload(
                        user_goal="图书馆开门吗",
                        request_id="req-active-cancel",
                        trace_id="trace-active-cancel",
                    ),
                )
            )
        )
        thread.start()
        self.assertTrue(started.wait(timeout=1.0))

        response = app.handle(
            "POST",
            "/internal/bridge/execution/cancel",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "request_id": "req-active-cancel",
                "reason": "user_requested",
            },
        )

        release.set()
        thread.join(timeout=1.0)
        app.close()

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json_body["status"], "cancel_requested")
        self.assertEqual(response.json_body["request_id"], "req-active-cancel")
        self.assertEqual(answer_responses[0].status_code, 499)
        self.assertEqual(answer_responses[0].json_body["error"]["code"], "execution_cancelled")

    def test_bridge_cancel_route_rejects_non_string_contract_fields(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/execution/cancel",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "request_id": 12345,
                "reason": ["user_requested"],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("request_id", response.json_body["error"]["message"])

    def test_bridge_answer_wires_configured_campus_services_query_service(self) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("x-supervisor-query-auth"),
                        "body": json.loads(self.rfile.read(content_length).decode("utf-8")),
                    }
                )
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "最近一版校车时刻表是什么时候发布的",
                            "intent": "schedule_snapshot_metadata",
                            "outcome": "resolved_current",
                            "queried_time_anchor": "2026-04-24T10:30:00+08:00",
                            "schedule_snapshot": {
                                "snapshot_id": "snapshot:bus:2026-04-20",
                                "published_at": "2026-04-20T18:00:00+08:00",
                                "source_ref": "notice:bus-schedule-2026-04-20",
                            },
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    internal_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    internal_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                    agents_sdk_runtime_enabled=False,
                )
            )
            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_capability_execution_payload_with_handoff(
                    user_goal="最近一版校车时刻表是什么时候发布的",
                    request_id="req-campus-services-query",
                    trace_id="trace-campus-services-query",
                    effective_capability="campus_services",
                    lane="campus_services",
                    handoff_capability="campus_services",
                    payload_kind="transport_schedule_lookup",
                    allowed_tools=["transport_schedule_lookup"],
                    payload={
                        "query_text": "最近一版校车时刻表是什么时候发布的",
                        "intent": "schedule_snapshot_metadata",
                        "snapshot_query": {"mode": "current"},
                    },
                ),
            )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["capability"], "campus_services")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(
            query_requests[0]["path"],
            "/internal/query/campus-services/transport-schedule",
        )
        self.assertEqual(query_requests[0]["auth"], "query-secret")
        payload = query_requests[0]["body"]["payload"]
        self.assertEqual(payload["intent"], "schedule_snapshot_metadata")
        self.assertEqual(
            query_requests[0]["body"]["access_context"]["actor"]["user_id"],
            "student@example.edu",
        )

    def test_bridge_answer_uses_go_preplanned_structured_handoff_without_python_routing(
        self,
    ) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(json.loads(self.rfile.read(content_length).decode("utf-8")))
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "最早的班车几点",
                            "intent": "first_departure",
                            "outcome": "resolved_current",
                            "queried_time_anchor": "2026-04-25T08:00:00+08:00",
                            "resolved_route": {
                                "route_id": "route:fengtai",
                                "display_name": "海淀-丰台班车",
                                "service_family": "intercampus_commute",
                            },
                            "service_status": "running",
                            "selected_departure": {
                                "departure_at": "2026-04-26T07:30:00+08:00",
                            },
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    internal_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    internal_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                    agents_sdk_runtime_enabled=False,
                )
            )
            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_capability_execution_payload_with_handoff(
                    user_goal="最早的班车几点",
                    request_id="req-go-preplanned-transport",
                    trace_id="trace-go-preplanned-transport",
                    effective_capability="campus_services",
                    lane="campus_services",
                    handoff_capability="campus_services",
                    payload_kind="transport_schedule_lookup",
                    allowed_tools=["transport_schedule_lookup"],
                    payload={
                        "query_text": "最早的班车几点",
                        "intent": "first_departure",
                        "snapshot_query": {"mode": "current"},
                        "service_time_query": {
                            "date_mode": "tomorrow",
                            "daypart": "morning",
                        },
                    },
                ),
            )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["capability"], "campus_services")
        self.assertEqual(len(query_requests), 1)
        payload = query_requests[0]["payload"]
        self.assertEqual(payload["intent"], "first_departure")
        self.assertEqual(payload["service_time_query"]["date_mode"], "tomorrow")
