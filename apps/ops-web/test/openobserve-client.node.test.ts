// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createOpenObserveClient } from "../src/server/openobserve-client";

describe("OpenObserve client", () => {
	it("queries a fixed log stream by the trusted request id", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(
				JSON.stringify({
					hits: [
						{
							_timestamp: "2026-07-09T06:29:04.000Z",
							message: "request completed",
							trace_id: "trace_ops_001",
						},
					],
					took: 7,
					total: 1,
				}),
				{ headers: { "content-type": "application/json" }, status: 200 },
			),
		);
		const client = createOpenObserveClient({
			baseUrl: "http://openobserve.campus-agent-staging.svc:5080",
			fetchFn,
			organization: "campus-agent",
			password: "test-password",
			username: "ops@example.test",
		});

		const result = await client.queryRequest({
			completedAt: "2026-07-09T06:29:04.000Z",
			kind: "logs",
			requestId: "req_ops_001",
			startedAt: "2026-07-09T06:29:00.000Z",
			traceId: "trace_ops_001",
		});

		expect(result).toMatchObject({
			kind: "logs",
			limit: 200,
			requestId: "req_ops_001",
			source: "OPENOBSERVE",
			traceId: "trace_ops_001",
			truncated: false,
		});
		expect(fetchFn).toHaveBeenCalledOnce();
		const [url, init] = fetchFn.mock.calls[0] ?? [];
		expect(url).toBe(
			"http://openobserve.campus-agent-staging.svc:5080/api/campus-agent/_search?type=logs",
		);
		expect(init?.headers).toMatchObject({
			accept: "application/json",
			authorization: expect.stringMatching(/^Basic /),
			"content-type": "application/json",
		});
		const body = JSON.parse(String(init?.body)) as { query: { size: number; sql: string } };
		expect(body.query.size).toBe(201);
		expect(body.query.sql).toContain('FROM "campus_agent_logs"');
		expect(body.query.sql).toContain("request_id = 'req_ops_001'");
	});

	it("caps trace records and reports truncation", async () => {
		const records = Array.from({ length: 501 }, (_, index) => ({ span_id: `span-${index}` }));
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ hits: records, total: records.length }), { status: 200 }),
			);
		const client = createOpenObserveClient({
			baseUrl: "https://observe.example.test/",
			fetchFn,
			organization: "campus-agent",
			password: "test-password",
			username: "ops@example.test",
		});

		const result = await client.queryRequest({
			completedAt: null,
			kind: "trace",
			now: new Date("2026-07-09T06:30:00.000Z"),
			requestId: "req_ops_001",
			startedAt: "2026-07-09T06:29:00.000Z",
			traceId: "trace_ops_001",
		});

		expect(result.records).toHaveLength(500);
		expect(result.truncated).toBe(true);
		const [url, init] = fetchFn.mock.calls[0] ?? [];
		expect(url).toBe("https://observe.example.test/api/campus-agent/_search?type=traces");
		const body = JSON.parse(String(init?.body)) as { query: { sql: string } };
		expect(body.query.sql).toContain('FROM "campus_agent_traces"');
		expect(body.query.sql).toContain("request_id = 'req_ops_001'");
	});

	it("summarizes the three fixed telemetry streams", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const body = JSON.parse(String(init?.body)) as { query: { sql: string } };
			const stream = body.query.sql.match(/FROM "([^"]+)"/)?.[1] ?? "";
			return new Response(
				JSON.stringify({
					hits: [
						{
							last_seen_at: "2026-07-09T06:29:59.000Z",
							record_count: stream === "otelcol_process_uptime" ? 12 : 3,
						},
					],
					total: 1,
				}),
				{ status: 200 },
			);
		});
		const client = createOpenObserveClient({
			baseUrl: "https://observe.example.test",
			fetchFn,
			organization: "campus-agent",
			password: "test-password",
			username: "ops@example.test",
		});

		const telemetry = await client.getTelemetrySnapshot(
			"15m",
			new Date("2026-07-09T06:30:00.000Z"),
		);

		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(fetchFn.mock.calls.map(([url]) => String(url).split("?type=")[1])).toEqual([
			"logs",
			"metrics",
			"traces",
		]);
		expect(telemetry).toMatchObject({ dataState: "FRESH", status: "HEALTHY" });
		expect(telemetry.signals.map((signal) => signal.kind)).toEqual(["LOGS", "METRICS", "TRACES"]);
	});

	it("rejects unsafe stream names before issuing a query", () => {
		expect(() =>
			createOpenObserveClient({
				baseUrl: "https://observe.example.test",
				logStream: 'logs"; drop table x; --',
				organization: "campus-agent",
				password: "test-password",
				username: "ops@example.test",
			}),
		).toThrow("OpenObserve stream name is invalid");
	});
});
