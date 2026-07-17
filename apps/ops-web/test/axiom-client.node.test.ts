// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	AxiomUnavailableError,
	buildAxiomRequestApl,
	createAxiomClient,
	createAxiomClientFromEnv,
} from "../src/server/axiom-client";

const queryConfig = {
	edgeUrl: "https://eu-central-1.aws.edge.axiom.co",
	logsDataset: "campus-agent-staging-logs",
	metricsDataset: "campus-agent-staging-metrics",
	queryToken: "xaat-query-token",
	tracesDataset: "campus-agent-staging-traces",
};

describe("Axiom client", () => {
	it("queries the fixed logs dataset by the trusted request id", async () => {
		const onQueryComplete = vi.fn();
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
			tabularResponse(
				["timestamp", "service.name", "body", "trace_id", "span_id", "request_id"],
				[
					{
						body: "request completed",
						request_id: "req_ops_001",
						"service.name": "app-api",
						span_id: "span_ops_001",
						timestamp: "2026-07-09T06:29:04.000Z",
						trace_id: "trace_ops_001",
					},
				],
				{
					headers: {
						"x-axiom-history-query-id": "query-001",
						"x-querylimit-remaining": "42",
					},
				},
			),
		);
		const client = createAxiomClient({
			...queryConfig,
			fetchFn,
			onQueryComplete,
		});

		const result = await client.queryRequest({
			completedAt: "2026-07-09T06:29:04.000Z",
			kind: "logs",
			now: new Date("2026-07-09T06:30:00.000Z"),
			requestId: "req_ops_001",
			startedAt: "2026-07-09T06:29:00.000Z",
			traceId: "trace_ops_001",
		});

		expect(result).toMatchObject({
			kind: "logs",
			limit: 200,
			requestId: "req_ops_001",
			source: "AXIOM",
			traceId: "trace_ops_001",
			truncated: false,
		});
		expect(fetchFn).toHaveBeenCalledOnce();
		const [url, init] = fetchFn.mock.calls[0] ?? [];
		expect(url).toBe("https://eu-central-1.aws.edge.axiom.co/v1/query/_apl?format=tabular");
		expect(init?.headers).toMatchObject({
			accept: "application/json",
			authorization: "Bearer xaat-query-token",
			"content-type": "application/json",
		});
		const body = JSON.parse(String(init?.body)) as {
			apl: string;
			endTime: string;
			startTime: string;
		};
		expect(body.apl).toContain("['campus-agent-staging-logs']");
		expect(body.apl).toContain("attributes.custom['request_id']");
		expect(body.apl).toContain("body['request_id']");
		expect(body.apl).toContain("attributes.custom['http.request.header.x-request-id']");
		expect(body.apl).toContain("attributes['http.request.header.x-request-id']");
		expect(body.apl).toContain("attributes['http.request.header.x_request_id']");
		expect(body.apl).toContain('| where correlated_request_id == "req_ops_001"');
		expect(body.apl).toContain(
			"| project timestamp = _time, ['service.name'], severity_text = tostring(coalesce(severity_text, severityText, severity)), event_type = tostring(coalesce(['event_type'], attributes.custom['event_type'], attributes['event_type'], attributes.custom['event.name'], attributes['event.name'], body['event_type']))",
		);
		expect(body.apl).toContain(
			"trace_id = tostring(coalesce(['trace_id'], attributes.custom['trace_id'], attributes['trace_id']))",
		);
		expect(body.apl).not.toContain(", body,");
		expect(body.apl).toContain("| take 201");
		expect(onQueryComplete).toHaveBeenCalledWith(
			expect.objectContaining({
				dataset: "campus-agent-staging-logs",
				historyQueryId: "query-001",
				queryRemaining: "42",
			}),
		);
	});

	it("caps trace records and reports truncation", async () => {
		const records = Array.from({ length: 501 }, (_, index) => ({
			request_id: "req_ops_001",
			span_id: `span-${index}`,
		}));
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(tabularResponse(["span_id", "request_id"], records));
		const client = createAxiomClient({
			...queryConfig,
			fetchFn,
			onQueryComplete: vi.fn(),
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
		const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as { apl: string };
		expect(body.apl).toContain("['campus-agent-staging-traces']");
		expect(body.apl).toContain("| take 501");
		expect(body.apl).not.toContain("trace_ops_001");
	});

	it("limits raw request queries to the most recent thirty minutes", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(tabularResponse(["request_id"], []));
		const client = createAxiomClient({
			...queryConfig,
			fetchFn,
			onQueryComplete: vi.fn(),
		});

		const result = await client.queryRequest({
			completedAt: "2026-07-09T06:30:00.000Z",
			kind: "logs",
			now: new Date("2026-07-09T06:30:00.000Z"),
			requestId: "req_ops_001",
			startedAt: "2026-07-09T04:00:00.000Z",
			traceId: "trace_ops_001",
		});

		expect(Date.parse(result.to) - Date.parse(result.from)).toBe(30 * 60_000);
		expect(result.truncated).toBe(true);
	});

	it("summarizes the fixed logs, traces, and metrics datasets", async () => {
		const fetchFn = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
			const body = JSON.parse(String(init?.body)) as { apl: string };
			const dataset = body.apl.match(/\['([^']+)'\]/)?.[1] ?? "";
			return tabularResponse(
				["record_count", "last_seen_at"],
				[
					{
						last_seen_at: "2026-07-09T06:29:59.000Z",
						record_count: dataset.endsWith("metrics") ? 12 : 3,
					},
				],
			);
		});
		const client = createAxiomClient({
			...queryConfig,
			fetchFn,
			onQueryComplete: vi.fn(),
		});

		const telemetry = await client.getTelemetrySnapshot(
			"15m",
			new Date("2026-07-09T06:30:00.000Z"),
		);

		expect(fetchFn).toHaveBeenCalledTimes(3);
		expect(
			fetchFn.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).apl.split("\n")[0]),
		).toEqual([
			"['campus-agent-staging-logs']",
			"['campus-agent-staging-metrics']",
			"['campus-agent-staging-traces']",
		]);
		expect(telemetry).toMatchObject({ dataState: "FRESH", status: "HEALTHY" });
		expect(telemetry.signals.map((signal) => signal.kind)).toEqual(["LOGS", "METRICS", "TRACES"]);
	});

	it("fails closed when Axiom marks a result partial", async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(tabularResponse(["request_id"], [], { isPartial: true }));
		const client = createAxiomClient({
			...queryConfig,
			fetchFn,
			onQueryComplete: vi.fn(),
		});

		await expect(
			client.queryRequest({
				completedAt: null,
				kind: "logs",
				now: new Date("2026-07-09T06:30:00.000Z"),
				requestId: "req_ops_001",
				startedAt: "2026-07-09T06:29:00.000Z",
				traceId: "trace_ops_001",
			}),
		).rejects.toThrow(AxiomUnavailableError);
	});

	it("rejects dataset, request id, and personal-token injection surfaces", () => {
		expect(() =>
			createAxiomClient({
				...queryConfig,
				logsDataset: "logs'] | take 1000 //",
			}),
		).toThrow("Axiom dataset name is invalid");
		expect(() =>
			createAxiomClient({
				...queryConfig,
				queryToken: "xapt-personal-token",
			}),
		).toThrow("personal tokens are not allowed");
		expect(() =>
			buildAxiomRequestApl({
				dataset: "campus-agent-staging-logs",
				kind: "logs",
				limit: 201,
				requestId: 'req" | take 1000',
			}),
		).toThrow("Axiom request ID is invalid");
	});

	it("consumes only the explicit Axiom environment surface", () => {
		expect(() => createAxiomClientFromEnv({})).toThrow("OPS_WEB_AXIOM_EDGE_URL");
		expect(() =>
			createAxiomClientFromEnv({
				OPS_WEB_AXIOM_EDGE_URL:
					"https://eu-central-1.aws.edge.axiom.co/v1/query/_apl?format=tabular",
				OPS_WEB_AXIOM_LOGS_DATASET: "campus-agent-staging-logs",
				OPS_WEB_AXIOM_METRICS_DATASET: "campus-agent-staging-metrics",
				OPS_WEB_AXIOM_QUERY_TIMEOUT_MS: "30001",
				OPS_WEB_AXIOM_QUERY_TOKEN: "xaat-query-token",
				OPS_WEB_AXIOM_TRACES_DATASET: "campus-agent-staging-traces",
			}),
		).toThrow("OPS_WEB_AXIOM_QUERY_TIMEOUT_MS");
		expect(() =>
			createAxiomClient({
				...queryConfig,
				edgeUrl: "https://eu-central-1.aws.edge.axiom.co/v1/query/_apl?format=tabular&apl=attacker",
			}),
		).toThrow("tabular Edge APL endpoint");
	});
});

function tabularResponse(
	fields: string[],
	records: Record<string, unknown>[],
	options: {
		headers?: Record<string, string>;
		isPartial?: boolean;
	} = {},
) {
	return new Response(
		JSON.stringify({
			format: "tabular",
			status: {
				blocksExamined: 2,
				elapsedTime: 7,
				isPartial: options.isPartial ?? false,
				rowsExamined: records.length,
				rowsMatched: records.length,
			},
			tables: [
				{
					columns: fields.map((field) => records.map((record) => record[field] ?? null)),
					fields: fields.map((name) => ({ name, type: "string" })),
					name: "query",
				},
			],
		}),
		{ headers: options.headers, status: 200 },
	);
}
