// @vitest-environment node

import type { MetricsResult, TabularQueryResult } from "@axiomhq/js";
import { describe, expect, it, vi } from "vitest";
import {
	type AxiomSdkQueryClient,
	AxiomUnavailableError,
	buildAxiomMetricsMpl,
	buildAxiomRequestApl,
	createAxiomClient,
	createAxiomClientFromEnv,
} from "../src/server/axiom-client";

const queryConfig = {
	edgeDomain: "eu-central-1.aws.edge.axiom.co",
	logsDataset: "campus-agent-staging-logs",
	metricsDataset: "campus-agent-staging-metrics",
	queryToken: "xaat-query-token",
	tracesDataset: "campus-agent-staging-traces",
};

describe("Axiom client", () => {
	it("queries through the official SDK and maps fixed log fields", async () => {
		const onQueryComplete = vi.fn();
		const sdkClient = fakeSdk([
			{
				durationMs: 125,
				errorCode: "provider_timeout",
				eventType: "request.finalized",
				otelSpanId: "0123456789abcdef",
				otelTraceId: "0123456789abcdef0123456789abcdef",
				productTraceId: "trace_ops_001",
				requestId: "req_ops_001",
				serviceName: "app-api",
				severityText: "ERROR",
				source: "app-api.runtime",
				status: "error",
				timestamp: "2026-07-09T06:29:04.000Z",
			},
		]);
		const client = createAxiomClient({
			...queryConfig,
			onQueryComplete,
			sdkClient,
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
			records: [
				expect.objectContaining({
					eventType: "request.finalized",
					requestId: "req_ops_001",
				}),
			],
			requestId: "req_ops_001",
			source: "AXIOM",
			traceId: "trace_ops_001",
			truncated: false,
		});
		expect(sdkClient.query).toHaveBeenCalledOnce();
		const [apl, options] = vi.mocked(sdkClient.query).mock.calls[0] ?? [];
		expect(options).toEqual({
			endTime: "2026-07-09T06:30:00.000Z",
			format: "tabular",
			startTime: "2026-07-09T06:24:00.000Z",
		});
		expect(apl).toContain("['campus-agent-staging-logs']");
		expect(apl).toContain("attributes.custom['campus.request_id']");
		expect(apl).toContain("body['campus.request_id']");
		expect(apl).not.toContain("request.id");
		expect(apl).not.toContain("http.request.header");
		expect(apl).toContain("| take 201");
		expect(onQueryComplete).toHaveBeenCalledWith(
			expect.objectContaining({ dataset: "campus-agent-staging-logs", rowsExamined: 1 }),
		);
	});

	it("caps typed trace records and preserves native and product trace identities", async () => {
		const records = Array.from({ length: 501 }, (_, index) => ({
			duration: "00:00:00.010000000",
			hasError: false,
			kind: "internal",
			name: "execution_control.step",
			otelSpanId: index.toString(16).padStart(16, "0"),
			otelTraceId: "0123456789abcdef0123456789abcdef",
			parentSpanId: null,
			productTraceId: "trace_ops_001",
			requestId: "req_ops_001",
			serviceName: "execution-control",
			statusCode: "OK",
			timestamp: "2026-07-09T06:29:00.200Z",
		}));
		const sdkClient = fakeSdk(records, { rowsMatched: records.length });
		const client = createAxiomClient({ ...queryConfig, sdkClient });

		const result = await client.queryRequest({
			completedAt: null,
			kind: "trace",
			now: new Date("2026-07-09T06:30:00.000Z"),
			requestId: "req_ops_001",
			startedAt: "2026-07-09T06:29:00.000Z",
			traceId: "trace_ops_001",
		});

		expect(result.records).toHaveLength(500);
		expect(result.records[0]).toMatchObject({
			otelTraceId: "0123456789abcdef0123456789abcdef",
			productTraceId: "trace_ops_001",
		});
		expect(result.truncated).toBe(true);
		const [apl] = vi.mocked(sdkClient.query).mock.calls[0] ?? [];
		expect(apl).toContain("['campus-agent-staging-traces']");
		expect(apl).toContain("attributes.custom['campus.request_id']");
		expect(apl).not.toContain("body['campus.request_id']");
		expect(apl).toContain("| take 501");
	});

	it("limits request queries to the most recent thirty minutes", async () => {
		const client = createAxiomClient({ ...queryConfig, sdkClient: fakeSdk([]) });
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
		const metricsFixture = {
			metadata: {},
			series: [
				{
					data: [null, 33_584_167, null],
					resolution: 1,
					start: 1_785_417_763,
				},
			],
		} satisfies MetricsResult;
		const query = vi.fn(async (_query: string, options: { format?: string }) => {
			if (options.format === "metrics-v2") {
				return metricsFixture;
			}
			return tabularResult([
				{
					last_seen_at: "2026-07-09T06:29:59.000Z",
					record_count: 3,
				},
			]);
		});
		const sdkClient: AxiomSdkQueryClient = {
			query: query as AxiomSdkQueryClient["query"],
		};
		const client = createAxiomClient({ ...queryConfig, sdkClient });
		const telemetry = await client.getTelemetrySnapshot("15m", {
			now: new Date("2026-07-09T06:30:00.000Z"),
		});

		expect(sdkClient.query).toHaveBeenCalledTimes(3);
		expect(telemetry).toMatchObject({ dataState: "FRESH", status: "HEALTHY" });
		expect(telemetry.signals.map((signal) => signal.kind)).toEqual(["LOGS", "METRICS", "TRACES"]);
		expect(telemetry.signals[1]).toMatchObject({
			recordCount: 1,
			updatedAt: new Date(1_785_417_764_000).toISOString(),
		});
		expect(query.mock.calls[1]).toEqual([
			buildAxiomMetricsMpl("campus-agent-staging-metrics"),
			{
				endTime: "2026-07-09T06:30:00.000Z",
				format: "metrics-v2",
				startTime: "2026-07-09T06:15:00.000Z",
				type: "mpl",
			},
		]);
	});

	it("normalizes nanosecond timestamps returned by Axiom tabular events", async () => {
		const client = createAxiomClient({
			...queryConfig,
			sdkClient: fakeSdk([
				{
					last_seen_at: 1_783_575_000_200_000_000,
					record_count: 1,
				},
			]),
		});

		const telemetry = await client.getTelemetrySnapshot("15m", {
			now: new Date("2026-07-09T06:30:00.000Z"),
		});

		expect(telemetry.signals[0]?.updatedAt).toBe("2026-07-09T05:30:00.200Z");
		expect(telemetry.signals[2]?.updatedAt).toBe("2026-07-09T05:30:00.200Z");
	});

	it("fails when Axiom marks an SDK result partial", async () => {
		const client = createAxiomClient({
			...queryConfig,
			sdkClient: fakeSdk([], { isPartial: true }),
		});
		await expect(
			client.queryRequest({
				completedAt: null,
				kind: "logs",
				requestId: "req_ops_001",
				startedAt: "2026-07-09T06:29:00.000Z",
				traceId: "trace_ops_001",
			}),
		).rejects.toThrow(AxiomUnavailableError);
	});

	it("wraps official SDK failures as unavailable", async () => {
		const sdkClient: AxiomSdkQueryClient = {
			query: vi.fn().mockRejectedValue(new Error("rate limited")),
		};
		const client = createAxiomClient({ ...queryConfig, sdkClient });
		await expect(client.getTelemetrySnapshot("15m")).resolves.toMatchObject({
			dataState: "UNAVAILABLE",
		});
	});

	it("does not start an Axiom query for an already aborted caller", async () => {
		const sdkClient = fakeSdk([]);
		const client = createAxiomClient({ ...queryConfig, sdkClient });
		const controller = new AbortController();
		controller.abort(new Error("request closed"));

		await expect(
			client.queryRequest({
				completedAt: null,
				kind: "logs",
				now: new Date("2026-07-09T06:30:00.000Z"),
				requestId: "req_ops_001",
				signal: controller.signal,
				startedAt: "2026-07-09T06:29:00.000Z",
				traceId: "trace_ops_001",
			}),
		).rejects.toThrow(AxiomUnavailableError);
		expect(sdkClient.query).not.toHaveBeenCalled();
	});

	it("rejects an aborted telemetry snapshot instead of returning partial availability", async () => {
		const pendingQueries: Deferred<TabularQueryResult>[] = [];
		const sdkClient: AxiomSdkQueryClient = {
			query: vi.fn(() => {
				const pending = deferred<TabularQueryResult>();
				pendingQueries.push(pending);
				return pending.promise;
			}) as unknown as AxiomSdkQueryClient["query"],
		};
		const client = createAxiomClient({ ...queryConfig, sdkClient });
		const controller = new AbortController();
		const snapshot = client.getTelemetrySnapshot("15m", {
			now: new Date("2026-07-09T06:30:00.000Z"),
			signal: controller.signal,
		});

		await vi.waitFor(() => expect(sdkClient.query).toHaveBeenCalledTimes(3));
		controller.abort(new Error("overview timed out"));
		await expect(snapshot).rejects.toThrow(AxiomUnavailableError);
		for (const pending of pendingQueries) {
			pending.resolve(tabularResult([]));
		}
	});

	it("keeps aborted SDK queries in bounded slots until the SDK settles", async () => {
		const pendingQueries: Deferred<TabularQueryResult>[] = [];
		const sdkClient: AxiomSdkQueryClient = {
			query: vi.fn(() => {
				const pending = deferred<TabularQueryResult>();
				pendingQueries.push(pending);
				return pending.promise;
			}) as unknown as AxiomSdkQueryClient["query"],
		};
		const client = createAxiomClient({ ...queryConfig, sdkClient });
		const controllers = Array.from({ length: 5 }, () => new AbortController());
		const requests = controllers.map((controller, index) =>
			client.queryRequest({
				completedAt: null,
				kind: index % 2 === 0 ? "logs" : "trace",
				now: new Date("2026-07-09T06:30:00.000Z"),
				requestId: `req_ops_00${index + 1}`,
				signal: controller.signal,
				startedAt: "2026-07-09T06:29:00.000Z",
				traceId: `trace_ops_00${index + 1}`,
			}),
		);

		await vi.waitFor(() => expect(sdkClient.query).toHaveBeenCalledTimes(5));
		for (const controller of controllers) {
			controller.abort(new Error("overview timed out"));
		}
		await Promise.all(
			requests.map((request) => expect(request).rejects.toThrow(AxiomUnavailableError)),
		);

		await expect(
			client.queryRequest({
				completedAt: null,
				kind: "logs",
				now: new Date("2026-07-09T06:30:00.000Z"),
				requestId: "req_ops_blocked",
				startedAt: "2026-07-09T06:29:00.000Z",
				traceId: "trace_ops_blocked",
			}),
		).rejects.toThrow("concurrency limit");
		expect(sdkClient.query).toHaveBeenCalledTimes(5);

		pendingQueries[0]?.resolve(tabularResult([]));
		await Promise.resolve();
		await Promise.resolve();
		const resumed = client.queryRequest({
			completedAt: null,
			kind: "logs",
			now: new Date("2026-07-09T06:30:00.000Z"),
			requestId: "req_ops_resumed",
			startedAt: "2026-07-09T06:29:00.000Z",
			traceId: "trace_ops_resumed",
		});
		await vi.waitFor(() => expect(sdkClient.query).toHaveBeenCalledTimes(6));
		pendingQueries[5]?.resolve(tabularResult([]));
		await expect(resumed).resolves.toMatchObject({ requestId: "req_ops_resumed" });

		for (const pending of pendingQueries.slice(1, 5)) {
			pending.resolve(tabularResult([]));
		}
	});

	it("rejects dataset, request id, edge domain, and personal-token injection surfaces", () => {
		expect(() =>
			createAxiomClient({
				...queryConfig,
				logsDataset: "logs'] | take 1000 //",
				sdkClient: fakeSdk([]),
			}),
		).toThrow("Axiom dataset name is invalid");
		expect(() =>
			createAxiomClient({
				...queryConfig,
				queryToken: "xapt-personal-token",
				sdkClient: fakeSdk([]),
			}),
		).toThrow("personal tokens are not allowed");
		expect(() =>
			createAxiomClient({
				...queryConfig,
				edgeDomain: "https://api.axiom.co/v1/query/_apl",
				sdkClient: fakeSdk([]),
			}),
		).toThrow("Axiom Edge domain is invalid");
		expect(() =>
			buildAxiomRequestApl({
				dataset: "campus-agent-staging-logs",
				kind: "logs",
				limit: 201,
				requestId: 'req" | take 1000',
			}),
		).toThrow("Axiom request ID is invalid");
	});

	it("consumes only the official SDK environment surface", () => {
		expect(() => createAxiomClientFromEnv({})).toThrow("AXIOM_QUERY_TOKEN");
		expect(() =>
			createAxiomClientFromEnv({
				AXIOM_QUERY_TOKEN: "xaat-query-token",
				OPS_WEB_AXIOM_EDGE_DOMAIN: "https://eu-central-1.aws.edge.axiom.co",
				OPS_WEB_AXIOM_LOGS_DATASET: "campus-agent-staging-logs",
				OPS_WEB_AXIOM_METRICS_DATASET: "campus-agent-staging-metrics",
				OPS_WEB_AXIOM_TRACES_DATASET: "campus-agent-staging-traces",
			}),
		).toThrow("Axiom Edge domain is invalid");
	});
});

function fakeSdk(
	records: Record<string, unknown>[],
	status: { isPartial?: boolean; rowsMatched?: number } = {},
): AxiomSdkQueryClient {
	return {
		query: vi.fn(async () =>
			tabularResult(records, status),
		) as unknown as AxiomSdkQueryClient["query"],
	};
}

function tabularResult(
	records: Record<string, unknown>[],
	status: { isPartial?: boolean; rowsMatched?: number } = {},
): TabularQueryResult {
	return {
		datasetNames: ["fixture"],
		fieldsMetaMap: {},
		format: "tabular",
		status: {
			blocksExamined: 2,
			elapsedTime: 7,
			isPartial: status.isPartial ?? false,
			maxBlockTime: "2026-07-09T06:30:00.000Z",
			maxCursor: "max",
			minBlockTime: "2026-07-09T06:29:00.000Z",
			minCursor: "min",
			numGroups: 0,
			rowsExamined: records.length,
			rowsMatched: status.rowsMatched ?? records.length,
		},
		tables: [
			{
				columns: [],
				events: function* () {
					for (const record of records) {
						yield record;
					}
				},
				fields: [],
				groups: [],
				name: "fixture",
				order: [],
				sources: [{ name: "fixture" }],
			},
		],
	} as TabularQueryResult;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}
